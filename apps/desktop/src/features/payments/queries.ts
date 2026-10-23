import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddPaymentServerParams } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';

export const paymentKeys = {
  all: ['payments'] as const,
  list: ['payments', 'list'] as const,
  dashboard: (serverId: string) => ['payments', 'dashboard', serverId] as const,
};

/** The orchestrator checks each server once a minute; the list follows it. */
export function usePaymentServers() {
  return useQuery({
    queryKey: paymentKeys.list,
    queryFn: () => callOrchestrator('payments.list', {}),
    refetchInterval: 30_000,
  });
}

export function usePaymentDashboard(serverId: string | undefined) {
  return useQuery({
    queryKey: paymentKeys.dashboard(serverId ?? ''),
    queryFn: () => callOrchestrator('payments.dashboard', { serverId: serverId ?? '' }, { timeoutMs: 120_000 }),
    enabled: serverId !== undefined,
    refetchInterval: 120_000,
  });
}

export function usePaymentActions() {
  const queryClient = useQueryClient();
  const refreshList = () => queryClient.invalidateQueries({ queryKey: paymentKeys.list });
  return {
    add: useMutation({
      mutationFn: (params: AddPaymentServerParams) => callOrchestrator('payments.add', params, { timeoutMs: 120_000 }),
      onSettled: refreshList,
    }),
    remove: useMutation({
      mutationFn: (serverId: string) => callOrchestrator('payments.remove', { serverId }),
      onSettled: () => queryClient.invalidateQueries({ queryKey: paymentKeys.all }),
    }),
    refresh: useMutation({
      mutationFn: (serverId: string) =>
        callOrchestrator('payments.dashboard', { serverId, refresh: true }, { timeoutMs: 120_000 }),
      onSuccess: (dashboard) => {
        queryClient.setQueryData(paymentKeys.dashboard(dashboard.serverId), dashboard);
      },
    }),
  };
}
