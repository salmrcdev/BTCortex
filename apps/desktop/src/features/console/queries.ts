import { useMutation, useQuery } from '@tanstack/react-query';
import { callOrchestrator } from '@/lib/orchestrator';
import { nodeKeys } from '@/features/nodes/queries';

const STATISTICS_REFRESH_MS = 10_000;
/** Slow methods may take up to the shell's five-minute limit. */
const CALL_TIMEOUT_MS = 5 * 60_000;

export const consoleKeys = {
  catalogue: (nodeId: string) => [...nodeKeys.all, 'rpc-catalogue', nodeId] as const,
  help: (nodeId: string, method: string) => [...nodeKeys.all, 'rpc-help', nodeId, method] as const,
  statistics: (nodeId: string) => [...nodeKeys.all, 'rpc-statistics', nodeId] as const,
};

export function useRpcCatalogue(nodeId: string, enabled: boolean) {
  return useQuery({
    queryKey: consoleKeys.catalogue(nodeId),
    queryFn: () => callOrchestrator('nodes.rpc.catalogue', { nodeId }),
    enabled,
    staleTime: Infinity,
  });
}

export function useRpcHelp(nodeId: string, method: string | undefined) {
  return useQuery({
    queryKey: consoleKeys.help(nodeId, method ?? ''),
    queryFn: () => callOrchestrator('nodes.rpc.help', { nodeId, method: method ?? '' }),
    enabled: method !== undefined,
    staleTime: Infinity,
  });
}

export function useRpcStatistics(nodeId: string, enabled: boolean) {
  return useQuery({
    queryKey: consoleKeys.statistics(nodeId),
    queryFn: () => callOrchestrator('nodes.rpc.statistics', { nodeId }),
    enabled,
    refetchInterval: STATISTICS_REFRESH_MS,
  });
}

export interface RpcCallRequest {
  method: string;
  params: unknown[];
  wallet?: string | undefined;
  confirmed: boolean;
}

export function useRpcCall(nodeId: string) {
  return useMutation({
    mutationFn: ({ method, params, wallet, confirmed }: RpcCallRequest) =>
      callOrchestrator(
        'nodes.rpc.call',
        { nodeId, method, params, confirmed, ...(wallet === undefined ? {} : { wallet }) },
        { timeoutMs: CALL_TIMEOUT_MS },
      ),
  });
}
