import { useQuery } from '@tanstack/react-query';
import { callOrchestrator } from '@/lib/orchestrator';
import { nodeKeys } from '@/features/nodes/queries';

const OVERVIEW_REFRESH_MS = 15_000;
const METRICS_REFRESH_MS = 60_000;

export const mempoolKeys = {
  overview: (nodeId: string) => [...nodeKeys.all, 'mempool', nodeId] as const,
  transaction: (nodeId: string, txid: string) => [...nodeKeys.all, 'mempool-transaction', nodeId, txid] as const,
  metrics: (nodeId: string) => [...nodeKeys.all, 'metrics', nodeId] as const,
};

export function useMempoolOverview(nodeId: string, enabled: boolean) {
  return useQuery({
    queryKey: mempoolKeys.overview(nodeId),
    queryFn: () => callOrchestrator('nodes.mempool', { nodeId }),
    enabled,
    refetchInterval: OVERVIEW_REFRESH_MS,
  });
}

export function useMempoolTransaction(nodeId: string, txid: string | undefined) {
  return useQuery({
    queryKey: mempoolKeys.transaction(nodeId, txid ?? ''),
    queryFn: () => callOrchestrator('nodes.mempool.transaction', { nodeId, txid: txid ?? '' }),
    enabled: txid !== undefined,
    retry: false,
  });
}

export function useNodeMetrics(nodeId: string) {
  return useQuery({
    queryKey: mempoolKeys.metrics(nodeId),
    queryFn: () => callOrchestrator('nodes.metrics', { nodeId }),
    refetchInterval: METRICS_REFRESH_MS,
  });
}
