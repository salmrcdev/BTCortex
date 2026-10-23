import { z } from 'zod';

// Storage and indexing (specification section 5.10): where a node keeps its
// data, how much room is left, how it prunes and which indexes it builds.
// Folder sizes are only known for nodes whose files are on this computer.

export const DiskKindSchema = z.enum(['ssd', 'hdd', 'unknown']);
export type DiskKind = z.infer<typeof DiskKindSchema>;

export const VolumeSchema = z.object({
  /** For example `C:\`. */
  root: z.string(),
  totalBytes: z.number().nonnegative(),
  freeBytes: z.number().nonnegative(),
  kind: DiskKindSchema,
  /** As Windows reports it, for example "NVMe", "SATA" or "USB"; `null` when unknown. */
  bus: z.string().nullable(),
  model: z.string().nullable(),
});
export type Volume = z.infer<typeof VolumeSchema>;

export const StoragePartIdSchema = z.enum([
  'blocks',
  'chainstate',
  'txindex',
  'blockfilterindex',
  'coinstatsindex',
  'txospenderindex',
  'old-coinstatsindex',
  'wallets',
  'other',
]);
export type StoragePartId = z.infer<typeof StoragePartIdSchema>;

export const StoragePartSchema = z.object({ id: StoragePartIdSchema, bytes: z.number().nonnegative() });
export type StoragePart = z.infer<typeof StoragePartSchema>;

export const IndexIdSchema = z.enum(['txindex', 'blockfilterindex', 'coinstatsindex', 'txospenderindex']);
export type IndexId = z.infer<typeof IndexIdSchema>;

export const IndexStatusSchema = z.object({
  id: IndexIdSchema,
  enabled: z.boolean(),
  synced: z.boolean(),
  /** Height the index has reached; `null` when it is not enabled. */
  bestBlockHeight: z.number().int().nullable(),
  /** Size of its folder; `null` when the files are not on this computer. */
  bytes: z.number().nonnegative().nullable(),
});
export type IndexStatus = z.infer<typeof IndexStatusSchema>;

export const StorageWarningSchema = z.object({
  code: z.enum([
    /** Bitcoin Core stops when less than 50 MiB is left. */
    'disk-critical',
    'disk-low',
    /** An unpruned node that is still downloading will run out of room. */
    'chain-will-not-fit',
    'hard-disk',
    'external-drive',
    /** An index folder is on disk while the index is switched off. */
    'unused-index',
  ]),
  severity: z.enum(['info', 'warning', 'danger']),
  bytes: z.number().nonnegative().optional(),
  part: StoragePartIdSchema.optional(),
});
export type StorageWarning = z.infer<typeof StorageWarningSchema>;

export const StorageLocationSchema = z.object({
  id: z.enum(['bitcoin-core', 'btcortex', 'sparrow']),
  path: z.string(),
  /** `null` when it was not measured. */
  bytes: z.number().nonnegative().nullable(),
});
export type StorageLocation = z.infer<typeof StorageLocationSchema>;

export const StorageOverviewSchema = z.object({
  /** The node's files are on this computer, so folders and the disk can be measured. */
  local: z.boolean(),
  /** BTCortex set this node up, so it may change its indexes and pruning; other nodes stay read-only. */
  manageable: z.boolean(),
  /**
   * What bitcoin.conf asks for, which the running node may not use yet; `null` when the file
   * cannot be read here.
   */
  configured: z
    .object({
      indexes: z.record(IndexIdSchema, z.boolean()),
      /** 0 for a full node, 1 for manual pruning, otherwise the target in MiB. */
      pruneMiB: z.number().int().nonnegative(),
    })
    .nullable(),
  /** The folder of this network (the data directory itself for mainnet). */
  networkDirectory: z.string().nullable(),
  volume: VolumeSchema.nullable(),
  /** Bitcoin Core's own figure for block and undo files. */
  blockFilesBytes: z.number().nonnegative(),
  breakdown: z.array(StoragePartSchema).nullable(),
  chain: z.object({
    height: z.number().int().nonnegative(),
    headers: z.number().int().nonnegative(),
    initialBlockDownload: z.boolean(),
  }),
  /** Estimated size of the complete chain and chainstate of this network; `null` for regtest. */
  expectedFullBytes: z.number().nonnegative().nullable(),
  pruning: z.object({
    enabled: z.boolean(),
    /** `false` in manual mode (`prune=1`), where blocks go only with `pruneblockchain`. */
    automatic: z.boolean(),
    targetBytes: z.number().nonnegative().nullable(),
    /** Lowest height whose block is still kept. */
    pruneHeight: z.number().int().nonnegative().nullable(),
    /** Unix time of that block. */
    pruneTime: z.number().int().nullable(),
  }),
  indexes: z.array(IndexStatusSchema),
  wallets: z.object({ count: z.number().int().nonnegative(), bytes: z.number().nonnegative() }).nullable(),
  locations: z.array(StorageLocationSchema),
  warnings: z.array(StorageWarningSchema),
});
export type StorageOverview = z.infer<typeof StorageOverviewSchema>;

/** Bitcoin Core's smallest prune target. */
export const MIN_PRUNE_TARGET_MIB = 550;

export const StorageChangeSchema = z
  .object({
    indexes: z.partialRecord(IndexIdSchema, z.boolean()).optional(),
    pruning: z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('off') }),
        z.object({ mode: z.literal('automatic'), targetMiB: z.number().int().min(MIN_PRUNE_TARGET_MIB) }),
      ])
      .optional(),
  })
  .refine((change) => change.indexes !== undefined || change.pruning !== undefined, {
    message: 'Nothing to change.',
  });
export type StorageChange = z.infer<typeof StorageChangeSchema>;

export const ConfigureStorageResultSchema = z.object({
  changedKeys: z.array(z.string()),
  /** The previous bitcoin.conf, kept next to it. */
  backup: z.string().nullable(),
  /** The node is being restarted so that the change takes effect. */
  restarting: z.boolean(),
  /** The restart rebuilds the block index and downloads the chain again. */
  reindexing: z.boolean(),
});
export type ConfigureStorageResult = z.infer<typeof ConfigureStorageResultSchema>;

export const ChainVerificationSchema = z.object({
  valid: z.boolean(),
  /** Bitcoin Core's thoroughness level (0 to 4). */
  checkLevel: z.number().int(),
  blocks: z.number().int(),
  durationMs: z.number().nonnegative(),
});
export type ChainVerification = z.infer<typeof ChainVerificationSchema>;

export const ReindexScopeSchema = z.enum(['chainstate', 'full']);
export type ReindexScope = z.infer<typeof ReindexScopeSchema>;
