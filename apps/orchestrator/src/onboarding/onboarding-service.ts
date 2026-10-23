import { z } from 'zod';
import { OnboardingModeSchema } from '@btcortex/contracts';
import type { EnvironmentReport, OnboardingMode, OnboardingState } from '@btcortex/contracts';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../persistence/settings';
import { inspectEnvironment } from './environment';
import type { EnvironmentProbes } from './environment';

// The first-run guide (specification section 25). It opens by itself only
// while nothing is set up and it was never finished or skipped; afterwards it
// can still be opened from the command palette. The computer's report is
// kept for a few minutes, since its checks start programs and reach servers.

const SETTINGS_KEY = 'onboarding';
const REPORT_REUSE_MS = 5 * 60 * 1000;

const StoredSchema = z.object({ completedAt: z.string(), mode: OnboardingModeSchema.nullable() });

export interface OnboardingServiceOptions {
  settings: SettingsStore;
  probes: EnvironmentProbes;
  /** Whether anything is set up already: nodes registered or programs installed. */
  hasInfrastructure: () => boolean;
  logger: Logger;
  now?: () => Date;
}

export class OnboardingService {
  private report: { at: number; value: Promise<EnvironmentReport> } | undefined;

  constructor(private readonly options: OnboardingServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  state(): OnboardingState {
    const stored = this.options.settings.get(SETTINGS_KEY, StoredSchema);
    return {
      completedAt: stored?.completedAt ?? null,
      mode: stored?.mode ?? null,
      suggested: stored === undefined && !this.options.hasInfrastructure(),
    };
  }

  complete(mode: OnboardingMode | null): OnboardingState {
    this.options.settings.set(SETTINGS_KEY, { completedAt: this.now().toISOString(), mode });
    this.options.logger.info(mode === null ? 'The first-run guide was skipped' : 'The first-run guide was finished', {
      mode,
    });
    return this.state();
  }

  environment(refresh: boolean): Promise<EnvironmentReport> {
    const now = this.now();
    if (!refresh && this.report && now.getTime() - this.report.at < REPORT_REUSE_MS) return this.report.value;
    const value = inspectEnvironment(this.options.probes, now);
    this.report = { at: now.getTime(), value };
    // A failed inspection is not kept: the next request tries again.
    value.catch((error: unknown) => {
      this.options.logger.warn('The computer could not be checked', { error });
      if (this.report?.value === value) this.report = undefined;
    });
    return value;
  }
}
