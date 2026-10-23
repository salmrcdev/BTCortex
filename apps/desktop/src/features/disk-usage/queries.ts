import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CleanupKind, DiskUsage } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';

export const diskUsageKeys = { all: ['disk-usage'] as const };

/** Measuring walks every folder, so the orchestrator reuses a measurement for ten minutes; measuring again is an action. */
export function useDiskUsage() {
  return useQuery({
    queryKey: diskUsageKeys.all,
    queryFn: () => callOrchestrator('storage.overview', {}, { timeoutMs: 180_000 }),
  });
}

export function useDiskUsageActions() {
  const queryClient = useQueryClient();
  return {
    measure: useMutation({
      mutationFn: () => callOrchestrator('storage.overview', { refresh: true }, { timeoutMs: 180_000 }),
      onSuccess: (usage: DiskUsage) => {
        queryClient.setQueryData(diskUsageKeys.all, usage);
      },
    }),
    clean: useMutation({
      mutationFn: (kind: CleanupKind) => callOrchestrator('storage.clean', { kind }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: diskUsageKeys.all }),
    }),
  };
}
