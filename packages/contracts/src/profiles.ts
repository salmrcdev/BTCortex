import { z } from 'zod';
import { BitcoinNetworkSchema } from './nodes';
import { DiskKindSchema } from './storage';

// One-click deployment profiles (specification section 18): ready-made
// combinations of what BTCortex can install, configure or provides itself,
// reviewed with their requirements and implications for this computer,
// customised, and then carried out in one background job.

export const DeploymentProfileIdSchema = z.enum([
  'basic-node',
  'private-wallet',
  'privacy-node',
  'explorer',
  'lightning',
  'merchant',
  'workstation',
  'maximum',
]);
export type DeploymentProfileId = z.infer<typeof DeploymentProfileIdSchema>;

export const DeploymentComponentSchema = z.enum([
  'bitcoin-core',
  'electrum-server',
  'tor',
  'sparrow',
  'hwi',
  'trezor-suite',
  'explorer',
  'rpc-console',
  'monitoring',
  'backups',
  'lightning',
  'payments',
]);
export type DeploymentComponent = z.infer<typeof DeploymentComponentSchema>;

/**
 * - `installs`: downloaded, verified and set up by BTCortex.
 * - `built-in`: part of BTCortex, ready once the node is.
 * - `later`: needs a choice of the user's after the deployment (a backup folder).
 * - `unavailable`: researched, but not something BTCortex can deploy yet.
 */
export const DeploymentComponentKindSchema = z.enum(['installs', 'built-in', 'later', 'unavailable']);
export type DeploymentComponentKind = z.infer<typeof DeploymentComponentKindSchema>;

export const DeploymentComponentInfoSchema = z.object({
  component: DeploymentComponentSchema,
  kind: DeploymentComponentKindSchema,
  /** Always part of the profile; the others can be left out. */
  required: z.boolean(),
  /** Part of the profile unless the user leaves it out. */
  chosenByDefault: z.boolean(),
  unavailableReason: z.string().optional(),
});
export type DeploymentComponentInfo = z.infer<typeof DeploymentComponentInfoSchema>;

export const DeploymentProfileSchema = z.object({
  id: DeploymentProfileIdSchema,
  letter: z.string(),
  title: z.string(),
  summary: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  /** Docker or WSL2 would be needed, which BTCortex does not set up. */
  needsDockerOrWsl2: z.boolean(),
  components: z.array(DeploymentComponentInfoSchema),
});
export type DeploymentProfile = z.infer<typeof DeploymentProfileSchema>;

export const DeploymentTorModeSchema = z.enum(['onion-peers', 'all-traffic', 'tor-only']);
export type DeploymentTorMode = z.infer<typeof DeploymentTorModeSchema>;

export const DeploymentChoicesSchema = z
  .object({
    profileId: DeploymentProfileIdSchema,
    network: BitcoinNetworkSchema,
    /** The optional components the user kept; required ones are always included. */
    components: z.array(DeploymentComponentSchema),
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('new'), name: z.string().trim().min(1).max(80) }).strict(),
      z.object({ kind: z.literal('existing'), nodeId: z.string().min(1) }).strict(),
    ]),
    /** How the node uses Tor, when Tor is part of the deployment. */
    tor: z
      .object({ mode: DeploymentTorModeSchema, onionService: z.boolean(), privateBroadcast: z.boolean() })
      .strict()
      .optional(),
  })
  .strict();
export type DeploymentChoices = z.infer<typeof DeploymentChoicesSchema>;

export const DeploymentStepPlanSchema = z.object({
  component: DeploymentComponentSchema,
  title: z.string(),
  detail: z.string(),
  /** `to-do`: done by the deployment; `already-done`: present already; `built-in`; `later`: the user's choice afterwards. */
  state: z.enum(['to-do', 'already-done', 'built-in', 'later']),
});
export type DeploymentStepPlan = z.infer<typeof DeploymentStepPlanSchema>;

export const DeploymentDownloadSchema = z.object({
  component: DeploymentComponentSchema,
  name: z.string(),
  /** The release that would be installed; null when it could not be checked. */
  version: z.string().nullable(),
  /** The archive's size as its server reports it; null when it could not be asked. */
  bytes: z.number().nullable(),
  /** How BTCortex checks it before using it. */
  verification: z.string(),
});
export type DeploymentDownload = z.infer<typeof DeploymentDownloadSchema>;

export const DeploymentPortSchema = z.object({
  /** The usual port; BTCortex takes the next free one when it is taken. */
  port: z.number().int(),
  purpose: z.string(),
  /** Who can connect: programs on this computer, other Tor users through an onion service, or no one. */
  reach: z.enum(['this-computer', 'tor', 'nobody']),
});
export type DeploymentPort = z.infer<typeof DeploymentPortSchema>;

export const DeploymentPlanSchema = z.object({
  choices: DeploymentChoicesSchema,
  /** The node the deployment builds on: its name and whether it exists already. */
  node: z.object({ name: z.string(), existing: z.boolean(), dataDirectory: z.string().nullable() }),
  feasible: z.boolean(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  steps: z.array(DeploymentStepPlanSchema),
  downloads: z.array(DeploymentDownloadSchema),
  storage: z.object({
    volume: z.string(),
    kind: DiskKindSchema,
    freeBytes: z.number(),
    totalBytes: z.number(),
    /** Estimates once everything is synchronised and indexed. */
    items: z.array(z.object({ label: z.string(), bytes: z.number() })),
    neededBytes: z.number(),
  }),
  memory: z.object({
    totalBytes: z.number(),
    /** The caches the configuration gives each program, as BTCortex sets them. */
    items: z.array(z.object({ label: z.string(), bytes: z.number() })),
    recommendedBytes: z.number(),
  }),
  processors: z.object({ logical: z.number().int(), recommended: z.number().int() }),
  ports: z.array(DeploymentPortSchema),
  dependencies: z.array(z.string()),
  privacy: z.array(z.string()),
  security: z.array(z.string()),
  impact: z.array(z.string()),
  needsDockerOrWsl2: z.boolean(),
});
export type DeploymentPlan = z.infer<typeof DeploymentPlanSchema>;

export const DeploymentStepStateSchema = z.enum(['pending', 'running', 'done', 'skipped', 'failed', 'needs-attention']);
export type DeploymentStepState = z.infer<typeof DeploymentStepStateSchema>;

export const DeploymentStepOutcomeSchema = z.object({
  component: DeploymentComponentSchema,
  title: z.string(),
  state: DeploymentStepStateSchema,
  message: z.string().nullable(),
  /** Where in BTCortex to look or to finish by hand. */
  route: z.string().nullable(),
});
export type DeploymentStepOutcome = z.infer<typeof DeploymentStepOutcomeSchema>;

export const DeploymentRecordSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  profileId: DeploymentProfileIdSchema,
  network: BitcoinNetworkSchema,
  nodeId: z.string().nullable(),
  nodeName: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  steps: z.array(DeploymentStepOutcomeSchema),
});
export type DeploymentRecord = z.infer<typeof DeploymentRecordSchema>;

export const ProfilesOverviewSchema = z.object({
  profiles: z.array(DeploymentProfileSchema),
  /** The latest deployments, newest first. */
  deployments: z.array(DeploymentRecordSchema),
});
export type ProfilesOverview = z.infer<typeof ProfilesOverviewSchema>;
