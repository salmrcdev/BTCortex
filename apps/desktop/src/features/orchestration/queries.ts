import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ServiceAction } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';

export const orchestrationKeys = { all: ['orchestration'] as const };

/** States change as services start and stop, so the overview is read again every few seconds while it is shown. */
const REFRESH_MS = 5_000;

export function useOrchestration() {
  return useQuery({
    queryKey: orchestrationKeys.all,
    queryFn: () => callOrchestrator('services.overview', {}),
    refetchInterval: REFRESH_MS,
  });
}

export function useOrchestrationActions() {
  const queryClient = useQueryClient();
  return {
    plan: useMutation({
      mutationFn: ({ target, action }: { target: string; action: ServiceAction }) =>
        callOrchestrator('services.plan', { target, action }),
    }),
    run: useMutation({
      mutationFn: ({ target, action }: { target: string; action: ServiceAction }) =>
        callOrchestrator('services.run', { target, action, confirmed: true }, { timeoutMs: 180_000 }),
      onSuccess: (result) => {
        queryClient.setQueryData(orchestrationKeys.all, result.overview);
      },
    }),
  };
}
