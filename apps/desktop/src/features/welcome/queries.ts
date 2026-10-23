import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import type { OnboardingMode } from '@btcortex/contracts';
import { callOrchestrator, isDesktopRuntime } from '@/lib/orchestrator';

export const onboardingKeys = {
  state: ['onboarding', 'state'] as const,
  environment: ['onboarding', 'environment'] as const,
};

export function useOnboardingState() {
  return useQuery({
    queryKey: onboardingKeys.state,
    queryFn: () => callOrchestrator('onboarding.state', {}),
    enabled: isDesktopRuntime(),
    staleTime: Infinity,
  });
}

/** The checks start programs and reach servers, so they run when the step is shown, not before. */
export function useEnvironment(enabled: boolean) {
  return useQuery({
    queryKey: onboardingKeys.environment,
    queryFn: () => callOrchestrator('onboarding.environment', {}, { timeoutMs: 90_000 }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useOnboardingActions() {
  const queryClient = useQueryClient();
  return {
    recheck: useMutation({
      mutationFn: () => callOrchestrator('onboarding.environment', { refresh: true }, { timeoutMs: 90_000 }),
      onSuccess: (report) => {
        queryClient.setQueryData(onboardingKeys.environment, report);
      },
    }),
    complete: useMutation({
      mutationFn: (mode: OnboardingMode | null) => callOrchestrator('onboarding.complete', { mode }),
      onSuccess: (state) => {
        queryClient.setQueryData(onboardingKeys.state, state);
      },
    }),
  };
}

/** Opens the guide once at start while nothing is set up and it was never finished or skipped. */
export function useFirstRunGuide(): void {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const state = useOnboardingState();
  const opened = useRef(false);
  const suggested = state.data?.suggested === true;
  useEffect(() => {
    if (opened.current || !suggested || pathname !== '/') return;
    opened.current = true;
    void navigate({ to: '/welcome', replace: true });
  }, [suggested, pathname, navigate]);
}
