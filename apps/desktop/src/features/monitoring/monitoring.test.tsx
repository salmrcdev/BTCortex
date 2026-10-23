import { useSearch } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert, HealthSummary, MonitoringSettings, NodeWithStatus } from '@btcortex/contracts';
import { formatBytes, formatRate } from '@/lib/format';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { AlertsButton, AlertsCard, HealthCard } = await import('./health-panels');
const { chosenSeries, MonitoringPage } = await import('./monitoring-page');
const { validateMonitoringSearch } = await import('./search');

const GIB = 1024 ** 3;

const HEALTH: HealthSummary = {
  checkedAt: '2026-10-23T08:00:00.000Z',
  overall: 'attention',
  services: [
    { id: 'nodes', health: 'healthy', summary: '1 node, 1 running.', route: '/nodes' },
    { id: 'tor', health: 'healthy', summary: 'Connected to the Tor network.', route: '/tor' },
    { id: 'electrum', health: 'unknown', summary: 'No Electrum server.', route: '/electrum' },
    { id: 'lightning', health: 'attention', summary: '1 LND node, 0 ready.', route: '/lightning' },
    { id: 'backups', health: 'unknown', summary: 'No backup folder chosen.', route: '/backups' },
  ],
  resources: {
    cpuPercent: 42,
    memoryUsedBytes: 6 * GIB,
    memoryTotalBytes: 8 * GIB,
    volumes: [{ root: 'C:\\', freeBytes: 120 * GIB, totalBytes: 500 * GIB, uses: ['BTCortex’s data', 'Main node'] }],
    activity: {
      diskBusyPercent: 12,
      diskReadBytesPerSecond: 2_000_000,
      diskWriteBytesPerSecond: 500_000,
      networkInBytesPerSecond: 30_000,
      networkOutBytesPerSecond: 4_000,
    },
  },
  alerts: { open: 1, critical: 0, warning: 1 },
  recentErrors: {
    count: 1,
    latest: [{ at: '2026-10-23T07:40:00.000Z', component: 'tor', message: 'tor exited with code 1' }],
  },
};

const ALERT: Alert = {
  id: 'lightning.unavailable:c1',
  rule: 'lightning.unavailable',
  severity: 'warning',
  component: 'Lightning (bob)',
  title: 'BTCortex cannot read bob',
  message: 'LND could not be reached at 192.168.1.20:8080.',
  route: '/lightning?connection=c1',
  raisedAt: '2026-10-23T07:50:00.000Z',
  updatedAt: '2026-10-23T07:50:00.000Z',
  resolvedAt: null,
  acknowledgedAt: null,
  clearsWhenSeen: false,
};

const CONFIG_ALERT: Alert = {
  ...ALERT,
  id: 'config.changed:n1',
  rule: 'config.changed',
  component: 'Main node',
  title: 'bitcoin.conf of Main node changed outside BTCortex',
  message: 'Settings that can open the node to other computers were changed: rpcallowip now 0.0.0.0/0.',
  route: '/nodes/n1/configuration',
  clearsWhenSeen: true,
};

const SETTINGS: MonitoringSettings = {
  detailedHours: 48,
  historyDays: 90,
  diskWarningGiB: 10,
  diskCriticalGiB: 2,
  resourceWarningPercent: 90,
  desktopNotifications: 'all',
};

const NODE = {
  profile: { id: 'n1', name: 'Main node', network: 'mainnet', execution: 'managed' },
  status: { nodeId: 'n1', state: 'running', checkedAt: '2026-10-23T08:00:00.000Z' },
} as unknown as NodeWithStatus;

let alerts: Alert[];

beforeEach(() => {
  alerts = [ALERT];
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation(
    (method: string, params: { alertId?: string; series?: string; desktopNotifications?: string }) => {
      switch (method) {
        case 'monitoring.health':
          return Promise.resolve(HEALTH);
        case 'monitoring.alerts':
          return Promise.resolve(alerts);
        case 'monitoring.acknowledge':
          alerts = alerts.map((alert) =>
            alert.id === params.alertId ? { ...alert, acknowledgedAt: '2026-10-23T08:01:00.000Z' } : alert,
          );
          return Promise.resolve(alerts[0]);
        case 'monitoring.settings':
          return Promise.resolve(SETTINGS);
        case 'monitoring.configure':
          return Promise.resolve({ ...SETTINGS, ...params });
        case 'monitoring.history':
          return Promise.resolve({
            series: params.series,
            resolution: 'minute',
            points: [
              { at: new Date(Date.now() - 120_000).toISOString(), value: 10 },
              { at: new Date(Date.now() - 60_000).toISOString(), value: 20 },
            ],
          });
        case 'monitoring.export':
          return Promise.resolve({
            path: 'C:\\Users\\me\\AppData\\Local\\BTCortex\\exports\\btcortex-monitoring-metrics-2026-10-23T08-00-00.csv',
            createdAt: '2026-10-23T08:00:00.000Z',
            sizeBytes: 100,
          });
        case 'nodes.list':
          return Promise.resolve([NODE]);
        default:
          return Promise.reject(new Error(`unexpected ${method}`));
      }
    },
  );
});

function RoutedMonitoringPage() {
  const search = useSearch({ strict: false });
  return <MonitoringPage search={validateMonitoringSearch(search)} />;
}

describe('Monitoring', () => {
  it('sums up every service, the computer’s resources and its disk and network activity', async () => {
    await renderPage(<HealthCard />);
    expect(await screen.findByText('Something needs attention')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Lightning' }).getAttribute('href')).toBe('#/lightning');
    expect(screen.getByText('1 LND node, 0 ready.')).toBeDefined();
    expect(screen.getByRole('meter', { name: 'Processor' }).getAttribute('aria-valuenow')).toBe('42');
    expect(screen.getByText('Disk C:\\ (BTCortex’s data, Main node)')).toBeDefined();
    expect(screen.getByText(`${formatBytes(120 * GIB)} free`)).toBeDefined();
    expect(screen.getByRole('meter', { name: 'Busiest disk, time busy' }).getAttribute('aria-valuenow')).toBe('12');
    expect(screen.getByText(formatRate(2_000_000))).toBeDefined();
    expect(screen.getByText(formatRate(4_000))).toBeDefined();
  });

  it('says when the health or the alerts cannot be loaded, instead of loading for ever', async () => {
    const answers = callOrchestrator.getMockImplementation();
    callOrchestrator.mockImplementation((method: string, ...rest: unknown[]) =>
      method === 'monitoring.health' || method === 'monitoring.alerts'
        ? Promise.reject(new Error('The orchestrator did not answer.'))
        : (answers?.(method, ...rest) as Promise<unknown>),
    );
    await renderPage(
      <>
        <HealthCard />
        <AlertsCard />
      </>,
    );
    expect(await screen.findByText('The health of what BTCortex runs could not be loaded')).toBeDefined();
    expect(await screen.findByText('Alerts could not be loaded')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(2);
  });

  it('lists open alerts with where to look, and marks one as seen', async () => {
    const user = userEvent.setup();
    await renderPage(<AlertsCard />);
    expect(await screen.findByText('BTCortex cannot read bob')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('#/lightning?connection=c1');
    await user.click(screen.getByRole('button', { name: 'Mark as seen' }));
    expect(callOrchestrator).toHaveBeenCalledWith('monitoring.acknowledge', { alertId: ALERT.id });
    expect(await screen.findByText(/Seen/)).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Mark as seen' })).toBeNull();
    });
  });

  it('offers to dismiss an alert about something that happened', async () => {
    alerts = [CONFIG_ALERT];
    await renderPage(<AlertsCard />);
    expect(await screen.findByText('bitcoin.conf of Main node changed outside BTCortex')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('#/nodes/n1/configuration');
  });

  it('says when nothing needs attention, and the bell counts what does', async () => {
    alerts = [];
    const { unmount } = await renderPage(<AlertsCard />);
    expect(await screen.findByText('No alert: nothing needs attention.')).toBeDefined();
    unmount();
    alerts = [ALERT];
    await renderPage(<AlertsButton />);
    const bell = await screen.findByRole('link', { name: 'Alerts: 1 needs attention' });
    expect(bell.getAttribute('href')).toBe('/monitoring');
  });

  it('shows the chosen metrics over the chosen period, exports them and keeps the settings', async () => {
    const user = userEvent.setup();
    await renderPage(<RoutedMonitoringPage />, '/monitoring');
    expect(await screen.findByRole('region', { name: 'Processor' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Memory' })).toBeDefined();
    expect(callOrchestrator).toHaveBeenCalledWith('monitoring.history', { series: 'system.cpu', hours: 24 });
    expect(await screen.findByText('1 error in the last 24 hours')).toBeDefined();

    await user.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => {
      expect(callOrchestrator).toHaveBeenCalledWith('monitoring.history', { series: 'system.cpu', hours: 168 });
    });
    await user.click(await screen.findByRole('checkbox', { name: 'Peers' }));
    expect(await screen.findByRole('region', { name: 'Main node: Peers' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Export as CSV' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'monitoring.export',
      { kind: 'metrics', series: ['system.cpu', 'system.memory', 'node.peers:n1'], hours: 168 },
      { timeoutMs: 60_000 },
    );

    await user.selectOptions(await screen.findByLabelText('Windows notifications for'), 'critical');
    expect(callOrchestrator).toHaveBeenCalledWith('monitoring.configure', { desktopNotifications: 'critical' });
  });

  it('reads the chosen metrics from the address, dropping unknown and repeated ones', () => {
    expect(chosenSeries(undefined)).toEqual(['system.cpu', 'system.memory']);
    expect(chosenSeries('node.peers:n1,bogus,node.peers:n1,system.disk-busy')).toEqual([
      'node.peers:n1',
      'system.disk-busy',
    ]);
    expect(validateMonitoringSearch({ range: 168, series: 'system.cpu' })).toEqual({
      range: 168,
      series: 'system.cpu',
    });
    expect(validateMonitoringSearch({ range: 5 })).toEqual({});
  });
});
