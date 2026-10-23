import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReindexScope, StorageChange, StoragePartId } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';
import { nodeKeys } from '@/features/nodes/queries';

// Folder sizes change slowly; index building is the one thing worth watching.
const STORAGE_REFRESH_MS = 30_000;

export const storageKeys = {
  overview: (nodeId: string) => [...nodeKeys.all, 'storage', nodeId] as const,
};

export function useStorageOverview(nodeId: string, enabled: boolean) {
  return useQuery({
    queryKey: storageKeys.overview(nodeId),
    queryFn: () => callOrchestrator('nodes.storage', { nodeId }),
    enabled,
    refetchInterval: STORAGE_REFRESH_MS,
  });
}

/** Storage actions restart the node or delete files, so both the node and its storage are read again. */
function useStorageAction<T, R>(action: (request: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSettled: () => queryClient.invalidateQueries({ queryKey: nodeKeys.all }),
  });
}

export function useStorageActions(nodeId: string) {
  return {
    configure: useStorageAction((change: StorageChange) =>
      callOrchestrator('nodes.storage.configure', { nodeId, change, confirmed: true }),
    ),
    reindex: useStorageAction((scope: ReindexScope) =>
      callOrchestrator('nodes.storage.reindex', { nodeId, scope, confirmed: true }),
    ),
    removeIndexFiles: useStorageAction((part: StoragePartId) =>
      callOrchestrator('nodes.storage.removeIndexFiles', { nodeId, part, confirmed: true }),
    ),
    verify: useMutation({ mutationFn: () => callOrchestrator('nodes.storage.verify', { nodeId }) }),
  };
}
