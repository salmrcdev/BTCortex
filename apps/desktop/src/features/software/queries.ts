import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InstalledProduct } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';
import { nodeKeys } from '@/features/nodes/queries';

export const softwareKeys = {
  all: ['software'] as const,
  installed: ['software', 'installed'] as const,
  updates: ['software', 'updates'] as const,
};

/** The stages an update job reports, in order; Tor and Fulcrum restart on the new version at the end. */
export const UPDATE_STAGES = [
  'resolving',
  'fetching-checksums',
  'verifying-signatures',
  'downloading',
  'extracting',
  'verifying-executables',
  'finalising',
  'restarting',
] as const;

/** Asking the release servers is not free; the orchestrator also reuses answers for ten minutes. */
const UPDATES_STALE_MS = 10 * 60_000;

export function useInstalledSoftware() {
  return useQuery({
    queryKey: softwareKeys.installed,
    queryFn: () => callOrchestrator('installations.list', {}),
    refetchInterval: 30_000,
  });
}

export function useSoftwareUpdates() {
  return useQuery({
    queryKey: softwareKeys.updates,
    queryFn: () => callOrchestrator('installations.checkUpdates', {}, { timeoutMs: 60_000 }),
    staleTime: UPDATES_STALE_MS,
  });
}

export function useSoftwareActions() {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: softwareKeys.all }),
      queryClient.invalidateQueries({ queryKey: nodeKeys.all }),
    ]);
  return {
    verify: useMutation({
      mutationFn: ({ product, version }: { product: InstalledProduct; version: string }) =>
        callOrchestrator('installations.verify', { product, version }, { timeoutMs: 5 * 60_000 }),
    }),
    update: useMutation({
      mutationFn: (product: InstalledProduct) => callOrchestrator('installations.update', { product }),
    }),
    remove: useMutation({
      mutationFn: ({ product, version }: { product: InstalledProduct; version: string }) =>
        callOrchestrator('installations.remove', { product, version, confirmed: true }),
      onSettled: refresh,
    }),
    useRuntime: useMutation({
      mutationFn: ({ nodeId, version }: { nodeId: string; version: string }) =>
        callOrchestrator('nodes.useRuntime', { nodeId, version, confirmed: true }),
      onSettled: refresh,
    }),
    refresh,
  };
}
