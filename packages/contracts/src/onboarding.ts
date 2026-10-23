import { z } from 'zod';
import { DeploymentProfileIdSchema } from './profiles';

// The first-run guide (specification section 25): what BTCortex finds on this
// computer before anything is installed — Windows, processor and memory, disk
// space, Bitcoin software already present, WSL2 and Docker, ports in use and
// what the network allows — and the profile it recommends from that.

export const EnvironmentCheckSchema = z.object({
  id: z.string(),
  area: z.enum(['system', 'storage', 'software', 'virtualisation', 'ports', 'network']),
  state: z.enum(['ok', 'info', 'warning', 'problem']),
  title: z.string(),
  detail: z.string(),
});
export type EnvironmentCheck = z.infer<typeof EnvironmentCheckSchema>;

export const ExistingSoftwareSchema = z.object({
  id: z.enum(['bitcoin-core', 'bitcoin-knots', 'sparrow', 'electrum', 'trezor-suite', 'lnd', 'tor-browser']),
  name: z.string(),
  /** Where it was found: a program folder or a data folder. */
  location: z.string(),
});
export type ExistingSoftware = z.infer<typeof ExistingSoftwareSchema>;

export const EnvironmentReportSchema = z.object({
  checkedAt: z.string(),
  checks: z.array(EnvironmentCheckSchema),
  software: z.array(ExistingSoftwareSchema),
  /** Bitcoin Core data directories with a node BTCortex could connect to. */
  connectableNodes: z.number().int().nonnegative(),
  recommendation: z.object({ profileId: DeploymentProfileIdSchema, reason: z.string() }),
});
export type EnvironmentReport = z.infer<typeof EnvironmentReportSchema>;

export const OnboardingModeSchema = z.enum(['beginner', 'advanced']);
export type OnboardingMode = z.infer<typeof OnboardingModeSchema>;

export const OnboardingStateSchema = z.object({
  completedAt: z.string().nullable(),
  mode: OnboardingModeSchema.nullable(),
  /** Nothing is set up and the guide was never finished, so it opens at start. */
  suggested: z.boolean(),
});
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;
