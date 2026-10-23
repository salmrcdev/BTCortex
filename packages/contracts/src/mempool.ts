import { z } from 'zod';

// Mempool analysis (specification section 5.9). Everything here is this
// node's own view: other nodes can hold different transactions, so nothing is
// presented as the state of the whole network.

export const FeeRateBucketSchema = z.object({
  /** Lower edge, sat/vB (inclusive). */
  minimum: z.number().nonnegative(),
  /** Upper edge, sat/vB (exclusive); `null` for the open-ended top bucket. */
  maximum: z.number().nonnegative().nullable(),
  virtualBytes: z.number().nonnegative(),
  feeSats: z.number().nonnegative(),
});
export type FeeRateBucket = z.infer<typeof FeeRateBucketSchema>;

export const FeeEstimateSchema = z.object({
  /** Confirmation target in blocks. */
  target: z.number().int().positive(),
  /** `null` when the node has too little data, for example right after it started. */
  satPerVb: z.number().nonnegative().nullable(),
  /** The target the estimate was actually made for. */
  blocks: z.number().int().positive().nullable(),
});
export type FeeEstimate = z.infer<typeof FeeEstimateSchema>;

/** Relay features that depend on the Bitcoin Core version rather than on settings. */
export const PolicyFeatureIdSchema = z.enum([
  'package-relay',
  'truc',
  'pay-to-anchor',
  'ephemeral-dust',
  'cluster-mempool',
]);
export type PolicyFeatureId = z.infer<typeof PolicyFeatureIdSchema>;

export const PolicyFeatureSchema = z.object({
  id: PolicyFeatureIdSchema,
  supported: z.boolean(),
  /** The Bitcoin Core release that introduced it, for example "28.0". */
  since: z.string(),
});
export type PolicyFeature = z.infer<typeof PolicyFeatureSchema>;

export const MempoolOverviewSchema = z.object({
  loaded: z.boolean(),
  transactions: z.number().int().nonnegative(),
  virtualBytes: z.number().nonnegative(),
  memoryUsageBytes: z.number().nonnegative(),
  maxMemoryBytes: z.number().nonnegative(),
  totalFeeBtc: z.number().nonnegative(),
  minimumFeeSatPerVb: z.number().nonnegative(),
  minimumRelayFeeSatPerVb: z.number().nonnegative(),
  incrementalRelayFeeSatPerVb: z.number().nonnegative(),
  unbroadcast: z.number().int().nonnegative(),
  /** Replacements are accepted without BIP 125 signalling. */
  fullRbf: z.boolean(),
  clusterLimitCount: z.number().int().optional(),
  clusterLimitVirtualBytes: z.number().int().optional(),
  maxDataCarrierBytes: z.number().int().optional(),
  /** `null` when the node offers no fee-rate diagram (versions before 31.0, other implementations). */
  feeRateBuckets: z.array(FeeRateBucketSchema).nullable(),
  /** Lowest fee rate in the first block's worth of the mempool; `null` when everything fits in one block. */
  nextBlockMinimumSatPerVb: z.number().nonnegative().nullable(),
  estimates: z.array(FeeEstimateSchema),
  /** `null` for implementations other than Bitcoin Core, whose features cannot be told from the version. */
  policyFeatures: z.array(PolicyFeatureSchema).nullable(),
});
export type MempoolOverview = z.infer<typeof MempoolOverviewSchema>;

const PackageSchema = z.object({
  count: z.number().int().nonnegative(),
  virtualBytes: z.number().nonnegative(),
  feeSats: z.number().nonnegative(),
});

export const ClusterChunkSchema = z.object({
  feeSats: z.number().nonnegative(),
  weight: z.number().nonnegative(),
  satPerVb: z.number().nonnegative(),
  txids: z.array(z.string()),
});

export const MempoolTransactionSchema = z.object({
  txid: z.string(),
  wtxid: z.string(),
  virtualBytes: z.number().nonnegative(),
  weight: z.number().nonnegative(),
  feeSats: z.number().nonnegative(),
  satPerVb: z.number().nonnegative(),
  /** Unix time the node first saw it. */
  seenAt: z.number().int(),
  heightWhenSeen: z.number().int(),
  ancestors: PackageSchema,
  descendants: PackageSchema,
  /** The chunk it will be mined with under the cluster mempool: the fee rate that really counts (CPFP). */
  chunk: z.object({ feeSats: z.number().nonnegative(), weight: z.number().nonnegative(), satPerVb: z.number() }),
  parents: z.array(z.string()),
  children: z.array(z.string()),
  replaceable: z.boolean(),
  /** What a replacement of the same size must at least pay; `null` when it cannot be replaced. */
  replacement: z
    .object({
      minimumFeeSats: z.number().int().nonnegative(),
      minimumSatPerVb: z.number().nonnegative(),
      /** Fees of this transaction and its descendants, which a replacement must exceed. */
      replacedFeeSats: z.number().int().nonnegative(),
      /** Descendants that a replacement would also remove from the mempool. */
      evicts: z.number().int().nonnegative(),
      /** The cluster mempool also requires a replacement to improve the fee-rate diagram (31.0+). */
      mustImproveDiagram: z.boolean(),
    })
    .nullable(),
  unbroadcast: z.boolean(),
  cluster: z
    .object({ transactions: z.number().int(), weight: z.number(), chunks: z.array(ClusterChunkSchema) })
    .optional(),
  inputs: z.number().int().nonnegative(),
  outputs: z.array(
    z.object({
      index: z.number().int(),
      valueSats: z.number().nonnegative(),
      address: z.string().optional(),
      type: z.string(),
    }),
  ),
});
export type MempoolTransaction = z.infer<typeof MempoolTransactionSchema>;

export const MetricsPointSchema = z.object({
  at: z.iso.datetime(),
  blocks: z.number().int(),
  peers: z.number().int(),
  mempoolTransactions: z.number().int(),
  mempoolVirtualBytes: z.number().nonnegative(),
  mempoolMinimumFeeSatPerVb: z.number().nonnegative(),
});
export type MetricsPoint = z.infer<typeof MetricsPointSchema>;
