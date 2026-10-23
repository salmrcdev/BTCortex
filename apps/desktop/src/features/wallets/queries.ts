import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SparrowConnectionVia } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';

export const walletKeys = {
  /** Sparrow's state for a node, however it connects. */
  sparrowAll: (nodeId: string) => ['wallets', 'sparrow', nodeId] as const,
  sparrow: (nodeId: string, via: SparrowConnectionVia = 'node') => ['wallets', 'sparrow', nodeId, via] as const,
  electrum: (nodeId: string) => ['wallets', 'electrum', nodeId] as const,
};

/** Whether Sparrow is open changes outside BTCortex; check again at a calm pace. */
const SPARROW_STATUS_REFRESH_MS = 10_000;

export function useSparrowStatus(nodeId: string, via: SparrowConnectionVia = 'node') {
  return useQuery({
    queryKey: walletKeys.sparrow(nodeId, via),
    queryFn: () => callOrchestrator('apps.sparrow.status', { nodeId, ...(via === 'node' ? {} : { via }) }),
    refetchInterval: SPARROW_STATUS_REFRESH_MS,
  });
}

/** Choices the user made in Sparrow that BTCortex changes only with consent. */
export interface SparrowConsent {
  replaceExistingServer: boolean;
  resetStartupNetwork: boolean;
}

export function useConnectSparrow(nodeId: string, via: SparrowConnectionVia = 'node') {
  return useMutation({
    mutationFn: (consent: SparrowConsent) =>
      callOrchestrator('apps.sparrow.connect', { nodeId, ...consent, ...(via === 'node' ? {} : { via }) }),
  });
}

export function useOpenSparrow(nodeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => callOrchestrator('apps.sparrow.open', { nodeId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: walletKeys.sparrowAll(nodeId) }),
  });
}

export function useElectrumWalletStatus(nodeId: string) {
  return useQuery({
    queryKey: walletKeys.electrum(nodeId),
    queryFn: () => callOrchestrator('apps.electrum.status', { nodeId }, { timeoutMs: 30_000 }),
    refetchInterval: SPARROW_STATUS_REFRESH_MS,
  });
}

export function useOpenElectrumWallet(nodeId: string) {
  return useMutation({ mutationFn: () => callOrchestrator('apps.electrum.open', { nodeId }) });
}
