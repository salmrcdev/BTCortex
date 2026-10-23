import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupOverview, RestorePreview } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { BackupsPage } = await import('./backups-page');

const BACKUP_PATH = 'E:\\Backups\\BTCortex-backup-20261023T080000Z';

function overview(destination: string | null): BackupOverview {
  return {
    items: [
      {
        id: 'btcortex.settings',
        kind: 'configuration',
        title: 'BTCortex settings and node profiles',
        component: 'BTCortex',
        description: 'How BTCortex is set up.',
        secret: false,
        available: true,
      },
      {
        id: 'node.n1.config',
        kind: 'configuration',
        title: 'bitcoin.conf',
        component: 'Main node',
        description: 'The node’s configuration file.',
        secret: false,
        available: true,
      },
      {
        id: 'node.n1.wallet.alice',
        kind: 'wallet',
        title: 'Wallet “alice”',
        component: 'Main node',
        description: 'A consistent copy made by Bitcoin Core.',
        secret: true,
        available: true,
      },
      {
        id: 'lightning.c1.channels',
        kind: 'channel',
        title: 'Static channel backup',
        component: 'bob',
        description: 'LND’s backup of every channel.',
        secret: false,
        available: false,
        unavailableReason: 'The node does not answer right now.',
      },
    ],
    notBackedUp: [
      { kind: 'blockchain', title: 'Blockchain data', description: 'Downloaded again.' },
      { kind: 'index', title: 'Indexes', description: 'Rebuilt from the blocks.' },
      { kind: 'seed', title: 'Recovery phrases and hardware wallets', description: 'BTCortex never sees seeds.' },
    ],
    settings: {
      destination,
      retention: 10,
      schedule: { everyHours: 0, encrypted: false },
      passphraseStored: false,
      lastRun: null,
    },
    backups:
      destination === null
        ? []
        : [
            {
              path: BACKUP_PATH,
              createdAt: '2026-10-23T08:00:00.000Z',
              appVersion: '0.1.0',
              encrypted: false,
              trigger: 'manual',
              bytes: 4096,
              items: [
                {
                  id: 'btcortex.settings',
                  kind: 'configuration',
                  title: 'BTCortex settings',
                  component: 'BTCortex',
                  files: 1,
                },
                {
                  id: 'node.n1.config',
                  kind: 'configuration',
                  title: 'bitcoin.conf',
                  component: 'Main node',
                  files: 1,
                },
              ],
            },
          ],
    sameDiskAsData: destination !== null,
    lastRestore: null,
  };
}

const SUMMARY = overview('E:\\Backups').backups[0];
if (!SUMMARY) throw new Error('The fixture has a backup.');

const PREVIEW: RestorePreview = {
  backup: SUMMARY,
  items: [
    {
      id: 'btcortex.settings',
      kind: 'configuration',
      title: 'BTCortex settings',
      component: 'BTCortex',
      action: 'manual',
      explanation: 'BTCortex does not restore them automatically yet.',
    },
    {
      id: 'node.n1.config',
      kind: 'configuration',
      title: 'bitcoin.conf',
      component: 'Main node',
      action: 'restore',
      explanation: 'Replaces the node’s bitcoin.conf after the same checks as the configuration editor.',
    },
  ],
};

let destination: string | null;

beforeEach(() => {
  destination = 'E:\\Backups';
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    switch (method) {
      case 'backups.overview':
        return Promise.resolve(overview(destination));
      case 'backups.create':
        return Promise.resolve({ jobId: 'job-1' });
      case 'backups.restore':
        return Promise.resolve({ jobId: 'job-2' });
      case 'jobs.get':
        return Promise.resolve({
          id: 'job-1',
          kind: 'backup.create',
          title: 'Back up',
          state: 'running',
          progress: { stage: 'writing', message: 'Writing the backup.' },
          createdAt: '2026-10-23T08:00:00.000Z',
          updatedAt: '2026-10-23T08:00:01.000Z',
        });
      case 'backups.verify':
        return Promise.resolve({ ok: true, checkedFiles: 2, decrypted: true, problems: [] });
      case 'backups.preview':
        return Promise.resolve(PREVIEW);
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Backups', () => {
  it('asks for a folder first and says what is left out, and why settings never recover funds', async () => {
    destination = null;
    await renderPage(<BackupsPage />);
    expect(await screen.findByText('Choose a backup folder first.')).toBeDefined();
    expect(screen.getByText(/A backup of settings never recovers funds/)).toBeDefined();
    expect(screen.getByText('Recovery phrases and hardware wallets.')).toBeDefined();
  });

  it('keeps wallets out until a passphrase encrypts the backup', async () => {
    const user = userEvent.setup();
    await renderPage(<BackupsPage />);
    const wallet = await screen.findByRole('checkbox', { name: /Wallet “alice”/ });
    expect(wallet).toHaveProperty('disabled', true);
    expect(screen.getByText('Holds keys or credentials: enter a passphrase to include it.')).toBeDefined();
    expect(screen.getByRole('checkbox', { name: /Static channel backup/ })).toHaveProperty('disabled', true);

    await user.type(screen.getByLabelText('Passphrase (needed for wallets and credentials)'), 'too short');
    expect(screen.getByText('Use at least 12 characters.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Back up' })).toHaveProperty('disabled', true);

    await user.type(screen.getByLabelText('Passphrase (needed for wallets and credentials)'), ' but now long enough');
    // The first is in “Back up now”; the second keeps a passphrase for automatic backups.
    const [confirm] = screen.getAllByLabelText('Repeat the passphrase');
    await user.type(confirm ?? document.body, 'too short but now long enough');
    expect(wallet).toHaveProperty('disabled', false);
    await user.click(wallet);
    await user.click(screen.getByRole('button', { name: 'Back up, encrypted' }));
    expect(callOrchestrator).toHaveBeenCalledWith('backups.create', {
      items: ['btcortex.settings', 'node.n1.config', 'node.n1.wallet.alice'],
      passphrase: 'too short but now long enough',
    });
    expect(await screen.findByText('Writing the backup')).toBeDefined();
  });

  it('warns when backups would sit on the same disk as the data', async () => {
    await renderPage(<BackupsPage />);
    expect(await screen.findByText(/on the same disk as BTCortex’s data/)).toBeDefined();
  });

  it('verifies a backup and restores a chosen item after showing what restoring does', async () => {
    const user = userEvent.setup();
    await renderPage(<BackupsPage />);
    await user.click(await screen.findByRole('button', { name: 'Verify' }));
    expect(callOrchestrator).toHaveBeenCalledWith('backups.verify', { path: BACKUP_PATH }, { timeoutMs: 300_000 });
    expect(await screen.findByText('Intact: 2 files decrypted and checked.')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Restore…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/does not restore them automatically yet/)).toBeDefined();
    const restore = within(dialog).getByRole('button', { name: 'Restore 0 items' });
    expect(restore).toHaveProperty('disabled', true);
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Restore 1 item' }));
    await waitFor(() => {
      expect(callOrchestrator).toHaveBeenCalledWith('backups.restore', {
        path: BACKUP_PATH,
        items: ['node.n1.config'],
        confirmed: true,
      });
    });
  });
});
