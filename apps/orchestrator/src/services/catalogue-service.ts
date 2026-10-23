import { CATALOGUE_RECORDS, ENTRY_NAMES, RECORDS_BY_ID, resolveDependencies } from '@btcortex/catalogue';
import { AppFailure } from '@btcortex/contracts';
import type { CatalogueEntryDetail, CatalogueEntrySummary, CatalogueIntegration } from '@btcortex/contracts';
import type { Logger } from '../logging/logger';
import type { ServiceAdapter } from './service-adapter';

// The Bitcoin Ecosystem Catalogue (specification section 6): every researched
// entry with its target support level, joined with what the service adapters
// report. An entry without an adapter is research only, whatever its target.
// Adapter states are reused for a few seconds, because finding installations
// reads the registry and the process list.

const STATE_REUSE_MS = 15_000;

const RESEARCH_ONLY: CatalogueIntegration = {
  status: 'researched',
  level: null,
  capabilities: [],
  route: null,
  state: null,
};

export interface CatalogueServiceOptions {
  adapters: readonly ServiceAdapter[];
  logger: Logger;
  now?: () => number;
}

export class CatalogueService {
  private cached: { at: number; value: Promise<Map<string, CatalogueIntegration>> } | undefined;

  constructor(private readonly options: CatalogueServiceOptions) {}

  async list(): Promise<CatalogueEntrySummary[]> {
    const integrations = await this.integrations();
    return CATALOGUE_RECORDS.map((record) => ({
      id: record.id,
      name: record.name,
      category: record.category,
      purpose: record.purpose,
      targetLevel: record.recommendedSupportLevel,
      windowsNative: record.platforms.windowsNative,
      maintenance: record.maintenance.status,
      latestVersion: record.latestStableRelease?.version ?? null,
      priority: record.priority,
      integration: integrations.get(record.id) ?? RESEARCH_ONLY,
    }));
  }

  async entry(id: string): Promise<CatalogueEntryDetail> {
    const record = RECORDS_BY_ID.get(id);
    if (!record) {
      throw new AppFailure({
        code: 'catalogue.not-found',
        message: `There is no catalogue entry "${id}".`,
        component: 'catalogue',
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    const integrations = await this.integrations();
    const present = new Set(
      [...integrations].filter(([, integration]) => integration.state?.installed === true).map(([key]) => key),
    );
    const dependencies = resolveDependencies(id, { records: RECORDS_BY_ID, names: ENTRY_NAMES, present });
    const mentioned = new Set([...record.dependencies.flatMap((dependency) => dependency.ids), ...dependencies.order]);
    return {
      record,
      integration: integrations.get(id) ?? RESEARCH_ONLY,
      dependencies,
      names: Object.fromEntries([...mentioned].map((key) => [key, ENTRY_NAMES[key] ?? key])),
      catalogueIds: [...mentioned].filter((key) => RECORDS_BY_ID.has(key)),
    };
  }

  private integrations(): Promise<Map<string, CatalogueIntegration>> {
    const now = this.options.now?.() ?? Date.now();
    if (this.cached && now - this.cached.at < STATE_REUSE_MS) return this.cached.value;
    const value = Promise.all(
      this.options.adapters.map(async (adapter): Promise<[string, CatalogueIntegration]> => {
        let state: CatalogueIntegration['state'] = null;
        try {
          state = await adapter.state();
        } catch (error) {
          // One adapter failing must not hide the rest of the catalogue.
          this.options.logger.warn('A service adapter could not report its state', { id: adapter.id, error });
        }
        return [
          adapter.id,
          {
            status: adapter.status,
            level: adapter.level,
            capabilities: [...adapter.capabilities],
            route: adapter.route,
            state,
          },
        ];
      }),
    ).then((entries) => new Map(entries));
    this.cached = { at: now, value };
    return value;
  }
}
