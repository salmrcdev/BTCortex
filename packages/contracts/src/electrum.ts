import { z } from 'zod';
import { AppErrorSchema } from './errors';
import { QrMatrixSchema } from './hardware';
import { LogSeveritySchema } from './logs';
import { BitcoinNetworkSchema } from './nodes';
import { VolumeSchema } from './storage';

// Electrum servers BTCortex runs next to its nodes (specification section 7;
// docs/research/notes/electrum-indexers-explorers.md §3): Fulcrum, verified
// and installed by BTCortex, indexing a node on this computer so that
// Electrum wallets (Sparrow, Electrum, Trezor Suite) can use the node with
// their full history. Listeners are bound to this computer only.

const PortSchema = z.number().int().min(1).max(65_535);

export const ElectrumServerPortsSchema = z.object({
  /** Plain TCP for wallets. */
  electrum: PortSchema,
  /** Fulcrum's admin interface, open once the index has caught up. */
  admin: PortSchema,
  /** Fulcrum's statistics, open from start-up. */
  stats: PortSchema,
});
export type ElectrumServerPorts = z.infer<typeof ElectrumServerPortsSchema>;

/**
 * Why a node cannot have an Electrum server on this computer:
 * - `pruned`: it keeps only recent blocks, and every Electrum server needs all of them.
 * - `remote`: the node runs on another computer.
 * - `implementation`: Bitcoin Knots; whether Electrum wallets accept its chain is not established.
 * - `node-unknown`: the node has not answered yet, so BTCortex cannot tell.
 */
export const ElectrumUnavailableReasonSchema = z.enum(['pruned', 'remote', 'implementation', 'node-unknown']);
export type ElectrumUnavailableReason = z.infer<typeof ElectrumUnavailableReasonSchema>;

/**
 * - `not-set-up`: the node has no Electrum server.
 * - `waiting`: set up, but something must happen before it can start; `waitingFor` says what.
 * - `starting`: Fulcrum runs and opens its database.
 * - `indexing`: Fulcrum indexes the node's blocks; wallets can connect once it has caught up.
 * - `ready`: wallets can connect.
 * - `stopped`: stopped by the user, or with its node.
 * - `failed`: it stopped unexpectedly or could not start; `error` says why.
 */
export const ElectrumServerStateSchema = z.enum([
  'not-set-up',
  'waiting',
  'starting',
  'indexing',
  'ready',
  'stopping',
  'stopped',
  'failed',
]);
export type ElectrumServerState = z.infer<typeof ElectrumServerStateSchema>;

/**
 * - `installation`: Fulcrum is being installed.
 * - `node-stopped`: the node does not run.
 * - `node-unreachable`: the node runs but does not answer.
 * - `node-synchronising`: the node is still catching up with the network.
 * - `transaction-index`: Bitcoin Core is building its transaction index; `progress` shows how far.
 * - `transaction-index-off`: the node's configuration does not turn the transaction index on.
 * - `node-pruned`: the node prunes now, so the index can no longer follow it.
 */
export const ElectrumWaitReasonSchema = z.enum([
  'installation',
  'node-stopped',
  'node-unreachable',
  'node-synchronising',
  'transaction-index',
  'transaction-index-off',
  'node-pruned',
]);
export type ElectrumWaitReason = z.infer<typeof ElectrumWaitReasonSchema>;

export const ElectrumConnectionSchema = z.object({
  host: z.string(),
  port: PortSchema,
  protocol: z.enum(['tcp', 'ssl']),
  /** Electrum's and Trezor Suite's form, for example `127.0.0.1:50001:t`. */
  server: z.string(),
  /** Sparrow's form, for example `tcp://127.0.0.1:50001`. */
  url: z.string(),
});
export type ElectrumConnection = z.infer<typeof ElectrumConnectionSchema>;

/**
 * Access from other devices through Tor: the server published as an onion
 * service by BTCortex's tor, so that a phone or another computer reaches it
 * without any port opened on the router.
 */
export const ElectrumRemoteAccessSchema = z.object({
  /** The user turned it on. */
  enabled: z.boolean(),
  /** How wallets elsewhere reach the server; the address stays the same when access is turned off and on again. */
  onion: z
    .object({
      host: z.string(),
      port: PortSchema,
      /** Electrum's form, for example `abc….onion:50001:t`. */
      server: z.string(),
      /** For example `tcp://abc….onion:50001`. */
      url: z.string(),
      /** The `server` form as a QR code, for wallets that scan it. */
      qr: QrMatrixSchema,
    })
    .nullable(),
  /** Why it does not work at the moment, for example because Tor is not running. */
  problem: z.string().optional(),
  /** An onion address is kept for this server, also while access is off; removing the server loses it. */
  addressKept: z.boolean().optional(),
});
export type ElectrumRemoteAccess = z.infer<typeof ElectrumRemoteAccessSchema>;

export const ElectrumLogLineSchema = z.object({
  time: z.iso.datetime(),
  severity: LogSeveritySchema,
  message: z.string(),
});
export type ElectrumLogLine = z.infer<typeof ElectrumLogLineSchema>;

export const ElectrumServerStatusSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  network: BitcoinNetworkSchema,
  /** Present when the node cannot have an Electrum server on this computer. */
  unavailableReason: ElectrumUnavailableReasonSchema.optional(),
  state: ElectrumServerStateSchema,
  waitingFor: ElectrumWaitReasonSchema.optional(),
  /** 0 to 1: the transaction index while waiting for it, or Fulcrum's own index while indexing. */
  progress: z.number().min(0).max(1).optional(),
  /** Start whenever the node runs; turned off by stopping the server. */
  enabled: z.boolean(),
  /** Where the index is kept, once set up. */
  dataDirectory: z.string().nullable(),
  ports: ElectrumServerPortsSchema.nullable(),
  indexing: z
    .object({
      indexedHeight: z.number().int().nullable(),
      targetHeight: z.number().int().nullable(),
      /** Measured over the last minutes; `null` until there is enough to measure. */
      blocksPerSecond: z.number().nonnegative().nullable(),
    })
    .nullable(),
  /** Figures of a running server, once the index has caught up. */
  server: z
    .object({
      version: z.string(),
      height: z.number().int().nonnegative(),
      clients: z.number().int().nonnegative(),
      uptime: z.string(),
      memoryBytes: z.number().nonnegative().optional(),
    })
    .nullable(),
  /** Size of the index on disk. */
  indexBytes: z.number().nonnegative().nullable(),
  /** How wallets on this computer connect, once set up. */
  connection: ElectrumConnectionSchema.nullable(),
  remoteAccess: ElectrumRemoteAccessSchema,
  /** The Fulcrum version that runs now. */
  runningVersion: z.string().nullable(),
  pid: z.number().int().positive().nullable(),
  startedAt: z.iso.datetime().nullable(),
  error: AppErrorSchema.optional(),
  /** Fulcrum's most recent lines, oldest first. */
  recentLines: z.array(ElectrumLogLineSchema),
});
export type ElectrumServerStatus = z.infer<typeof ElectrumServerStatusSchema>;

export const ElectrumOverviewSchema = z.object({
  /** The newest verified Fulcrum BTCortex installed. */
  installed: z.object({ version: z.string(), verifiedAt: z.iso.datetime() }).nullable(),
  /** One entry per node, whether or not it has a server. */
  servers: z.array(ElectrumServerStatusSchema),
});
export type ElectrumOverview = z.infer<typeof ElectrumOverviewSchema>;

export const ElectrumPlanIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ElectrumPlanIssue = z.infer<typeof ElectrumPlanIssueSchema>;

/** What setting up an Electrum server for a node involves, shown before the user confirms it. */
export const ElectrumSetupPlanSchema = z.object({
  nodeId: z.string(),
  /** The folder for the index: BTCortex's proposal, or the one the user chose. */
  dataDirectory: z.string(),
  volume: VolumeSchema.nullable(),
  /** An estimate, from the size of the node's own block files. */
  indexBytesEstimate: z.number().nonnegative(),
  /** Space Bitcoin Core's transaction index will take, when it must be built first (an estimate). */
  transactionIndexBytesEstimate: z.number().nonnegative().nullable(),
  /** Settings BTCortex adds to the node's bitcoin.conf. */
  nodeChanges: z.array(z.object({ key: z.string(), value: z.string() })),
  /** The node restarts once to apply them. */
  restartsNode: z.boolean(),
  /** Fulcrum is downloaded and verified first. */
  installsFulcrum: z.boolean(),
  /** Problems that prevent the set-up, each with what to do. */
  blockers: z.array(ElectrumPlanIssueSchema),
  /** Things to know before confirming. */
  warnings: z.array(ElectrumPlanIssueSchema),
});
export type ElectrumSetupPlan = z.infer<typeof ElectrumSetupPlanSchema>;

export const ElectrumRemovalSchema = z.object({
  /** Bytes freed by deleting the index; 0 when it was kept. */
  deletedBytes: z.number().nonnegative(),
  /** The index folder that was kept, when it was not deleted. */
  keptDirectory: z.string().nullable(),
});
export type ElectrumRemoval = z.infer<typeof ElectrumRemovalSchema>;
