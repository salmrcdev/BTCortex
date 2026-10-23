import { z } from 'zod';
import { AppErrorSchema } from './errors';
import { LogSeveritySchema } from './logs';

// Tor as BTCortex runs it (specification section 10): a verified Tor Expert
// Bundle, one per-user tor process with loopback listeners and cookie
// authentication, its bootstrap and health as tor reports them, other
// software's tor on this computer, and how each node routes through Tor.

const PortSchema = z.number().int().min(1).max(65_535);

export const TorPortsSchema = z.object({
  /** SOCKS port for Bitcoin nodes. */
  socks: PortSchema,
  /** SOCKS port for wallets and other applications, so their circuits never mix with the nodes'. */
  applicationSocks: PortSchema,
  /** Control port; deliberately not tor's usual 9051, so other software does not use it on its own. */
  control: PortSchema,
});
export type TorPorts = z.infer<typeof TorPortsSchema>;

/**
 * - `not-installed`: no verified Tor Expert Bundle yet.
 * - `starting`: tor runs and is connecting to the Tor network.
 * - `running`: connected; applications can use it.
 * - `failed`: tor stopped unexpectedly or could not start; `error` says why.
 */
export const TorStateSchema = z.enum(['not-installed', 'stopped', 'starting', 'running', 'stopping', 'failed']);
export type TorState = z.infer<typeof TorStateSchema>;

export const TorBootstrapSchema = z.object({
  progress: z.number().int().min(0).max(100),
  /** tor's own description of the current step. */
  summary: z.string(),
  /** tor's name for the step, for diagnosis only: future versions may rename steps. */
  tag: z.string(),
  /** A connection problem tor says persists. */
  problem: z
    .object({
      warning: z.string(),
      reason: z.string().optional(),
      count: z.number().int().positive().optional(),
    })
    .optional(),
  /** No progress for two minutes. */
  stalled: z.boolean(),
});
export type TorBootstrap = z.infer<typeof TorBootstrapSchema>;

export const TorLogLineSchema = z.object({
  time: z.iso.datetime(),
  severity: LogSeveritySchema,
  message: z.string(),
});
export type TorLogLine = z.infer<typeof TorLogLineSchema>;

export const ExternalTorKindSchema = z.enum(['tor', 'tor-browser', 'wasabi']);
export type ExternalTorKind = z.infer<typeof ExternalTorKindSchema>;

export const ExternalTorSchema = z.object({
  kind: ExternalTorKindSchema,
  socksPort: PortSchema.optional(),
  controlPort: PortSchema.optional(),
  torVersion: z.string().optional(),
  /** Its control port accepts any local program without authentication. */
  unauthenticated: z.boolean().optional(),
});
export type ExternalTor = z.infer<typeof ExternalTorSchema>;

export const TorStatusSchema = z.object({
  state: TorStateSchema,
  /** The newest verified Expert Bundle BTCortex installed. */
  installed: z
    .object({
      version: z.string(),
      /** tor's own version, for example 0.4.9.14, once known. */
      torVersion: z.string().nullable(),
      verifiedAt: z.iso.datetime(),
    })
    .nullable(),
  /** The bundle version of the tor that runs now; older than `installed` until tor restarts after an update. */
  runningVersion: z.string().nullable(),
  /** Start tor whenever BTCortex starts. Nodes that route through Tor start it anyway. */
  autoStart: z.boolean(),
  ports: TorPortsSchema,
  bootstrap: TorBootstrapSchema.nullable(),
  /** tor can build circuits. */
  circuitEstablished: z.boolean(),
  /** Whether tor sees the network as reachable. */
  networkLiveness: z.enum(['up', 'down']).nullable(),
  /** The Tor directory authorities' view of this tor version: recommended, old, obsolete… */
  versionStatus: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  traffic: z.object({ readBytes: z.number().nonnegative(), writtenBytes: z.number().nonnegative() }).nullable(),
  pid: z.number().int().positive().nullable(),
  /** Why tor stopped or could not start. */
  error: AppErrorSchema.optional(),
  /** The most recent notices, oldest first. */
  recentLines: z.array(TorLogLineSchema),
  /** tor of other software on this computer, found on its usual ports. */
  external: z.array(ExternalTorSchema),
  /** Nodes whose configuration routes through BTCortex's tor, and Electrum servers it publishes as onion services. */
  usedBy: z.array(
    z.object({ id: z.string(), name: z.string(), running: z.boolean(), kind: z.enum(['node', 'electrum']) }),
  ),
});
export type TorStatus = z.infer<typeof TorStatusSchema>;

export const TorSettingsChangeSchema = z.object({ autoStart: z.boolean() }).strict();
export type TorSettingsChange = z.infer<typeof TorSettingsChangeSchema>;

/**
 * How a node reaches its peers (privacy-networking.md §2.21):
 * - `off`: directly; peers see this computer's IP address.
 * - `onion-peers`: directly, plus onion peers through Tor.
 * - `all-traffic`: every connection through Tor, name lookups included.
 * - `tor-only`: onion peers only.
 * - `custom`: the configuration routes in a way BTCortex did not set up.
 */
export const NodeTorModeSchema = z.enum(['off', 'onion-peers', 'all-traffic', 'tor-only', 'custom']);
export type NodeTorMode = z.infer<typeof NodeTorModeSchema>;

export const NodeNetworkReachSchema = z.object({
  name: z.string(),
  reachable: z.boolean(),
  /** The proxy Bitcoin Core uses for this network, if any. */
  proxy: z.string(),
});

export const NodePrivacySchema = z.object({
  mode: NodeTorModeSchema,
  /** Peers can reach the node through its own onion service. `null`: set up in a way BTCortex did not. */
  onionService: z.boolean().nullable(),
  /** The node's onion address, once Bitcoin Core has published it. */
  onionAddress: z.string().nullable(),
  /** Transactions sent through the node leave over short-lived Tor connections (Bitcoin Core 31.1 and later). */
  privateBroadcast: z.boolean(),
  privateBroadcastSupported: z.boolean(),
  /** BTCortex can change this node's routing: it set the node up and can write its configuration. */
  manageable: z.boolean(),
  /** Why the node's routing can only be shown, if so. */
  readOnlyReason: z.string().optional(),
  /** What Bitcoin Core reports for each network, when the node answers. */
  networks: z.array(NodeNetworkReachSchema),
  /** The routing in bitcoin.conf is not the one the running node uses yet. */
  restartRequired: z.boolean(),
  /** The node also reaches I2P peers, through the I2P router on this computer (i2psam). */
  i2p: z.boolean(),
});
export type NodePrivacy = z.infer<typeof NodePrivacySchema>;

/** Where i2pd and the Java I2P router offer their SAM bridge by default. */
export const I2P_SAM_ADDRESS = '127.0.0.1:7656';

/**
 * An I2P router on this computer — i2pd or the Java I2P router, installed
 * and run by the user — found by its SAM bridge, which Bitcoin Core uses for
 * I2P peers. BTCortex does not install or run it.
 */
export const I2pRouterStatusSchema = z.object({
  /** The SAM bridge answered. */
  available: z.boolean(),
  /** Where Bitcoin Core is pointed, for example 127.0.0.1:7656. */
  samAddress: z.string(),
  /** The SAM version the bridge offers, for example 3.1. */
  samVersion: z.string().nullable(),
  /** The program listening there, as Windows names its process. */
  program: z.string().nullable(),
  /**
   * A router found by its console while its SAM bridge does not answer: the
   * Java router's bridge is off until turned on, and i2pd opens its bridge
   * once it has joined the I2P network.
   */
  runningWithoutSam: z.enum(['i2pd', 'java-i2p']).nullable(),
  checkedAt: z.string(),
  error: z.string().nullable(),
});
export type I2pRouterStatus = z.infer<typeof I2pRouterStatusSchema>;

export const NodePrivacyChangeSchema = z
  .object({
    mode: NodeTorModeSchema.exclude(['custom']),
    onionService: z.boolean(),
    privateBroadcast: z.boolean(),
    /** Also reach I2P peers through the router on this computer; left out, it stays as it is. */
    i2p: z.boolean().optional(),
  })
  .strict();
export type NodePrivacyChange = z.infer<typeof NodePrivacyChangeSchema>;

export const ConfigurePrivacyResultSchema = z.object({
  changedKeys: z.array(z.string()),
  restarting: z.boolean(),
});
export type ConfigurePrivacyResult = z.infer<typeof ConfigurePrivacyResultSchema>;
