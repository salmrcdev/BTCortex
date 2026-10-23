import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callOrchestrator } from '@/lib/orchestrator';
import { nodeKeys } from '@/features/nodes/queries';

const REFRESH_MS = 15_000;

export const peerKeys = {
  network: (nodeId: string) => [...nodeKeys.all, 'network', nodeId] as const,
  history: (nodeId: string) => [...nodeKeys.all, 'peer-history', nodeId] as const,
};

export function useNetworkOverview(nodeId: string, enabled: boolean) {
  return useQuery({
    queryKey: peerKeys.network(nodeId),
    queryFn: () => callOrchestrator('nodes.network', { nodeId }),
    enabled,
    refetchInterval: REFRESH_MS,
  });
}

export function usePeerHistory(nodeId: string) {
  return useQuery({
    queryKey: peerKeys.history(nodeId),
    queryFn: () => callOrchestrator('nodes.peers.history', { nodeId }),
    refetchInterval: REFRESH_MS,
  });
}

/** Every peer action refreshes the peers, the network overview and the history. */
function usePeerAction<T>(nodeId: string, action: (request: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: nodeKeys.peers(nodeId) }),
        queryClient.invalidateQueries({ queryKey: peerKeys.network(nodeId) }),
        queryClient.invalidateQueries({ queryKey: peerKeys.history(nodeId) }),
      ]),
  });
}

export function usePeerActions(nodeId: string) {
  return {
    disconnect: usePeerAction(nodeId, (peerId: number) =>
      callOrchestrator('nodes.peers.disconnect', { nodeId, peerId }),
    ),
    connect: usePeerAction(nodeId, ({ address, keep }: { address: string; keep: boolean }) =>
      callOrchestrator('nodes.peers.connect', { nodeId, address, keep }),
    ),
    forget: usePeerAction(nodeId, (address: string) => callOrchestrator('nodes.peers.forget', { nodeId, address })),
    ban: usePeerAction(nodeId, ({ target, durationSeconds }: { target: string; durationSeconds: number }) =>
      callOrchestrator('nodes.peers.ban', { nodeId, target, durationSeconds, confirmed: true }),
    ),
    unban: usePeerAction(nodeId, (target: string) => callOrchestrator('nodes.peers.unban', { nodeId, target })),
    clearBans: usePeerAction(nodeId, () => callOrchestrator('nodes.peers.clearBans', { nodeId })),
  };
}
