import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { AddLightningParams, LightningConnectionWithStatus, LightningStatus } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';

// Lightning connections: their state arrives live as `lightning.status`
// events (bridged into this cache in features/nodes/queries.ts); the
// dashboard of the selected node refreshes on its own.

export const lightningKeys = {
  all: ['lightning'] as const,
  connections: ['lightning', 'connections'] as const,
  local: ['lightning', 'local'] as const,
  dashboard: (connectionId: string) => ['lightning', 'dashboard', connectionId] as const,
};

const CONNECTIONS_REFRESH_MS = 30_000;
const DASHBOARD_REFRESH_MS = 30_000;

/** Writes one connection's new status into the cached list. */
export function applyLightningStatus(queryClient: QueryClient, status: LightningStatus): void {
  queryClient.setQueryData<LightningConnectionWithStatus[]>(lightningKeys.connections, (current) =>
    current?.map((entry) => (entry.connection.id === status.connectionId ? { ...entry, status } : entry)),
  );
}

export function useLightningConnections() {
  return useQuery({
    queryKey: lightningKeys.connections,
    queryFn: () => callOrchestrator('lightning.list', {}),
    refetchInterval: CONNECTIONS_REFRESH_MS,
  });
}

export function useLocalLightning() {
  return useQuery({
    queryKey: lightningKeys.local,
    queryFn: () => callOrchestrator('lightning.detectLocal', {}, { timeoutMs: 30_000 }),
    staleTime: 15_000,
  });
}

export function useLightningDashboard(connectionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: lightningKeys.dashboard(connectionId ?? ''),
    queryFn: () => callOrchestrator('lightning.dashboard', { connectionId: connectionId ?? '' }, { timeoutMs: 90_000 }),
    enabled: enabled && connectionId !== undefined,
    refetchInterval: DASHBOARD_REFRESH_MS,
    retry: false,
  });
}

export function useLightningActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: lightningKeys.all });
  return {
    add: useMutation({
      mutationFn: (params: AddLightningParams) => callOrchestrator('lightning.add', params, { timeoutMs: 120_000 }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (connectionId: string) => callOrchestrator('lightning.remove', { connectionId, confirmed: true }),
      onSuccess: refresh,
    }),
    refresh: useMutation({
      mutationFn: (connectionId: string) =>
        callOrchestrator('lightning.refresh', { connectionId }, { timeoutMs: 90_000 }),
      onSuccess: (status) => {
        applyLightningStatus(queryClient, status);
        void queryClient.invalidateQueries({ queryKey: lightningKeys.dashboard(status.connectionId) });
      },
    }),
    saveBackup: useMutation({
      mutationFn: (connectionId: string) =>
        callOrchestrator('lightning.saveChannelBackup', { connectionId }, { timeoutMs: 90_000 }),
      onSuccess: (_record, connectionId) =>
        queryClient.invalidateQueries({ queryKey: lightningKeys.dashboard(connectionId) }),
    }),
  };
}
