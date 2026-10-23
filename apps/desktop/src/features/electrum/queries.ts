import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { ElectrumOverview, ElectrumServerStatus } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';

// Electrum servers: their state arrives live as `electrum.status` events
// (bridged into this cache in features/nodes/queries.ts); the slow poll
// refreshes figures Fulcrum does not announce, such as connected wallets.

export const electrumKeys = {
  all: ['electrum'] as const,
  overview: ['electrum', 'overview'] as const,
  plan: (nodeId: string, dataDirectory: string | undefined) =>
    ['electrum', 'plan', nodeId, dataDirectory ?? ''] as const,
};

const OVERVIEW_REFRESH_MS = 10_000;

/** Writes one server's new status into the cached overview. */
export function applyElectrumStatus(queryClient: QueryClient, status: ElectrumServerStatus): void {
  queryClient.setQueryData<ElectrumOverview>(electrumKeys.overview, (current) =>
    current
      ? {
          ...current,
          servers: current.servers.map((server) => (server.nodeId === status.nodeId ? status : server)),
        }
      : current,
  );
}

export function useElectrumOverview() {
  return useQuery({
    queryKey: electrumKeys.overview,
    queryFn: () => callOrchestrator('electrum.overview', {}, { timeoutMs: 30_000 }),
    refetchInterval: OVERVIEW_REFRESH_MS,
  });
}

/** The node's Electrum server, read only when asked for, for example before the node is removed. */
export function useElectrumServerOf(nodeId: string, enabled: boolean) {
  return useQuery({
    queryKey: electrumKeys.overview,
    queryFn: () => callOrchestrator('electrum.overview', {}, { timeoutMs: 30_000 }),
    enabled,
    select: (overview) =>
      overview.servers.find((server) => server.nodeId === nodeId && server.state !== 'not-set-up') ?? null,
  });
}

export function useElectrumPlan(nodeId: string, dataDirectory: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: electrumKeys.plan(nodeId, dataDirectory),
    queryFn: () =>
      callOrchestrator(
        'electrum.plan',
        { nodeId, ...(dataDirectory === undefined ? {} : { dataDirectory }) },
        { timeoutMs: 60_000 },
      ),
    enabled,
    staleTime: 30_000,
  });
}

export function useElectrumActions() {
  const queryClient = useQueryClient();
  const store = (status: ElectrumServerStatus) => {
    applyElectrumStatus(queryClient, status);
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: electrumKeys.all });
  return {
    setUp: useMutation({
      mutationFn: ({ nodeId, dataDirectory }: { nodeId: string; dataDirectory: string }) =>
        callOrchestrator('electrum.setUp', { nodeId, dataDirectory, confirmed: true }),
    }),
    start: useMutation({
      mutationFn: (nodeId: string) => callOrchestrator('electrum.start', { nodeId }, { timeoutMs: 60_000 }),
      onSuccess: store,
    }),
    stop: useMutation({
      mutationFn: (nodeId: string) => callOrchestrator('electrum.stop', { nodeId }, { timeoutMs: 60_000 }),
      onSuccess: store,
    }),
    remoteAccess: useMutation({
      mutationFn: ({ nodeId, enabled }: { nodeId: string; enabled: boolean }) =>
        callOrchestrator('electrum.remoteAccess', { nodeId, enabled, confirmed: true }, { timeoutMs: 120_000 }),
      onSuccess: store,
    }),
    remove: useMutation({
      mutationFn: ({ nodeId, deleteIndex }: { nodeId: string; deleteIndex: boolean }) =>
        callOrchestrator('electrum.remove', { nodeId, deleteIndex, confirmed: true }, { timeoutMs: 120_000 }),
      onSettled: refresh,
    }),
    refresh,
  };
}

export const remoteElectrumKey = ['electrum', 'remote'] as const;

/** Electrum servers on other computers, checked by the orchestrator every minute. */
export function useRemoteElectrumServers() {
  return useQuery({
    queryKey: remoteElectrumKey,
    queryFn: () => callOrchestrator('electrum.remote.list', {}),
    refetchInterval: 30_000,
  });
}
