import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledSoftware, Job, NodeWithStatus, SoftwareUpdate } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';
import { runningNode } from '@/testing/fixtures';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { SoftwarePage } = await import('./software-page');

const MIB = 1024 ** 2;

const CORE_31: InstalledSoftware = {
  product: 'bitcoin-core',
  version: '31.1',
  directory: 'C:\\Users\\Dev\\AppData\\Local\\BTCortex\\installations\\bitcoin-core\\31.1',
  bytes: 180 * MIB,
  verifiedAt: '2026-10-21T10:00:00.000Z',
  signatures: { valid: 11, required: 3 },
  codeSigning: 'verified',
  integrityRecorded: true,
  usedBy: [],
  running: false,
};

const INSTALLED: InstalledSoftware[] = [
  CORE_31,
  { ...CORE_31, version: '30.2', integrityRecorded: false, usedBy: [{ id: 'node-1', name: 'My Bitcoin node' }] },
  {
    ...CORE_31,
    product: 'sparrow',
    version: '2.5.5',
    codeSigning: 'recorded',
    signatures: { valid: 1, required: 1 },
    running: true,
  },
];

const UPDATES: SoftwareUpdate[] = [
  {
    product: 'bitcoin-core',
    installed: '31.1',
    latest: '31.2',
    updateAvailable: true,
    checkedAt: '2026-10-23T10:00:00.000Z',
  },
  {
    product: 'sparrow',
    installed: '2.5.5',
    latest: null,
    updateAvailable: false,
    checkedAt: '2026-10-23T10:00:00.000Z',
    error: 'The release server could not be reached. Check the internet connection and try again.',
  },
];

const node: NodeWithStatus = { ...runningNode, profile: { ...runningNode.profile, runtimeVersion: '30.2' } };

const runningJob: Job = {
  id: 'job-7',
  kind: 'software.update',
  title: 'Update Bitcoin Core',
  state: 'running',
  progress: { stage: 'downloading', message: 'Downloading.', fraction: 0.4 },
  createdAt: '2026-10-23T10:00:00.000Z',
  updatedAt: '2026-10-23T10:00:05.000Z',
};

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    switch (method) {
      case 'installations.list':
        return Promise.resolve(INSTALLED);
      case 'installations.checkUpdates':
        return Promise.resolve(UPDATES);
      case 'nodes.list':
        return Promise.resolve([node]);
      case 'installations.update':
        return Promise.resolve({ jobId: 'job-7' });
      case 'jobs.get':
        return Promise.resolve(runningJob);
      case 'installations.verify':
        return Promise.resolve({
          product: 'bitcoin-core',
          version: '31.1',
          recorded: true,
          checked: 24,
          missing: [],
          changed: ['bitcoin-31.1/bin/bitcoind.exe'],
        });
      case 'nodes.useRuntime':
        return Promise.resolve({ restarting: true });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Installed software', () => {
  it('shows what was verified for each version and which nodes use it', async () => {
    await renderPage(<SoftwarePage />);
    const core = (await screen.findByRole('heading', { name: 'Bitcoin Core' })).closest('section');
    if (!core) throw new Error('card not found');
    const rows = within(core).getAllByRole('row');
    expect(rows[1]?.textContent).toContain('11 trusted, 3 required');
    expect(rows[2]?.textContent).toContain('My Bitcoin node');
    // A version a node uses cannot be removed, and says why.
    expect(within(core).getByText(/Used by My Bitcoin node: move those nodes to another version first/)).toBeDefined();
    const sparrow = screen.getByRole('heading', { name: 'Sparrow Wallet' }).closest('section');
    if (!sparrow) throw new Error('card not found');
    expect(within(sparrow).getByText(/Could not check for a newer release/)).toBeDefined();
    expect(within(sparrow).getByText('Close Sparrow first: its files are in use.')).toBeDefined();
    expect(within(sparrow).getByRole('button', { name: 'Remove…' })).toHaveProperty('disabled', true);
  });

  it('installs an update as a background job and shows its progress', async () => {
    const user = userEvent.setup();
    await renderPage(<SoftwarePage />);
    await user.click(await screen.findByRole('button', { name: 'Install 31.2' }));
    expect(callOrchestrator).toHaveBeenCalledWith('installations.update', { product: 'bitcoin-core' });
    expect(await screen.findByText('Installing the update')).toBeDefined();
    expect(screen.getByRole('progressbar')).toBeDefined();
  });

  it('checks files and moves a node to a newer version after confirmation', async () => {
    const user = userEvent.setup();
    await renderPage(<SoftwarePage />);
    const core = (await screen.findByRole('heading', { name: 'Bitcoin Core' })).closest('section');
    if (!core) throw new Error('card not found');
    const newest = within(core).getAllByRole('row')[1];
    if (!newest) throw new Error('row not found');
    await user.click(within(newest).getByRole('button', { name: 'Check files' }));
    expect(await within(newest).findByText(/0 missing and 1 changed files/)).toBeDefined();
    expect(within(newest).getByText('bitcoin-31.1/bin/bitcoind.exe')).toBeDefined();

    await user.click(within(newest).getByRole('button', { name: 'Move My Bitcoin node here…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/moving back is not offered/)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Move and restart' }));
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.useRuntime', {
      nodeId: 'node-1',
      version: '31.1',
      confirmed: true,
    });
    // The older version offers no move back.
    const older = within(core).getAllByRole('row')[2];
    if (!older) throw new Error('row not found');
    expect(within(older).queryByRole('button', { name: /Move .* here/ })).toBeNull();
  });
});
