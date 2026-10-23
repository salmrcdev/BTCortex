import { z } from 'zod';
import { AppErrorSchema } from './errors';

// Lightning nodes BTCortex connects to (specification section 11;
// docs/research/notes/lightning.md): LND, on this computer or another, over
// its REST interface with a macaroon kept in the vault and its certificate
// pinned. BTCortex reads the node and saves its channel backups; it never
// moves funds, opens or closes channels.

export const LightningImplementationSchema = z.enum(['lnd']);
export type LightningImplementation = z.infer<typeof LightningImplementationSchema>;

export const LightningNetworkSchema = z.enum(['mainnet', 'testnet', 'testnet4', 'signet', 'regtest', 'simnet']);
export type LightningNetwork = z.infer<typeof LightningNetworkSchema>;

/**
 * What the connection's macaroon allows:
 * - `read-only`: reads only, which is all BTCortex needs.
 * - `invoices`: can also create invoices and addresses.
 * - `admin`: can also spend on-chain and over Lightning.
 * - `custom`: some other set of permissions that writes.
 */
export const MacaroonAccessSchema = z.enum(['read-only', 'invoices', 'admin', 'custom']);
export type MacaroonAccess = z.infer<typeof MacaroonAccessSchema>;

export const MacaroonSummarySchema = z.object({
  access: MacaroonAccessSchema,
  permissions: z.array(z.object({ entity: z.string(), actions: z.array(z.string()) })),
  caveats: z.array(z.string()),
  expiresAt: z.string().optional(),
});
export type MacaroonSummary = z.infer<typeof MacaroonSummarySchema>;

export const LightningConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  implementation: LightningImplementationSchema,
  /** `host:port` of the REST interface. */
  restAddress: z.string(),
  /** `tor`: an onion address, reached through BTCortex's tor. */
  via: z.enum(['direct', 'tor']),
  /** SHA-256 fingerprint of the pinned certificate; null when the system's certificate authorities are trusted. */
  certificateFingerprint: z.string().nullable(),
  /** When the pinned certificate expires; LND makes a new one when it restarts after that, which must then be given again. */
  certificateExpiresAt: z.string().nullable(),
  macaroon: MacaroonSummarySchema,
  /** Made from the LND found on this computer. */
  local: z.boolean(),
  createdAt: z.string(),
});
export type LightningConnection = z.infer<typeof LightningConnectionSchema>;

/**
 * - `checking`: not asked yet.
 * - `ready`: answers and is in step with the chain.
 * - `syncing`: answers, but is still catching up with the chain or the network graph.
 * - `locked`: LND runs, but its wallet is locked or not created; it must be unlocked in LND.
 * - `unreachable`: nothing answers at the address.
 * - `unauthorised`: LND refused the macaroon, or presented a different certificate.
 * - `failed`: anything else; `error` says what.
 */
export const LightningStateSchema = z.enum([
  'checking',
  'ready',
  'syncing',
  'locked',
  'unreachable',
  'unauthorised',
  'failed',
]);
export type LightningState = z.infer<typeof LightningStateSchema>;

export const LightningStatusSchema = z.object({
  connectionId: z.string(),
  state: LightningStateSchema,
  checkedAt: z.string().nullable(),
  error: AppErrorSchema.optional(),
  /** What LND says about its wallet: NON_EXISTING, LOCKED, UNLOCKED, RPC_ACTIVE, SERVER_ACTIVE, WAITING_TO_START. */
  walletState: z.string().nullable(),
  alias: z.string().nullable(),
  pubkey: z.string().nullable(),
  network: LightningNetworkSchema.nullable(),
  version: z.string().nullable(),
  blockHeight: z.number().int().nullable(),
  syncedToChain: z.boolean(),
  syncedToGraph: z.boolean(),
  activeChannels: z.number().int(),
  inactiveChannels: z.number().int(),
  pendingChannels: z.number().int(),
  peers: z.number().int(),
});
export type LightningStatus = z.infer<typeof LightningStatusSchema>;

export const LightningConnectionWithStatusSchema = z.object({
  connection: LightningConnectionSchema,
  status: LightningStatusSchema,
});
export type LightningConnectionWithStatus = z.infer<typeof LightningConnectionWithStatusSchema>;

export const LightningChannelSchema = z.object({
  id: z.string(),
  channelPoint: z.string(),
  remotePubkey: z.string(),
  /** The peer's alias from the network graph, when known. */
  peerAlias: z.string().nullable(),
  active: z.boolean(),
  private: z.boolean(),
  initiator: z.boolean(),
  capacitySats: z.number(),
  localSats: z.number(),
  remoteSats: z.number(),
  localReserveSats: z.number(),
  remoteReserveSats: z.number(),
  commitFeeSats: z.number(),
  unsettledSats: z.number(),
  sentSats: z.number(),
  receivedSats: z.number(),
  pendingHtlcs: z.array(z.object({ incoming: z.boolean(), amountSats: z.number(), expiryHeight: z.number() })),
  commitmentType: z.string(),
  csvDelay: z.number().int(),
  uptimeSeconds: z.number(),
  lifetimeSeconds: z.number(),
  /** This node's routing fee on the channel. */
  baseFeeMsat: z.number().nullable(),
  feePpm: z.number().nullable(),
});
export type LightningChannel = z.infer<typeof LightningChannelSchema>;

export const LightningPendingChannelSchema = z.object({
  kind: z.enum(['opening', 'closing', 'force-closing']),
  channelPoint: z.string(),
  remotePubkey: z.string(),
  capacitySats: z.number(),
  localSats: z.number(),
  remoteSats: z.number(),
  initiator: z.enum(['local', 'remote', 'both', 'unknown']),
  confirmationsUntilActive: z.number().int().optional(),
  closingTxid: z.string().optional(),
  limboSats: z.number().optional(),
  maturityHeight: z.number().int().optional(),
  blocksUntilMaturity: z.number().int().optional(),
});
export type LightningPendingChannel = z.infer<typeof LightningPendingChannelSchema>;

export const LightningPeerSchema = z.object({
  pubkey: z.string(),
  alias: z.string().nullable(),
  address: z.string(),
  inbound: z.boolean(),
  bytesSent: z.number(),
  bytesReceived: z.number(),
  satsSent: z.number(),
  satsReceived: z.number(),
  pingMicros: z.number().nullable(),
  syncType: z.string(),
  flapCount: z.number().int(),
});
export type LightningPeer = z.infer<typeof LightningPeerSchema>;

export const LightningForwardSchema = z.object({
  at: z.string().nullable(),
  channelIn: z.string(),
  channelOut: z.string(),
  peerAliasIn: z.string().nullable(),
  peerAliasOut: z.string().nullable(),
  amountInSats: z.number(),
  amountOutSats: z.number(),
  feeMsat: z.number(),
});
export type LightningForward = z.infer<typeof LightningForwardSchema>;

export const LightningInvoiceSchema = z.object({
  paymentHash: z.string(),
  memo: z.string(),
  valueSats: z.number(),
  paidSats: z.number(),
  state: z.enum(['OPEN', 'SETTLED', 'CANCELED', 'ACCEPTED']),
  createdAt: z.string().nullable(),
  settledAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  private: z.boolean(),
  keysend: z.boolean(),
});
export type LightningInvoice = z.infer<typeof LightningInvoiceSchema>;

export const LightningPaymentSchema = z.object({
  paymentHash: z.string(),
  valueSats: z.number(),
  feeMsat: z.number(),
  status: z.enum(['IN_FLIGHT', 'SUCCEEDED', 'FAILED', 'INITIATED', 'UNKNOWN']),
  createdAt: z.string().nullable(),
  failureReason: z.string().nullable(),
  destination: z.string().nullable(),
  hops: z.number().int().nullable(),
});
export type LightningPayment = z.infer<typeof LightningPaymentSchema>;

/**
 * Things worth the operator's attention, worked out from what the node reports:
 * - `not-synced`: the node is behind the chain or the network graph.
 * - `inactive-channels`: channels whose peer is offline cannot route or pay.
 * - `low-outbound`: a channel can hardly send (little of it is on this node's side).
 * - `low-inbound`: a channel can hardly receive.
 * - `force-closing`: funds wait for a time lock after a force close.
 * - `admin-macaroon`: the connection's macaroon can move funds, more than BTCortex needs.
 * - `macaroon-expiring`: the macaroon stops working within a week.
 * - `certificate-expiring`: the pinned TLS certificate expires within 30 days.
 * - `no-channel-backup`: channels exist, but BTCortex has not saved their backup yet.
 */
export const LightningWarningSchema = z.object({
  code: z.enum([
    'not-synced',
    'inactive-channels',
    'low-outbound',
    'low-inbound',
    'force-closing',
    'admin-macaroon',
    'macaroon-expiring',
    'certificate-expiring',
    'no-channel-backup',
  ]),
  severity: z.enum(['info', 'warning']),
  message: z.string(),
  /** The channels concerned, when the warning is about channels. */
  channelIds: z.array(z.string()).optional(),
});
export type LightningWarning = z.infer<typeof LightningWarningSchema>;

export const ChannelBackupRecordSchema = z.object({
  path: z.string(),
  savedAt: z.string(),
  channels: z.number().int(),
  bytes: z.number().int(),
});
export type ChannelBackupRecord = z.infer<typeof ChannelBackupRecordSchema>;

export const LightningDashboardSchema = z.object({
  connection: LightningConnectionSchema,
  status: LightningStatusSchema,
  info: z.object({
    pubkey: z.string(),
    alias: z.string(),
    color: z.string(),
    version: z.string(),
    commitHash: z.string(),
    network: LightningNetworkSchema.nullable(),
    blockHeight: z.number().int(),
    blockHash: z.string(),
    bestHeaderAt: z.string().nullable(),
    syncedToChain: z.boolean(),
    syncedToGraph: z.boolean(),
    uris: z.array(z.string()),
    features: z.array(z.object({ bit: z.number().int(), name: z.string(), required: z.boolean() })),
  }),
  balances: z.object({
    onChain: z.object({
      confirmedSats: z.number(),
      unconfirmedSats: z.number(),
      lockedSats: z.number(),
      reservedForAnchorsSats: z.number(),
    }),
    channels: z.object({
      localSats: z.number(),
      remoteSats: z.number(),
      unsettledLocalSats: z.number(),
      unsettledRemoteSats: z.number(),
      pendingOpenLocalSats: z.number(),
      pendingOpenRemoteSats: z.number(),
    }),
  }),
  channels: z.array(LightningChannelSchema),
  pending: z.object({ limboSats: z.number(), channels: z.array(LightningPendingChannelSchema) }),
  peers: z.array(LightningPeerSchema),
  routing: z.object({
    /** Fees earned by forwarding, as LND sums them. */
    feesDaySats: z.number(),
    feesWeekSats: z.number(),
    feesMonthSats: z.number(),
    /** Forwards over the last 30 days. */
    forwards30Days: z.number().int(),
    forwardedSats30Days: z.number(),
    recentForwards: z.array(LightningForwardSchema),
  }),
  invoices: z.array(LightningInvoiceSchema),
  payments: z.array(LightningPaymentSchema),
  graph: z.object({ nodes: z.number().int(), channels: z.number().int(), capacitySats: z.number() }).nullable(),
  watchtowers: z
    .object({ clientActive: z.boolean(), towers: z.number().int(), activeTowers: z.number().int() })
    .nullable(),
  backup: ChannelBackupRecordSchema.nullable(),
  warnings: z.array(LightningWarningSchema),
  /** Parts the macaroon does not allow BTCortex to read, or that failed, and why. */
  unavailable: z.array(z.object({ part: z.string(), reason: z.string() })),
});
export type LightningDashboard = z.infer<typeof LightningDashboardSchema>;

export const LocalLightningNodeSchema = z.object({
  implementation: LightningImplementationSchema,
  directory: z.string(),
  network: LightningNetworkSchema.nullable(),
  restAddress: z.string().nullable(),
  tlsCertificateFound: z.boolean(),
  /** The macaroons found for the network, least powerful first. */
  macaroons: z.array(z.object({ kind: z.enum(['readonly', 'invoice', 'admin']), access: MacaroonAccessSchema })),
  /** Whether BTCortex is already connected to it. */
  connectionId: z.string().nullable(),
  /** Whether something answers at its REST address right now. */
  running: z.boolean(),
});
export type LocalLightningNode = z.infer<typeof LocalLightningNodeSchema>;

const NameSchema = z.string().trim().min(1).max(60);

/**
 * How to reach the node:
 * - `local`: the LND found on this computer, with one of its macaroons.
 * - `files`: a REST address with a certificate file and a macaroon file.
 * - `lndconnect`: an lndconnect:// address, as node packages show them.
 */
export const LightningSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), macaroon: z.enum(['readonly', 'invoice', 'admin']) }).strict(),
  z
    .object({
      kind: z.literal('files'),
      restAddress: z.string().trim().min(1),
      /** Omitted for a node whose certificate is publicly trusted. */
      tlsCertificatePath: z.string().trim().min(1).optional(),
      macaroonPath: z.string().trim().min(1),
    })
    .strict(),
  z.object({ kind: z.literal('lndconnect'), uri: z.string().trim().min(1) }).strict(),
]);
export type LightningSource = z.infer<typeof LightningSourceSchema>;

export const AddLightningParamsSchema = z
  .object({
    name: NameSchema,
    source: LightningSourceSchema,
    /** Required for a macaroon that can move funds, after BTCortex has said that a read-only one is enough. */
    acceptSpendingMacaroon: z.boolean().optional(),
  })
  .strict();
export type AddLightningParams = z.infer<typeof AddLightningParamsSchema>;
