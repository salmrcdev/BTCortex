import { z } from 'zod';

// The Bitcoin Ecosystem Catalogue (specification section 6). Entries come from
// the dated research records in docs/research; what BTCortex can actually do
// with an entry is declared separately by its service adapter, so a target
// support level is never presented as a working integration.

export const SUPPORT_LEVELS = [
  'fully-managed',
  'managed-wsl2',
  'managed-docker',
  'remote-managed',
  'connected-application',
  'external-launcher',
  'research-only',
  'unsupported',
] as const;
export const SupportLevelSchema = z.enum(SUPPORT_LEVELS);
export type SupportLevel = z.infer<typeof SupportLevelSchema>;

export const CATALOGUE_CATEGORIES = [
  'full-node',
  'node-platform',
  'electrum-server',
  'indexer',
  'block-explorer',
  'data-service',
  'desktop-wallet',
  'mobile-wallet',
  'multisig-coordinator',
  'hardware-wallet',
  'signing-tool',
  'lightning-implementation',
  'lightning-management',
  'lightning-liquidity',
  'lightning-infrastructure',
  'privacy-network',
  'private-network',
  'remote-access',
  'reverse-proxy',
  'transaction-privacy',
  'payment-processor',
  'payment-tool',
  'ecash',
  'sidechain',
  'nostr',
  'mining',
  'monitoring',
  'developer-tool',
  'test-network',
  'library',
  'backup-tool',
  'security-tool',
  'other',
] as const;
export const CatalogueCategorySchema = z.enum(CATALOGUE_CATEGORIES);
export type CatalogueCategory = z.infer<typeof CatalogueCategorySchema>;

export const MaintenanceStatusSchema = z.enum([
  'active',
  'maintenance-only',
  'stale',
  'discontinued',
  'superseded',
  'unknown',
]);
export const WindowsNativeSchema = z.enum(['yes', 'partial', 'no', 'unknown', 'not-applicable']);
export const DependencyRelationshipSchema = z.enum(['requires', 'optional', 'enhances', 'conflicts']);
export type DependencyRelationship = z.infer<typeof DependencyRelationshipSchema>;

/** One research record as the catalogue ships it (a subset of the research schema). */
export const CatalogueRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: CatalogueCategorySchema,
  purpose: z.string(),
  website: z.string().nullable(),
  repository: z.string().nullable(),
  maintenance: z.object({
    status: MaintenanceStatusSchema,
    evidence: z.string(),
    supersededBy: z.string().nullable(),
  }),
  latestStableRelease: z.object({ version: z.string(), date: z.string().nullable(), source: z.string() }).nullable(),
  verifiedOn: z.string(),
  platforms: z.object({
    windowsNative: WindowsNativeSchema,
    windowsVersions: z.string().nullable(),
    windowsArchitectures: z.array(z.enum(['x64', 'arm64', 'x86'])),
    windowsDistribution: z.string().nullable(),
    wsl2: z.enum(['yes', 'likely', 'no', 'unknown', 'not-applicable']),
    docker: z.enum(['official-image', 'community-image', 'compose-only', 'no', 'unknown', 'not-applicable']),
  }),
  dependencies: z.array(
    z.object({
      ids: z.array(z.string()).min(1),
      relationship: DependencyRelationshipSchema,
      notes: z.string().nullable(),
    }),
  ),
  security: z.string(),
  licence: z.string().nullable(),
  supportLevels: z.array(SupportLevelSchema).min(1),
  recommendedSupportLevel: SupportLevelSchema,
  feasibility: z.enum(['high', 'medium', 'low', 'none']),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  sources: z.array(z.object({ title: z.string(), url: z.string(), accessed: z.string() })),
});
export type CatalogueRecord = z.infer<typeof CatalogueRecordSchema>;

/** How far BTCortex's own integration has come, with the same evidence levels as the status page. */
export const IntegrationStatusSchema = z.enum([
  'researched',
  'implemented',
  'unit-tested',
  'integration-tested',
  'verified-on-windows',
]);
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

/** Operations a service adapter supports; anything not listed is not offered. */
export const ServiceCapabilitySchema = z.enum([
  'detect',
  'install',
  'verify-release',
  'configure',
  'connect',
  'start',
  'stop',
  'open',
  'logs',
  'health',
  'update',
  'uninstall',
]);
export type ServiceCapability = z.infer<typeof ServiceCapabilitySchema>;

export const ServiceHealthSchema = z.enum(['healthy', 'working', 'attention', 'failed', 'inactive', 'unknown']);
export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;

export const ServiceStateSchema = z.object({
  /** Present on this computer, installed by BTCortex or found already there. */
  installed: z.boolean(),
  versions: z.array(z.string()),
  /** Instances running now, for example nodes. */
  running: z.number().int().nonnegative(),
  health: ServiceHealthSchema,
  /** One line about the state, in British English. */
  summary: z.string(),
});
export type ServiceState = z.infer<typeof ServiceStateSchema>;

export const CatalogueIntegrationSchema = z.object({
  status: IntegrationStatusSchema,
  /** The level BTCortex delivers today; `null` while only researched. */
  level: SupportLevelSchema.nullable(),
  capabilities: z.array(ServiceCapabilitySchema),
  /** Where in BTCortex the entry is managed, for example `/nodes`. */
  route: z.string().nullable(),
  state: ServiceStateSchema.nullable(),
});
export type CatalogueIntegration = z.infer<typeof CatalogueIntegrationSchema>;

export const CatalogueEntrySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  category: CatalogueCategorySchema,
  purpose: z.string(),
  targetLevel: SupportLevelSchema,
  windowsNative: WindowsNativeSchema,
  maintenance: MaintenanceStatusSchema,
  latestVersion: z.string().nullable(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  integration: CatalogueIntegrationSchema,
});
export type CatalogueEntrySummary = z.infer<typeof CatalogueEntrySummarySchema>;

/** A dependency group: any one of `ids` satisfies it. */
export const DependencyCheckSchema = z.object({
  relationship: DependencyRelationshipSchema,
  ids: z.array(z.string()),
  names: z.array(z.string()),
  notes: z.string().nullable(),
  /** For requires/optional/enhances: the entry that satisfies it now; for conflicts: the entries present now. */
  present: z.array(z.string()),
});
export type DependencyCheck = z.infer<typeof DependencyCheckSchema>;

export const DependencyReportSchema = z.object({
  checks: z.array(DependencyCheckSchema),
  /** Required groups nothing on this computer satisfies yet. */
  missing: z.array(z.array(z.string())),
  /** Conflicting entries already present. */
  conflicts: z.array(z.string()),
  /** Entries to set up first, prerequisites before what needs them; the entry itself comes last. */
  order: z.array(z.string()),
  /** A requirement loop in the research data, which would make an order impossible. */
  cycle: z.array(z.string()).nullable(),
});
export type DependencyReport = z.infer<typeof DependencyReportSchema>;

export const CatalogueEntryDetailSchema = z.object({
  record: CatalogueRecordSchema,
  integration: CatalogueIntegrationSchema,
  dependencies: DependencyReportSchema,
  /** Names of the entries the record mentions, by id, for display. */
  names: z.record(z.string(), z.string()),
  /** Which of those have a catalogue page of their own. */
  catalogueIds: z.array(z.string()),
});
export type CatalogueEntryDetail = z.infer<typeof CatalogueEntryDetailSchema>;
