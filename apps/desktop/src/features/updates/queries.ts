import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InstalledProduct, UpdatesOverview } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';

export const updateKeys = { all: ['updates'] as const };

/** The overview reads what was last checked; asking the publishers again is the refresh action. */
export function useUpdates() {
  return useQuery({
    queryKey: updateKeys.all,
    queryFn: () => callOrchestrator('updates.overview', {}, { timeoutMs: 60_000 }),
    refetchInterval: 5 * 60_000,
  });
}

export function useUpdateActions() {
  const queryClient = useQueryClient();
  const store = (overview: UpdatesOverview) => {
    queryClient.setQueryData(updateKeys.all, overview);
  };
  return {
    refresh: useMutation({
      mutationFn: () => callOrchestrator('updates.overview', { refresh: true }, { timeoutMs: 90_000 }),
      onSuccess: store,
    }),
    defer: useMutation({
      mutationFn: ({ product, version, days }: { product: InstalledProduct; version: string; days: number | null }) =>
        callOrchestrator('updates.defer', { product, version, days }),
      onSuccess: store,
    }),
    resume: useMutation({
      mutationFn: (product: InstalledProduct) => callOrchestrator('updates.resume', { product }),
      onSuccess: store,
    }),
    invalidate: () => queryClient.invalidateQueries({ queryKey: updateKeys.all }),
  };
}
