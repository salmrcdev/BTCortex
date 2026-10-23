import { z } from 'zod';

// Storage across everything BTCortex keeps (specification section 27): each
// folder it manages or reads with the service that owns it and its size, the
// volumes they are on, safe clean-ups of BTCortex's own leftovers, and how fast
// each node's block files grow where enough measurements exist. Blockchain,
// wallet and user files are never deleted from here.

export const ManagedFolderOwnerSchema = z.enum([
  'btcortex',
  'node',
  'external-node',
  'electrum',
  'tor',
  'software',
  'logs',
  'downloads',
  'temporary',
  'exports',
  'backups',
  'lightning',
  /** Wallets of the Electrum copy BTCortex installed. */
  'electrum-wallets',
  /** Not used by BTCortex: shown because their virtual disks can be large. */
  'wsl',
  'docker',
]);
export type ManagedFolderOwner = z.infer<typeof ManagedFolderOwnerSchema>;

export const CleanupKindSchema = z.enum(['interrupted-downloads', 'temporary-files']);
export type CleanupKind = z.infer<typeof CleanupKindSchema>;

export const ManagedFolderSchema = z.object({
  id: z.string(),
  /** The folder, or for a virtual disk its file. */
  path: z.string(),
  owner: ManagedFolderOwnerSchema,
  /** The service by name, such as a node's name. */
  ownerName: z.string(),
  /** Where the owner's page is, when it has one. */
  route: z.string().nullable(),
  /** Null when it could not be measured. */
  bytes: z.number().nonnegative().nullable(),
  /** Read but never changed by BTCortex, such as Bitcoin Core installed before it. */
  readOnly: z.boolean(),
  /** What BTCortex can safely remove here now, if anything. */
  cleanup: z
    .object({ kind: CleanupKindSchema, bytes: z.number().nonnegative(), files: z.number().int().nonnegative() })
    .nullable(),
});
export type ManagedFolder = z.infer<typeof ManagedFolderSchema>;

export const StorageVolumeSchema = z.object({
  root: z.string(),
  totalBytes: z.number().nonnegative(),
  freeBytes: z.number().nonnegative(),
  kind: z.enum(['ssd', 'hdd', 'unknown']),
  /** Ids of the folders on this volume. */
  folders: z.array(z.string()),
});
export type StorageVolume = z.infer<typeof StorageVolumeSchema>;

export const StorageForecastSchema = z.object({
  nodeId: z.string(),
  name: z.string(),
  volume: z.string(),
  /** Growth of the block files, from BTCortex's own measurements. */
  growthBytesPerDay: z.number(),
  /** At that pace; null when the files do not grow. */
  daysUntilFull: z.number().nonnegative().nullable(),
  measuredDays: z.number().nonnegative(),
});
export type StorageForecast = z.infer<typeof StorageForecastSchema>;

export const DiskUsageSchema = z.object({
  measuredAt: z.string(),
  volumes: z.array(StorageVolumeSchema),
  folders: z.array(ManagedFolderSchema),
  forecasts: z.array(StorageForecastSchema),
  /** Why a clean-up is not possible right now, such as a job using those files. */
  cleanupBlockedBy: z.string().nullable(),
});
export type DiskUsage = z.infer<typeof DiskUsageSchema>;

export const CleanupResultSchema = z.object({
  kind: CleanupKindSchema,
  files: z.number().int().nonnegative(),
  freedBytes: z.number().nonnegative(),
});
export type CleanupResult = z.infer<typeof CleanupResultSchema>;
