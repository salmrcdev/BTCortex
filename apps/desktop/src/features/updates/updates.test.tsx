import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentUpdate, Job, UpdatesOverview } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { UpdatesPage } = await import('./updates-page');

const WITHDRAWN = {
  severity: 'warning',
  reason: 'Bitcoin Core 30.1 was withdrawn: its wallet migration can delete wallet files.',
} as const;

const CORE: ComponentUpdate = {
  product: 'bitcoin-core',
  name: 'Bitcoin Core',
  installed: ['31.0', '30.1'],
  latest: '31.1',
  state: 'available',
  security: WITHDRAWN,
  releaseNotes: 'https://bitcoincore.org/en/releases/31.1/',
  impact: ['The new version is installed beside the current one.'],
  deferred: null,
  error: null,
  held: null,
};

const SPARROW: ComponentUpdate = {
  product: 'sparrow',
  name: 'Sparrow',
  installed: ['2.3.0'],
  latest: '2.3.0',
  state: 'current',
  security: null,
  releaseNotes: 'https://github.com/sparrowwallet/sparrow/releases/tag/2.3.0',
  impact: ['Close Sparrow first; its wallets and settings are kept.'],
  deferred: null,
  error: null,
  held: null,
};

const HWI: ComponentUpdate = {
  ...SPARROW,
  product: 'hwi',
  name: 'HWI',
  installed: [],
  latest: '3.2.0',
  state: 'not-installed',
};

const OVERVIEW: UpdatesOverview = {
  checkedAt: '2026-10-23T08:00:00.000Z',
  btcortex: { version: '0.1.0', detail: 'BTCortex does not update itself yet.' },
  components: [CORE, SPARROW, HWI],
  nodes: [
    {
      nodeId: 'n1',
      name: 'Main node',
      network: 'mainnet',
      implementation: 'bitcoin-core',
      managed: true,
      version: '30.1',
      newer: '31.0',
      security: WITHDRAWN,
      notes: ['Bitcoin Core does not support going back from 31.0 to 30.1: make a backup first.'],
    },
    {
      nodeId: 'n2',
      name: 'Old laptop node',
      network: 'mainnet',
      implementation: 'bitcoin-core',
      managed: false,
      version: '27.2',
      newer: null,
      security: { severity: 'warning', reason: 'Bitcoin Core 27.2 has reached its end of life.' },
      notes: [],
    },
  ],
  lastBackupAt: '2026-10-22T08:00:00.000Z',
};

const runningJob: Job = {
  id: 'job-9',
  kind: 'software.update',
  title: 'Update Bitcoin Core',
  state: 'running',
  progress: { stage: 'downloading', message: 'Downloading.', fraction: 0.25 },
  createdAt: '2026-10-23T08:00:00.000Z',
  updatedAt: '2026-10-23T08:00:05.000Z',
};

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'updates.overview':
        return Promise.resolve(OVERVIEW);
      case 'updates.defer':
        return Promise.resolve({
          ...OVERVIEW,
          components: [
            {
              ...CORE,
              deferred: { version: '31.1', until: params['days'] === null ? null : '2026-10-30T08:00:00.000Z' },
            },
            SPARROW,
            HWI,
          ],
        });
      case 'updates.resume':
        return Promise.resolve(OVERVIEW);
      case 'installations.update':
        return Promise.resolve({ jobId: 'job-9' });
      case 'jobs.get':
        return Promise.resolve(runningJob);
      case 'nodes.useRuntime':
        return Promise.resolve({ restarting: true });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

async function card(name: string) {
  const section = (await screen.findByRole('heading', { name })).closest('section');
  if (!section) throw new Error(`The ${name} card is missing.`);
  return section;
}

describe('Update centre', () => {
  it('shows what can be updated, why it matters, what it touches and what the nodes run', async () => {
    await renderPage(<UpdatesPage />);
    const core = await card('Bitcoin Core');
    expect(within(core).getByText('31.1 is available')).toBeDefined();
    expect(within(core).getByText('Installed: 31.0, 30.1. Newest release: 31.1.')).toBeDefined();
    expect(within(core).getByText(/its wallet migration can delete wallet files/)).toBeDefined();
    expect(within(core).getByText('The new version is installed beside the current one.')).toBeDefined();
    expect(within(core).getByRole('link', { name: /^Release notes for 31.1/ })).toBeDefined();
    const sparrow = await card('Sparrow');
    expect(within(sparrow).getByText('Up to date')).toBeDefined();
    expect(within(sparrow).queryByRole('button', { name: /Install/ })).toBeNull();
    // Programs that are not installed are named once, not given cards.
    expect(screen.queryByRole('heading', { name: 'HWI' })).toBeNull();
    expect(screen.getByText('Not installed, so nothing to update: HWI.')).toBeDefined();

    const nodes = await card('The software of your nodes');
    expect(within(nodes).getByText('Bitcoin Core 30.1')).toBeDefined();
    expect(within(nodes).getByText('Not run by BTCortex')).toBeDefined();
    expect(within(nodes).getByText(/update its software where it was installed/)).toBeDefined();
    expect(within(nodes).getAllByRole('button', { name: /Move to/ })).toHaveLength(1);
    expect(screen.getByText('BTCortex does not update itself yet.')).toBeDefined();
  });

  it('defers an update for a week and takes it back', async () => {
    const user = userEvent.setup();
    await renderPage(<UpdatesPage />);
    await user.click(within(await card('Bitcoin Core')).getByRole('button', { name: 'Remind me in 7 days' }));
    expect(callOrchestrator).toHaveBeenCalledWith('updates.defer', {
      product: 'bitcoin-core',
      version: '31.1',
      days: 7,
    });
    const core = await card('Bitcoin Core');
    expect(await within(core).findByText('Reminding you again on 30 Oct 2026')).toBeDefined();
    // It matters for security, so the reminders do not stop altogether.
    expect(within(core).getByText(/the monitoring keeps reminding you/)).toBeDefined();
    expect(within(core).queryByRole('button', { name: 'Skip this version' })).toBeNull();
    await user.click(within(core).getByRole('button', { name: 'Remind me again' }));
    expect(callOrchestrator).toHaveBeenCalledWith('updates.resume', { product: 'bitcoin-core' });
    expect(await within(core).findByText('31.1 is available')).toBeDefined();
  });

  it('installs an update with its progress and checks again on request', async () => {
    const user = userEvent.setup();
    await renderPage(<UpdatesPage />);
    await user.click(within(await card('Bitcoin Core')).getByRole('button', { name: 'Install 31.1' }));
    expect(callOrchestrator).toHaveBeenCalledWith('installations.update', { product: 'bitcoin-core' });
    expect(await screen.findByText('Installing 31.1')).toBeDefined();
    expect(screen.getByRole('progressbar')).toBeDefined();
    // Tor and Fulcrum restart at the end of an update; Bitcoin Core does not.
    expect(screen.queryByText('Restarting on the new version')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(callOrchestrator).toHaveBeenCalledWith('updates.overview', { refresh: true }, { timeoutMs: 90_000 });
  });

  it('moves a node to a newer Bitcoin Core only after saying what changes for good', async () => {
    const user = userEvent.setup();
    await renderPage(<UpdatesPage />);
    await user.click(within(await card('The software of your nodes')).getByRole('button', { name: 'Move to 31.0…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/does not support going back from 31.0 to 30.1/)).toBeDefined();
    expect(within(dialog).getByText(/The last backup was made 22 Oct 2026/)).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('nodes.useRuntime', expect.anything());
    await user.click(within(dialog).getByRole('button', { name: 'Move and restart' }));
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.useRuntime', {
      nodeId: 'n1',
      version: '31.0',
      confirmed: true,
    });
  });
});
