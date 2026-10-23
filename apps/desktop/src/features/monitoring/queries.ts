import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { Alert, ConfigureMonitoringParams, MetricSeries, MonitoringExportParams } from '@btcortex/contracts';
import { notify } from '@/lib/notifications';
import { callOrchestrator } from '@/lib/orchestrator';

// Health, alerts and resource history. Alerts arrive live as `alerts.changed`
// events (bridged in features/nodes/queries.ts); the summary refreshes with
// the orchestrator's own checks.

export const monitoringKeys = {
  all: ['monitoring'] as const,
  health: ['monitoring', 'health'] as const,
  alerts: (includeResolved: boolean) => ['monitoring', 'alerts', includeResolved] as const,
  history: (series: MetricSeries, hours: number) => ['monitoring', 'history', series, hours] as const,
  settings: ['monitoring', 'settings'] as const,
};

const HEALTH_REFRESH_MS = 30_000;
const HISTORY_REFRESH_MS = 60_000;

export function useHealth() {
  return useQuery({
    queryKey: monitoringKeys.health,
    queryFn: () => callOrchestrator('monitoring.health', {}, { timeoutMs: 60_000 }),
    refetchInterval: HEALTH_REFRESH_MS,
  });
}

export function useAlerts(includeResolved: boolean) {
  return useQuery({
    queryKey: monitoringKeys.alerts(includeResolved),
    queryFn: () => callOrchestrator('monitoring.alerts', { includeResolved }),
    refetchInterval: HEALTH_REFRESH_MS,
  });
}

export function useMetricHistory(series: MetricSeries, hours: number) {
  return useQuery({
    queryKey: monitoringKeys.history(series, hours),
    queryFn: () => callOrchestrator('monitoring.history', { series, hours }),
    refetchInterval: HISTORY_REFRESH_MS,
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (alertId: string) => callOrchestrator('monitoring.acknowledge', { alertId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: monitoringKeys.all }),
  });
}

export function useMonitoringSettings() {
  return useQuery({
    queryKey: monitoringKeys.settings,
    queryFn: () => callOrchestrator('monitoring.settings', {}),
  });
}

export function useConfigureMonitoring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: ConfigureMonitoringParams) => callOrchestrator('monitoring.configure', changes),
    onSuccess: (settings) => {
      queryClient.setQueryData(monitoringKeys.settings, settings);
      return queryClient.invalidateQueries({ queryKey: monitoringKeys.all });
    },
  });
}

export function useExportMonitoring() {
  return useMutation({
    mutationFn: (params: MonitoringExportParams) =>
      callOrchestrator('monitoring.export', params, { timeoutMs: 60_000 }),
  });
}

export function useRevealExport() {
  return useMutation({
    mutationFn: (path: string) => callOrchestrator('monitoring.revealExport', { path }),
  });
}

/** Windows notifications for newly raised alerts, as far as the user wants them. */
export async function notifyRaisedAlerts(queryClient: QueryClient, alerts: readonly Alert[]): Promise<void> {
  const wanted = alerts.filter((alert) => alert.severity !== 'info');
  if (wanted.length === 0) return;
  const settings = await queryClient
    .query({
      queryKey: monitoringKeys.settings,
      queryFn: () => callOrchestrator('monitoring.settings', {}),
      staleTime: 60_000,
    })
    .catch(() => undefined);
  const preference = settings?.desktopNotifications ?? 'all';
  for (const alert of wanted) {
    if (preference === 'off' || (preference === 'critical' && alert.severity !== 'critical')) continue;
    await notify(alert.title, alert.message);
  }
}
