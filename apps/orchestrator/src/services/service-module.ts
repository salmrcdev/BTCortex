import type {
  InstalledProduct,
  ModulePermission,
  ServiceAction,
  ServiceHealth,
  ServiceInstanceState,
  ServiceRequirement,
} from '@btcortex/contracts';
import type { ServiceAdapter } from './service-adapter';

// The whole contract an integration module fulfils (specification section
// 29), around the catalogue's ServiceAdapter: metadata, dependencies,
// capability detection (the adapter's capabilities and state), installation,
// lifecycle operations, configuration, health, metrics, logs, updates,
// documentation and where it lives in the interface. Every facet an
// integration does not have is left out, and what is left out is never
// offered.
//
// Modules are built into BTCortex and reviewed with it; nothing is loaded at
// run time. Each one receives only the services it needs through its
// constructor options — never the vault, the database or the process table
// as a whole — and declares what it may do on this computer as permissions,
// which the interface shows.

export interface ModuleDependency {
  /** The catalogue id of the integration it needs. */
  id: string;
  /** Optional: it works without it, with less. */
  optional: boolean;
  reason: string;
}

export interface ModuleInstance {
  /** Unique across modules, for example `node:abc` or `tor`. */
  id: string;
  name: string;
  route: string | null;
  state: ServiceInstanceState;
  health: ServiceHealth;
  summary: string;
  /** Lifecycle operations that make sense now; only these are ever run. */
  actions: ServiceAction[];
  /** Other instances it needs. */
  requires: ServiceRequirement[];
  /** Log sources of the log centre. */
  logSources: string[];
  /** Metric series of the monitoring history. */
  metrics: string[];
}

export interface ServiceModule extends ServiceAdapter {
  readonly name: string;
  readonly permissions: readonly ModulePermission[];
  readonly dependencies: readonly ModuleDependency[];
  /** Where the module is explained, as a help document and section. */
  readonly documentation: { document: string; section: string } | null;
  /** The update centre's product, when BTCortex updates it. */
  readonly updates: InstalledProduct | null;
  /** Its running or configured instances: nodes, servers, the one tor. */
  instances(): Promise<ModuleInstance[]>;
  /** A lifecycle operation on one of its instances, among the actions that instance offers. */
  run?(instanceId: string, action: ServiceAction): Promise<void>;
  /** Installs a verified release; resolves with the job that does it. */
  install?(): Promise<{ jobId: string }>;
  /** Removes an installed version nothing uses any more. */
  uninstall?(version: string): Promise<void>;
  /** Where and how it is configured, when BTCortex configures it. */
  configuration?: { route: string; summary: string };
}
