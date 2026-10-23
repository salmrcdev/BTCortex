import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeploymentChoices } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';

// Deployment profiles: the catalogue with the latest deployments, the plan
// for the user's choices, and the deployment itself. A running deployment's
// steps refresh as its job reports (bridged in features/nodes/queries.ts).

export const profileKeys = {
  all: ['profiles'] as const,
  overview: ['profiles', 'overview'] as const,
  plan: (choices: DeploymentChoices) => ['profiles', 'plan', choices] as const,
};

export function useProfilesOverview() {
  return useQuery({
    queryKey: profileKeys.overview,
    queryFn: () => callOrchestrator('profiles.overview', {}),
  });
}

export function useDeploymentPlan(choices: DeploymentChoices, enabled: boolean) {
  return useQuery({
    queryKey: profileKeys.plan(choices),
    // Checking releases and the disk takes a few seconds the first time.
    queryFn: () => callOrchestrator('profiles.plan', choices, { timeoutMs: 90_000 }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useDeployProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (choices: DeploymentChoices) =>
      callOrchestrator('profiles.deploy', { choices, confirmed: true }, { timeoutMs: 90_000 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileKeys.overview }),
  });
}
