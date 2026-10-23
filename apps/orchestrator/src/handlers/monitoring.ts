import type { MonitoringService } from '../monitoring/monitoring-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerMonitoringHandlers(dispatcher: Dispatcher, monitoring: MonitoringService): void {
  dispatcher.register('monitoring.health', () => monitoring.health());
  dispatcher.register('monitoring.alerts', ({ includeResolved }) => monitoring.alerts(includeResolved === true));
  dispatcher.register('monitoring.acknowledge', ({ alertId }) => monitoring.acknowledge(alertId));
  dispatcher.register('monitoring.history', ({ series, hours }) => monitoring.history(series, hours));
  dispatcher.register('monitoring.settings', () => monitoring.settings());
  dispatcher.register('monitoring.configure', (changes) => monitoring.configure(changes));
  dispatcher.register('monitoring.export', (params) => monitoring.export(params));
  dispatcher.register('monitoring.revealExport', ({ path }) => {
    monitoring.revealExport(path);
    return { opened: true as const };
  });
}
