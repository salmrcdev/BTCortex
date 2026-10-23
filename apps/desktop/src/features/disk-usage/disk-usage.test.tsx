import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiskUsage } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { DiskUsagePage } = await import('./disk-usage-page');

const GIB = 1024 ** 3;

const usage = (change: Partial<DiskUsage> = {}): DiskUsage => ({
  measuredAt: '2026-10-23T12:00:00.000Z',
  volumes: [
    {
      root: 'C:\\',
      totalBytes: 1000 * GIB,
      freeBytes: 100 * GIB,
      kind: 'ssd',
      folders: ['database', 'downloads', 'node:n1', 'docker:docker-desktop data'],
    },
    { root: 'D:\\', totalBytes: 2000 * GIB, freeBytes: 1500 * GIB, kind: 'hdd', folders: ['node:n2'] },
  ],
  folders: [
    {
      id: 'database',
      path: 'C:\\BTCortex\\btcortex.db',
      owner: 'btcortex',
      ownerName: 'BTCortex',
      route: '/settings',
      bytes: 2 * 1024 * 1024,
      readOnly: false,
      cleanup: null,
    },
    {
      id: 'downloads',
      path: 'C:\\BTCortex\\downloads',
      owner: 'downloads',
      ownerName: 'Downloads',
      route: null,
      bytes: 6000,
      readOnly: false,
      cleanup: { kind: 'interrupted-downloads', bytes: 5120, files: 1 },
    },
    {
      id: 'node:n1',
      path: 'C:\\BTCortex\\nodes\\mainnet-1',
      owner: 'node',
      ownerName: 'Main node',
      route: '/nodes/n1/storage',
      bytes: 700 * GIB,
      readOnly: false,
      cleanup: null,
    },
    {
      id: 'node:n2',
      path: 'D:\\Bitcoin',
      owner: 'external-node',
      ownerName: 'Bitcoin Core',
      route: '/nodes/n2/storage',
      bytes: null,
      readOnly: true,
      cleanup: null,
    },
    {
      id: 'docker:docker-desktop data',
      path: 'C:\\Users\\Ann\\AppData\\Local\\Docker\\wsl\\disk\\docker_data.vhdx',
      owner: 'docker',
      ownerName: 'Docker Desktop (docker-desktop data)',
      route: null,
      bytes: 60 * GIB,
      readOnly: true,
      cleanup: null,
    },
  ],
  forecasts: [
    { nodeId: 'n1', name: 'Main node', volume: 'C:\\', growthBytesPerDay: 4 * GIB, daysUntilFull: 25, measuredDays: 7 },
  ],
  cleanupBlockedBy: null,
  ...change,
});

let current: DiskUsage;

beforeEach(() => {
  current = usage();
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    switch (method) {
      case 'storage.overview':
        return Promise.resolve(current);
      case 'storage.clean':
        current = usage({ folders: current.folders.map((folder) => ({ ...folder, cleanup: null })) });
        return Promise.resolve({ kind: 'interrupted-downloads', files: 1, freedBytes: 5120 });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

const row = async (owner: string) => {
  const cell = await screen.findByText(owner, { selector: 'a, span.font-medium' });
  const found = cell.closest('tr');
  if (!found) throw new Error(`no row for ${owner}`);
  return found;
};

describe('storage across BTCortex', () => {
  it('shows each disk, what is on it and which service owns each folder', async () => {
    await renderPage(<DiskUsagePage />);
    const system = await screen.findByRole('meter', { name: 'Space used on C:\\' });
    expect(system.getAttribute('aria-valuetext')).toBe('90%');
    expect(screen.getByText('90% used, 100.0 GiB free of 1,000.0 GiB')).toBeDefined();
    expect(screen.getByText(/^Holds: BTCortex, Downloads, Main node and Docker Desktop/)).toBeDefined();
    expect(screen.getByText('Hard disk')).toBeDefined();

    expect(screen.getByRole('link', { name: 'Main node' }).getAttribute('href')).toBe('#/nodes/n1/storage');
    const external = await row('Bitcoin Core');
    expect(within(external).getByText('Read only')).toBeDefined();
    expect(within(external).getByText('Not measured')).toBeDefined();
    expect(within(external).getByText('A node BTCortex reads but never changes')).toBeDefined();
    const docker = await row('Docker Desktop (docker-desktop data)');
    expect(within(docker).getByText('Not used by BTCortex')).toBeDefined();
    expect(within(docker).getByText('60.0 GiB')).toBeDefined();
    expect(within(docker).queryByRole('button', { name: /^Remove/ })).toBeNull();

    // Twenty-five days left is a warning that says what to do, not a remark.
    expect(
      screen.getByText(
        'The block files grew by about 4.0 GiB a day over the last 7 days. At that pace C:\\ is full in about 25 days. Prune the node from its Storage tab, or make room on C:\\, before then.',
      ),
    ).toBeDefined();
    expect(screen.getByText(/never deleted from this page, whatever their names/)).toBeDefined();
  });

  it('removes BTCortex’s own leftovers only after saying what goes', async () => {
    const user = userEvent.setup();
    await renderPage(<DiskUsagePage />);
    await user.click(within(await row('Downloads')).getByRole('button', { name: 'Remove 5.0 KiB' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove unfinished downloads?')).toBeDefined();
    expect(within(dialog).getByText(/^Removes 1 file \(5\.0 KiB\) left in the downloads folder/)).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('storage.clean', expect.anything());
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(callOrchestrator).toHaveBeenCalledWith('storage.clean', { kind: 'interrupted-downloads' });
    // Measured again, there is nothing left to remove.
    expect(await screen.findByText('What uses the space')).toBeDefined();
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Remove 5.0 KiB' })).toBeNull();
    });
  });

  it('offers no clean-up while a job may be using the files', async () => {
    current = usage({
      cleanupBlockedBy: 'Back up now is running and may be using these files; try again when it has finished.',
    });
    await renderPage(<DiskUsagePage />);
    expect(await screen.findByText(/Back up now is running/)).toBeDefined();
    expect(
      within(await row('Downloads'))
        .getByRole('button', { name: 'Remove 5.0 KiB' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('measures again when asked and says when there is too little to forecast', async () => {
    current = usage({ forecasts: [] });
    const user = userEvent.setup();
    await renderPage(<DiskUsagePage />);
    expect(await screen.findByText(/A forecast needs at least a day of measurements/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Measure again' }));
    expect(callOrchestrator).toHaveBeenCalledWith('storage.overview', { refresh: true }, { timeoutMs: 180_000 });
  });
});
