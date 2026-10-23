import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { I2pRouterStatus, NodePrivacyChange, TorStatus } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';

// Tor's state arrives live as `tor.status` events (bridged into this cache in
// features/nodes/queries.ts); the slow poll refreshes traffic counters and
// what other software's tor is doing, which tor does not announce. The I2P
// router is asked about less often; the orchestrator keeps its answer for half
// a minute unless asked to check again.

export const torKeys = {
  all: ['tor'] as const,
  status: ['tor', 'status'] as const,
  i2p: ['tor', 'i2p'] as const,
  privacy: (nodeId: string) => ['tor', 'privacy', nodeId] as const,
};

const STATUS_REFRESH_MS = 15_000;
const I2P_REFRESH_MS = 30_000;

export function useTorStatus() {
  return useQuery({
    queryKey: torKeys.status,
    queryFn: () => callOrchestrator('tor.status', {}, { timeoutMs: 30_000 }),
    refetchInterval: STATUS_REFRESH_MS,
  });
}

export function useTorActions() {
  const queryClient = useQueryClient();
  const store = (status: TorStatus) => {
    queryClient.setQueryData(torKeys.status, status);
  };
  return {
    install: useMutation({ mutationFn: () => callOrchestrator('tor.install', {}) }),
    start: useMutation({
      mutationFn: () => callOrchestrator('tor.start', {}, { timeoutMs: 90_000 }),
      onSuccess: store,
    }),
    stop: useMutation({
      mutationFn: () => callOrchestrator('tor.stop', {}, { timeoutMs: 30_000 }),
      onSuccess: store,
    }),
    configure: useMutation({
      mutationFn: (autoStart: boolean) => callOrchestrator('tor.configure', { autoStart }),
      onSuccess: store,
    }),
    refresh: () => queryClient.invalidateQueries({ queryKey: torKeys.all }),
  };
}

export function useI2pStatus() {
  return useQuery({
    queryKey: torKeys.i2p,
    queryFn: () => callOrchestrator('i2p.status', {}, { timeoutMs: 30_000 }),
    refetchInterval: I2P_REFRESH_MS,
  });
}

export function useCheckI2p() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => callOrchestrator('i2p.status', { refresh: true }, { timeoutMs: 30_000 }),
    onSuccess: (status: I2pRouterStatus) => {
      queryClient.setQueryData(torKeys.i2p, status);
    },
  });
}

export function useNodePrivacy(nodeId: string) {
  return useQuery({
    queryKey: torKeys.privacy(nodeId),
    queryFn: () => callOrchestrator('nodes.privacy', { nodeId }),
    refetchInterval: STATUS_REFRESH_MS,
  });
}

export function useConfigurePrivacy(nodeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: NodePrivacyChange) =>
      callOrchestrator('nodes.privacy.configure', { nodeId, change, confirmed: true }, { timeoutMs: 120_000 }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: torKeys.all }),
  });
}
