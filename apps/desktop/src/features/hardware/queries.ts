import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BitcoinNetworkId, SignerAddressType } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';

// Hardware wallets: what is attached (cheap to read: Windows' device list,
// polled while the page is open), what HWI identifies (it opens each device,
// so only on request), and the node's hardware-wallet wallets.

export const hardwareKeys = {
  all: ['hardware'] as const,
  overview: ['hardware', 'overview'] as const,
  signers: (nodeId: string) => ['hardware', 'signers', nodeId] as const,
  wallet: (nodeId: string, wallet: string) => ['hardware', 'wallet', nodeId, wallet] as const,
};

/** Signing devices take a moment to appear after they are plugged in; a few seconds is quick enough. */
const OVERVIEW_REFRESH_MS = 5_000;
const NODE_REFRESH_MS = 15_000;
/** Bitcoin Core waits for the device, which may need the user to unlock it first. */
const DEVICE_TIMEOUT_MS = 11 * 60_000;

export function useHardwareOverview() {
  return useQuery({
    queryKey: hardwareKeys.overview,
    queryFn: () => callOrchestrator('hardware.overview', {}, { timeoutMs: 60_000 }),
    refetchInterval: OVERVIEW_REFRESH_MS,
  });
}

export function useNodeSigners(nodeId: string | undefined) {
  return useQuery({
    queryKey: hardwareKeys.signers(nodeId ?? ''),
    queryFn: () => callOrchestrator('nodes.signers', { nodeId: nodeId ?? '' }, { timeoutMs: 120_000 }),
    enabled: nodeId !== undefined,
    refetchInterval: NODE_REFRESH_MS,
  });
}

export function useSignerWallet(nodeId: string, wallet: string) {
  return useQuery({
    queryKey: hardwareKeys.wallet(nodeId, wallet),
    queryFn: () => callOrchestrator('wallets.signer.detail', { nodeId, wallet }),
    refetchInterval: NODE_REFRESH_MS,
  });
}

export function useHardwareActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: hardwareKeys.all });
  return {
    identify: useMutation({
      mutationFn: (network: BitcoinNetworkId) =>
        callOrchestrator('hardware.identify', { network }, { timeoutMs: 120_000 }),
    }),
    installHwi: useMutation({ mutationFn: () => callOrchestrator('hardware.installHwi', {}) }),
    installTrezorSuite: useMutation({ mutationFn: () => callOrchestrator('hardware.installTrezorSuite', {}) }),
    openTrezorSuite: useMutation({ mutationFn: () => callOrchestrator('hardware.openTrezorSuite', {}) }),
    enable: useMutation({
      mutationFn: (nodeId: string) =>
        callOrchestrator('nodes.signers.enable', { nodeId, confirmed: true }, { timeoutMs: 120_000 }),
      onSettled: refresh,
    }),
    createWallet: useMutation({
      mutationFn: ({ nodeId, name }: { nodeId: string; name: string }) =>
        callOrchestrator('nodes.signers.createWallet', { nodeId, name }, { timeoutMs: DEVICE_TIMEOUT_MS }),
      onSettled: refresh,
    }),
    refresh,
  };
}

export function useWalletActions(nodeId: string, wallet: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: hardwareKeys.wallet(nodeId, wallet) });
  return {
    newAddress: useMutation({
      mutationFn: (type: SignerAddressType) => callOrchestrator('wallets.signer.newAddress', { nodeId, wallet, type }),
    }),
    displayAddress: useMutation({
      mutationFn: (address: string) =>
        callOrchestrator(
          'wallets.signer.displayAddress',
          { nodeId, wallet, address },
          { timeoutMs: DEVICE_TIMEOUT_MS },
        ),
    }),
    createPsbt: useMutation({
      mutationFn: (request: { outputs: { address: string; amountSats: number }[]; feeRateSatPerVb: number }) =>
        callOrchestrator('wallets.psbt.create', { nodeId, wallet, ...request }),
    }),
    sign: useMutation({
      mutationFn: (psbt: string) =>
        callOrchestrator(
          'wallets.psbt.sign',
          { nodeId, wallet, psbt, confirmed: true },
          { timeoutMs: DEVICE_TIMEOUT_MS },
        ),
    }),
    refresh,
  };
}

export function useQrEncode() {
  return useMutation({ mutationFn: (psbt: string) => callOrchestrator('wallets.qr.encode', { psbt }) });
}

export function useQrDecode() {
  return useMutation({ mutationFn: (parts: string[]) => callOrchestrator('wallets.qr.decode', { parts }) });
}

export function usePsbtActions(nodeId: string) {
  return {
    decode: useMutation({
      mutationFn: ({ psbt, wallet }: { psbt: string; wallet?: string }) =>
        callOrchestrator('wallets.psbt.decode', { nodeId, psbt, ...(wallet === undefined ? {} : { wallet }) }),
    }),
    finalize: useMutation({
      mutationFn: (psbt: string) => callOrchestrator('wallets.psbt.finalize', { nodeId, psbt }),
    }),
    broadcast: useMutation({
      mutationFn: (hex: string) => callOrchestrator('wallets.psbt.broadcast', { nodeId, hex, confirmed: true }),
    }),
    readFile: useMutation({ mutationFn: (path: string) => callOrchestrator('wallets.psbt.readFile', { path }) }),
    writeFile: useMutation({
      mutationFn: ({ path, psbt }: { path: string; psbt: string }) =>
        callOrchestrator('wallets.psbt.writeFile', { path, psbt }),
    }),
  };
}
