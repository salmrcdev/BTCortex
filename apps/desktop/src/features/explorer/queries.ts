import { useMutation, useQuery } from '@tanstack/react-query';
import { callOrchestrator } from '@/lib/orchestrator';

// The explorer reads from the node only. Confirmed blocks never change, so
// they are kept; the overview and unconfirmed transactions refresh, which is
// how confirmations are followed.

const OVERVIEW_REFRESH_MS = 30_000;
const UNCONFIRMED_REFRESH_MS = 10_000;

export const explorerKeys = {
  all: ['explorer'] as const,
  overview: (nodeId: string) => ['explorer', 'overview', nodeId] as const,
  block: (nodeId: string, id: string, page: number) => ['explorer', 'block', nodeId, id, page] as const,
  transaction: (nodeId: string, txid: string) => ['explorer', 'transaction', nodeId, txid] as const,
  address: (nodeId: string, address: string) => ['explorer', 'address', nodeId, address] as const,
};

/** Explorers on other computers: the orchestrator checks them every minute. */
export const remoteExplorerKey = ['explorers', 'remote'] as const;

export function useRemoteExplorers() {
  return useQuery({
    queryKey: remoteExplorerKey,
    queryFn: () => callOrchestrator('explorers.remote.list', {}),
    refetchInterval: 60_000,
  });
}

export function useExplorerOverview(nodeId: string | undefined) {
  return useQuery({
    queryKey: explorerKeys.overview(nodeId ?? ''),
    queryFn: () => callOrchestrator('explorer.overview', { nodeId: nodeId ?? '' }, { timeoutMs: 60_000 }),
    enabled: nodeId !== undefined,
    refetchInterval: OVERVIEW_REFRESH_MS,
  });
}

export function useExplorerBlock(nodeId: string, id: string, page: number) {
  return useQuery({
    queryKey: explorerKeys.block(nodeId, id, page),
    queryFn: () => callOrchestrator('explorer.block', { nodeId, id, page }, { timeoutMs: 60_000 }),
    retry: false,
    // A block found by height may be replaced in a reorganisation; by hash it never changes.
    staleTime: /^\d+$/.test(id) ? 30_000 : Number.POSITIVE_INFINITY,
  });
}

export function useExplorerTransaction(nodeId: string, txid: string) {
  return useQuery({
    queryKey: explorerKeys.transaction(nodeId, txid),
    queryFn: () => callOrchestrator('explorer.transaction', { nodeId, txid }, { timeoutMs: 60_000 }),
    retry: false,
    // Followed until it has a few confirmations.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status?.state === 'mempool' || (status?.state === 'confirmed' && status.confirmations < 6)
        ? UNCONFIRMED_REFRESH_MS
        : false;
    },
  });
}

export function useExplorerAddress(nodeId: string, address: string) {
  return useQuery({
    queryKey: explorerKeys.address(nodeId, address),
    queryFn: () => callOrchestrator('explorer.address', { nodeId, address }, { timeoutMs: 60_000 }),
    retry: false,
  });
}

export function useExplorerSearch(nodeId: string | undefined) {
  return useMutation({
    mutationFn: (query: string) =>
      callOrchestrator('explorer.search', { nodeId: nodeId ?? '', query }, { timeoutMs: 60_000 }),
  });
}

export function useDecodeRaw(nodeId: string | undefined) {
  return useMutation({
    mutationFn: (hex: string) =>
      callOrchestrator('explorer.decodeRaw', { nodeId: nodeId ?? '', hex }, { timeoutMs: 60_000 }),
  });
}

export function useDecodeScript(nodeId: string | undefined) {
  return useMutation({
    mutationFn: (hex: string) => callOrchestrator('explorer.decodeScript', { nodeId: nodeId ?? '', hex }),
  });
}
