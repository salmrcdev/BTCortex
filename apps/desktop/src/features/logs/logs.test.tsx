import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry, LogSource } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { LogsPage } = await import('./logs-page');

const SOURCES: LogSource[] = [
  { id: 'btcortex', kind: 'application', path: 'C:\\logs\\orchestrator.log', exists: true, sizeBytes: 2048 },
  { id: 'shell', kind: 'shell', path: 'C:\\logs\\shell.log', exists: false, sizeBytes: 0 },
  {
    id: 'node:n1:debug',
    kind: 'bitcoin-core',
    nodeId: 'n1',
    nodeName: 'Home node',
    path: 'C:\\nodes\\n1\\debug.log',
    exists: true,
    sizeBytes: 4096,
  },
];

const ENTRIES: LogEntry[] = [
  {
    id: 'node:n1:debug:120',
    sourceId: 'node:n1:debug',
    time: '2026-10-21T10:00:07.000Z',
    timeEstimated: false,
    severity: 'warning',
    message: 'Disk space is low',
  },
  {
    id: 'btcortex:40',
    sourceId: 'btcortex',
    time: '2026-10-21T10:00:05.000Z',
    timeEstimated: false,
    severity: 'error',
    component: 'orchestrator.setup',
    message: 'Download failed',
    context: { attempt: 2, url: 'https://bitcoincore.org/bin/' },
  },
];

function orchestrator() {
  return (method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'logs.sources':
        return Promise.resolve(SOURCES);
      case 'logs.read': {
        const sourceIds = params['sourceIds'] as string[];
        const entries = ENTRIES.filter(
          (entry) =>
            sourceIds.includes(entry.sourceId) && (params['minimumSeverity'] !== 'error' || entry.severity === 'error'),
        );
        return Promise.resolve({ entries, limited: false, windowBytes: 4 * 1024 * 1024 });
      }
      case 'diagnostics.createBundle':
        return Promise.resolve({
          path: 'C:\\BTCortex\\exports\\btcortex-diagnostics-2026.zip',
          sizeBytes: 52_000,
          createdAt: '2026-10-21T10:01:00.000Z',
          files: ['system.json', 'logs/orchestrator.log', 'README.txt'],
        });
      case 'diagnostics.revealBundle':
        return Promise.resolve({ opened: true });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  };
}

function lastRead(): Record<string, unknown> {
  const calls = callOrchestrator.mock.calls.filter(([method]) => method === 'logs.read');
  return (calls.at(-1)?.[1] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation(orchestrator());
});

describe('Logs & diagnostics', () => {
  it('shows every existing log, newest first, with levels in words', async () => {
    await renderPage(<LogsPage />);
    const table = await screen.findByRole('table');
    const [, newest, older] = within(table).getAllByRole('row');
    if (!newest || !older) throw new Error('Expected two log entries.');
    expect(within(newest).getByText('Warning')).toBeDefined();
    expect(within(newest).getByText('Bitcoin Core · Home node')).toBeDefined();
    expect(within(older).getByText('Error')).toBeDefined();
    expect(screen.getByRole('checkbox', { name: /BTCortex window \(no file yet\)/ })).toHaveProperty('disabled', true);
    expect(lastRead()).toMatchObject({ sourceIds: ['btcortex', 'node:n1:debug'], minimumSeverity: 'info' });
  });

  it('filters by level, source and text', async () => {
    const user = userEvent.setup();
    await renderPage(<LogsPage />);
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Show'), 'error');
    expect(await screen.findByText('Download failed')).toBeDefined();
    expect(screen.queryByText('Disk space is low')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'BTCortex' }));
    await vi.waitFor(() => {
      expect(lastRead()).toMatchObject({ sourceIds: ['node:n1:debug'], minimumSeverity: 'error' });
    });

    await user.type(screen.getByLabelText('Search'), 'disk');
    await vi.waitFor(() => {
      expect(lastRead()).toMatchObject({ search: 'disk' });
    });
  });

  it('opens a node’s log on its own and shows structured details on request', async () => {
    const user = userEvent.setup();
    await renderPage(<LogsPage initialSource="btcortex" />);
    await screen.findByText('Download failed');
    expect(lastRead()).toMatchObject({ sourceIds: ['btcortex'] });
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText(/"attempt": 2/)).toBeDefined();
  });

  it('creates a sanitised diagnostic bundle and shows it in its folder', async () => {
    const user = userEvent.setup();
    await renderPage(<LogsPage />);
    await user.click(await screen.findByRole('button', { name: 'Create diagnostic bundle' }));
    expect(await screen.findByText('C:\\BTCortex\\exports\\btcortex-diagnostics-2026.zip')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Show in folder' }));
    expect(callOrchestrator).toHaveBeenCalledWith('diagnostics.revealBundle', {
      path: 'C:\\BTCortex\\exports\\btcortex-diagnostics-2026.zip',
    });
  });
});
