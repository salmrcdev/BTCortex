import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callOrchestrator } from '@/lib/orchestrator';

export const configKeys = {
  node: (nodeId: string) => ['config', nodeId] as const,
};

export function useNodeConfig(nodeId: string) {
  return useQuery({
    queryKey: configKeys.node(nodeId),
    queryFn: () => callOrchestrator('nodes.config.get', { nodeId }),
    // The draft is kept separately; the file is read again after saving and after restarts.
    refetchOnWindowFocus: false,
  });
}

export interface SaveConfigRequest {
  text: string;
  revision: string;
  acceptedRisks: string[];
}

export function useSaveNodeConfig(nodeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: SaveConfigRequest) => callOrchestrator('nodes.config.save', { nodeId, ...request }),
    // Waiting for the new file keeps the editor from showing the old one for a moment.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: configKeys.node(nodeId) }),
  });
}
