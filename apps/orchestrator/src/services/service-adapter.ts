import type { IntegrationStatus, ServiceCapability, ServiceState, SupportLevel } from '@btcortex/contracts';

// The common shape of every integration BTCortex offers (specification
// section 17). An adapter declares what it can do and reports the live state;
// operations themselves run through the feature that owns them (nodes, wallets,
// later Tor and Electrum servers), so an operation an adapter does not declare
// is never offered. The integration status uses the same evidence levels as
// docs/implementation/features.json, and a test keeps the two in step.

export interface ServiceAdapter {
  /** The catalogue id, for example `bitcoin-core`. */
  readonly id: string;
  readonly status: IntegrationStatus;
  /** The support level BTCortex delivers today, `null` when it only detects the software. */
  readonly level: SupportLevel | null;
  readonly capabilities: readonly ServiceCapability[];
  /** Where in BTCortex it is managed. */
  readonly route: string | null;
  state(): Promise<ServiceState>;
}
