import { z } from 'zod';
import { AppErrorSchema } from './errors';
import { BitcoinNetworkSchema, NodeImplementationSchema } from './nodes';

// Zero-touch set-up: BTCortex proposes one plan, the user approves it once,
// and a job carries it out (specification sections 18 and 25).

export const NodeUsageSchema = z.enum(['general', 'wallet-backend', 'electrum-backend']);
export type NodeUsage = z.infer<typeof NodeUsageSchema>;

export const HardwareSummarySchema = z.object({
  totalMemoryBytes: z.number().nonnegative(),
  availableMemoryBytes: z.number().nonnegative(),
  freeDiskBytes: z.number().nonnegative(),
  volumeBytes: z.number().nonnegative(),
  logicalProcessors: z.number().int().nonnegative(),
  volumePath: z.string(),
});
export type HardwareSummary = z.infer<typeof HardwareSummarySchema>;

export const SettingRecommendationSchema = z.object({ key: z.string(), value: z.string(), reason: z.string() });

export const ExistingDataDirectorySchema = z.object({
  path: z.string(),
  source: z.enum(['roaming-app-data', 'local-app-data', 'registry']),
  hasConfigFile: z.boolean(),
  networksWithChainData: z.array(BitcoinNetworkSchema),
  walletFiles: z.number().int().nonnegative(),
  nodeRunning: z.boolean(),
});
export type ExistingDataDirectory = z.infer<typeof ExistingDataDirectorySchema>;

export const ExistingInstallationSchema = z.object({
  path: z.string(),
  product: z.enum(['Bitcoin Core', 'Bitcoin Knots', 'unknown']),
  version: z.string().optional(),
  source: z.enum(['registry', 'program-files']),
});

export const DetectionReportSchema = z.object({
  dataDirectories: z.array(ExistingDataDirectorySchema),
  installations: z.array(ExistingInstallationSchema),
});
export type DetectionReport = z.infer<typeof DetectionReportSchema>;

export const SetupPlanSchema = z.object({
  network: BitcoinNetworkSchema,
  usage: NodeUsageSchema,
  implementation: NodeImplementationSchema,
  /**
   * The release follows a chain Bitcoin Core rejects (Bitcoin Knots 29.4.1 and
   * later), so the set-up needs the user's explicit agreement.
   */
  differentChain: z.boolean(),
  version: z.string().optional(),
  /** Why the version could not be determined (for example no internet connection). */
  versionError: z.string().optional(),
  approximateDownloadBytes: z.number().nonnegative(),
  dataDirectory: z.string(),
  hardware: HardwareSummarySchema,
  feasible: z.boolean(),
  blockers: z.array(z.string()),
  settings: z.array(SettingRecommendationSchema),
  pruned: z.boolean(),
  pruneTargetMiB: z.number().int().optional(),
  estimatedFootprintBytes: z.number().nonnegative(),
  consequences: z.array(z.string()),
  existing: DetectionReportSchema,
});
export type SetupPlan = z.infer<typeof SetupPlanSchema>;

export const JobStateSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type JobState = z.infer<typeof JobStateSchema>;

export const JobSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'bitcoin-core.setup',
    'bitcoin-knots.setup',
    'sparrow.connect',
    'software.update',
    'tor.install',
    'hwi.install',
    'trezor-suite.install',
    'electrum.setup',
    'electrum-wallet.open',
    'backup.create',
    'backup.restore',
    'profile.deploy',
  ]),
  title: z.string(),
  state: JobStateSchema,
  progress: z.object({
    stage: z.string(),
    message: z.string(),
    /** 0 to 1 when the stage reports measurable progress. */
    fraction: z.number().min(0).max(1).optional(),
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  result: z.object({ nodeId: z.string() }).optional(),
  error: AppErrorSchema.optional(),
});
export type Job = z.infer<typeof JobSchema>;
