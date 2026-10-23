import { z } from 'zod';

// Bitcoin developer tools (specification sections 15 and 24.1, area 21):
// PSBT and descriptor analysis by the node itself, the protocol features a
// node supports with what kind of rule each is, regtest block generation, and
// probes of service endpoints. Transactions and scripts are decoded by the
// explorer's own methods.

/** Kept apart as the specification asks: consensus, relay policy, wallet policy, experimental, implementation-specific. */
export const ProtocolFeatureCategorySchema = z.enum([
  'consensus',
  'relay-policy',
  'wallet-policy',
  'experimental',
  'implementation',
]);
export type ProtocolFeatureCategory = z.infer<typeof ProtocolFeatureCategorySchema>;

export const ProtocolFeatureSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: ProtocolFeatureCategorySchema,
  /** `on`: in force on this node; `off`: available but not switched on; `unavailable`: this version or build lacks it; `unknown`: the node did not say. */
  state: z.enum(['on', 'off', 'unavailable', 'unknown']),
  detail: z.string(),
  /** The Bitcoin Core version that brought it, where it matters. */
  since: z.string().nullable(),
});
export type ProtocolFeature = z.infer<typeof ProtocolFeatureSchema>;

export const ProtocolFeaturesSchema = z.object({
  nodeId: z.string(),
  version: z.string().nullable(),
  features: z.array(ProtocolFeatureSchema),
});
export type ProtocolFeatures = z.infer<typeof ProtocolFeaturesSchema>;

export const PsbtAnalysisSchema = z.object({
  txid: z.string().nullable(),
  version: z.number().int().nullable(),
  locktime: z.number().int().nullable(),
  inputs: z.array(
    z.object({
      outpoint: z.string(),
      /** The coin it spends, when the PSBT carries it. */
      amountSats: z.number().int().nullable(),
      hasUtxo: z.boolean(),
      partialSignatures: z.number().int(),
      final: z.boolean(),
      /** What the input still needs, as analyzepsbt reports it: signatures, keys, the coin. */
      missing: z.array(z.string()),
      next: z.string().nullable(),
    }),
  ),
  outputs: z.array(
    z.object({ address: z.string().nullable(), amountSats: z.number().int(), script: z.string().nullable() }),
  ),
  feeSats: z.number().int().nullable(),
  estimatedVsize: z.number().int().nullable(),
  estimatedFeeRateSatPerVb: z.number().nullable(),
  /** The role that comes next: updater, signer, finalizer or extractor. */
  next: z.string().nullable(),
  /** decodepsbt's own answer, for inspection. */
  raw: z.unknown(),
});
export type PsbtAnalysis = z.infer<typeof PsbtAnalysisSchema>;

export const DescriptorAnalysisSchema = z.object({
  /** The descriptor with its checksum, as the node normalises it. */
  descriptor: z.string(),
  checksum: z.string(),
  isRange: z.boolean(),
  isSolvable: z.boolean(),
  /** Addresses derived from it: the first ones of a ranged descriptor, or its only one. */
  addresses: z.array(z.object({ index: z.number().int().nullable(), address: z.string() })),
  /** Why no addresses could be derived, if so (for example a descriptor with no address, such as raw()). */
  addressesError: z.string().nullable(),
});
export type DescriptorAnalysis = z.infer<typeof DescriptorAnalysisSchema>;

export const MinedBlocksSchema = z.object({ hashes: z.array(z.string()), height: z.number().int() });
export type MinedBlocks = z.infer<typeof MinedBlocksSchema>;

export const ProbeKindSchema = z.enum(['tcp', 'http', 'electrum', 'bitcoin-rpc']);
export type ProbeKind = z.infer<typeof ProbeKindSchema>;

export const ProbeParamsSchema = z
  .object({
    kind: ProbeKindSchema,
    host: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9.\-:[\]]+$/, 'A host name or address.'),
    port: z.number().int().min(1).max(65_535),
    /** TLS for HTTP and Electrum. */
    tls: z.boolean(),
    /** Through BTCortex's tor; required for onion addresses. */
    viaTor: z.boolean(),
    /** The path for HTTP probes. */
    path: z
      .string()
      .max(512)
      .regex(/^\/[\x21-\x7e]*$/)
      .optional(),
  })
  .strict();
export type ProbeParams = z.infer<typeof ProbeParamsSchema>;

export const ProbeResultSchema = z.object({
  reachable: z.boolean(),
  /** Each step with how long it took: name lookup, connection, TLS, the protocol's answer. */
  steps: z.array(z.object({ name: z.string(), ok: z.boolean(), durationMs: z.number(), detail: z.string() })),
  /** What the service said, shortened. */
  answer: z.string().nullable(),
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

export const ZmqNotificationSchema = z.object({
  /** As getzmqnotifications names it, for example `pubhashblock`. */
  type: z.string(),
  address: z.string(),
  hwm: z.number().int().nullable(),
});
export type ZmqNotification = z.infer<typeof ZmqNotificationSchema>;

export const ZmqStatusSchema = z.object({
  nodeId: z.string(),
  notifications: z.array(ZmqNotificationSchema),
  watching: z.boolean(),
  /** Why the node's notifications cannot be watched from here, if so. */
  unavailableReason: z.string().nullable(),
});
export type ZmqStatus = z.infer<typeof ZmqStatusSchema>;

export const ZmqEventViewSchema = z.object({
  at: z.string(),
  kind: z.enum(['block', 'transaction', 'raw-block', 'raw-transaction', 'mempool']),
  change: z.enum(['block-connected', 'block-disconnected', 'transaction-added', 'transaction-removed']).nullable(),
  hash: z.string().nullable(),
  bytes: z.number().int().nullable(),
});
export type ZmqEventView = z.infer<typeof ZmqEventViewSchema>;

/** What arrived in about a second, published while a node is watched. */
export const ZmqBatchSchema = z.object({
  nodeId: z.string(),
  /** The latest events, at most 50, oldest first. */
  events: z.array(ZmqEventViewSchema),
  /** Everything that arrived, by kind and change, including what is not listed. */
  counts: z.record(z.string(), z.number().int()),
  /** Notifications the publisher numbered but that never arrived. */
  missed: z.number().int(),
  /** Why watching ended, when it did. */
  stopped: z.string().nullable(),
});
export type ZmqBatch = z.infer<typeof ZmqBatchSchema>;
