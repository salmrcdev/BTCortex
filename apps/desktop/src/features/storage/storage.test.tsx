import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeWithStatus, StorageOverview } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';
import { runningNode } from '@/testing/fixtures';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { StoragePage } = await import('./storage-page');

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

const OVERVIEW: StorageOverview = {
  local: true,
  manageable: true,
  configured: {
    indexes: { txindex: false, blockfilterindex: true, coinstatsindex: false, txospenderindex: false },
    pruneMiB: 24_000,
  },
  networkDirectory: 'C:\\Users\\Dev\\AppData\\Local\\BTCortex\\nodes\\mainnet-1',
  volume: { root: 'C:\\', totalBytes: 512 * GIB, freeBytes: 60 * GIB, kind: 'hdd', bus: 'USB', model: 'Example Drive' },
  blockFilesBytes: 25 * GIB,
  breakdown: [
    { id: 'blocks', bytes: 25 * GIB },
    { id: 'chainstate', bytes: 11 * GIB },
    { id: 'txindex', bytes: 40 * GIB },
    { id: 'blockfilterindex', bytes: 4 * GIB },
    { id: 'coinstatsindex', bytes: 0 },
    { id: 'txospenderindex', bytes: 0 },
    { id: 'old-coinstatsindex', bytes: 0 },
    { id: 'wallets', bytes: 2 * MIB },
    { id: 'other', bytes: 300 * MIB },
  ],
  chain: { height: 900_000, headers: 900_000, initialBlockDownload: false },
  expectedFullBytes: 870_000_000_000,
  pruning: {
    enabled: true,
    automatic: true,
    targetBytes: 24_000 * MIB,
    pruneHeight: 880_000,
    pruneTime: 1_760_000_000,
  },
  indexes: [
    { id: 'txindex', enabled: false, synced: false, bestBlockHeight: null, bytes: 40 * GIB },
    { id: 'blockfilterindex', enabled: true, synced: false, bestBlockHeight: 450_000, bytes: 4 * GIB },
    { id: 'coinstatsindex', enabled: false, synced: false, bestBlockHeight: null, bytes: 0 },
    { id: 'txospenderindex', enabled: false, synced: false, bestBlockHeight: null, bytes: 0 },
  ],
  wallets: { count: 2, bytes: 2 * MIB },
  locations: [
    { id: 'bitcoin-core', path: 'C:\\Users\\Dev\\AppData\\Local\\BTCortex\\nodes\\mainnet-1', bytes: 80 * GIB },
    { id: 'btcortex', path: 'C:\\Users\\Dev\\AppData\\Local\\BTCortex', bytes: 120 * MIB },
    { id: 'sparrow', path: 'C:\\Users\\Dev\\AppData\\Roaming\\Sparrow', bytes: 5 * MIB },
  ],
  warnings: [
    { code: 'hard-disk', severity: 'info' },
    { code: 'external-drive', severity: 'warning' },
    { code: 'unused-index', severity: 'info', bytes: 40 * GIB, part: 'txindex' },
  ],
};

let overview: StorageOverview = OVERVIEW;

beforeEach(() => {
  overview = OVERVIEW;
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    switch (method) {
      case 'nodes.storage':
        return Promise.resolve(overview);
      case 'nodes.storage.configure':
        return Promise.resolve({ changedKeys: ['prune'], backup: null, restarting: true, reindexing: false });
      case 'nodes.storage.verify':
        return Promise.resolve({ valid: true, checkLevel: 3, blocks: 6, durationMs: 1500 });
      case 'nodes.storage.reindex':
        return Promise.resolve({ restarting: true });
      case 'nodes.storage.removeIndexFiles':
        return Promise.resolve({ removedBytes: 40 * GIB });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

const fullNode = (): StorageOverview => ({
  ...OVERVIEW,
  configured: {
    indexes: { txindex: true, blockfilterindex: true, coinstatsindex: false, txospenderindex: false },
    pruneMiB: 0,
  },
  pruning: { enabled: false, automatic: false, targetBytes: null, pruneHeight: null, pruneTime: null },
  indexes: OVERVIEW.indexes.map((index) =>
    index.id === 'txindex' ? { ...index, enabled: true, synced: true } : index,
  ),
  warnings: [],
});

describe('Storage', () => {
  it('shows the disk, the warnings and what pruning means for this node', async () => {
    await renderPage(<StoragePage node={runningNode} />);
    expect(await screen.findByText(/The data is on an external drive/)).toBeDefined();
    expect(screen.getByText(/The transaction index takes 40\.0 GiB although it is switched off/)).toBeDefined();
    expect(screen.getByText('Hard disk (HDD)')).toBeDefined();
    expect(screen.getByText('60.0 GiB free of 512.0 GiB')).toBeDefined();
    expect(screen.getByText('Pruned: block files are kept to about 23.4 GiB.')).toBeDefined();
    expect(screen.getByText('Blocks from height 880,000 (9 Oct 2025) onwards are kept.')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Switching back to a full node would mean' })).toBeDefined();
    expect(screen.getByText(/downloads and verifies the whole chain again \(about 810 GiB\)/)).toBeDefined();
  });

  it('lists the node’s folders largest first and the state of each index', async () => {
    await renderPage(<StoragePage node={runningNode} />);
    const table = await screen.findByRole('table', { name: 'Folder sizes, largest first.' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]?.textContent).toContain('Transaction index');
    expect(rows[2]?.textContent).toContain('Blocks');
    // Empty index folders are left out.
    expect(within(table).queryByText('Coin statistics index')).toBeNull();

    expect(screen.getByText('Building, 50.0%')).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'Block filter index' })).toBeDefined();
    // Both indexes that need every block say why they cannot be switched on.
    expect(screen.getAllByText(/refuses to start with both/)).toHaveLength(2);
    expect(screen.getByText('2 wallets in this node’s folder (2.0 MiB).')).toBeDefined();
    expect(screen.getByText('On this pruned node a wallet can be rescanned only back to 9 Oct 2025.')).toBeDefined();
    expect(screen.getByText('C:\\Users\\Dev\\AppData\\Roaming\\Sparrow')).toBeDefined();
  });

  it('explains what switching to pruning would mean for a full node', async () => {
    overview = {
      ...OVERVIEW,
      pruning: { enabled: false, automatic: false, targetBytes: null, pruneHeight: null, pruneTime: null },
    };
    await renderPage(<StoragePage node={runningNode} />);
    expect(await screen.findByText('Full node: every block since the genesis block is kept.')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Switching to pruning would mean' })).toBeDefined();
    expect(screen.getByText(/Electrum servers, and explorers that use them, need the full chain/)).toBeDefined();
    expect(screen.queryByText(/refuses to start with both/)).toBeNull();
  });

  it('says what it cannot measure for a node on another computer', async () => {
    overview = { ...OVERVIEW, local: false, volume: null, breakdown: null, wallets: null, warnings: [] };
    await renderPage(<StoragePage node={runningNode} />);
    expect(await screen.findByText(/files are on another computer/)).toBeDefined();
    expect(screen.queryByText('Hard disk (HDD)')).toBeNull();
    expect(screen.getByText('Bitcoin Core counts 25.0 GiB of block and undo files.')).toBeDefined();
  });

  it('asks for the node to be running', async () => {
    const stopped: NodeWithStatus = { ...runningNode, status: { ...runningNode.status, state: 'stopped' } };
    await renderPage(<StoragePage node={stopped} />);
    expect(await screen.findByText('Start the node to see how it stores its data.')).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalled();
  });
});

describe('Storage changes', () => {
  const confirmIn = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name }));
  };

  it('switches an index on only after saying what will happen', async () => {
    const user = userEvent.setup();
    await renderPage(<StoragePage node={runningNode} />);
    const row = (await screen.findByText('Coin statistics index')).closest('li');
    if (!row) throw new Error('index row not found');
    await user.click(within(row).getByRole('button', { name: 'Switch on' }));
    expect(within(await screen.findByRole('alertdialog')).getByText(/builds it from the first block/)).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('nodes.storage.configure', expect.anything());
    await confirmIn(user, 'Save and restart');
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.storage.configure', {
      nodeId: 'node-1',
      change: { indexes: { coinstatsindex: true } },
      confirmed: true,
    });
  });

  it('keeps the indexes that need every block off while pruned', async () => {
    await renderPage(<StoragePage node={runningNode} />);
    const row = (await screen.findByText('Transaction index', { selector: 'p' })).closest('li');
    if (!row) throw new Error('index row not found');
    expect(within(row).getByRole('button', { name: 'Switch on' })).toHaveProperty('disabled', true);
  });

  it('prunes a full node and switches off the index that needs every block', async () => {
    overview = fullNode();
    const user = userEvent.setup();
    await renderPage(<StoragePage node={runningNode} />);
    await user.click(await screen.findByRole('button', { name: 'Prune this node…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/The transaction index and the spent-output index will be switched off/),
    ).toBeDefined();
    const field = within(dialog).getByLabelText('Blocks to keep (GiB)');
    await user.clear(field);
    await user.type(field, '0');
    expect(within(dialog).getByRole('button', { name: 'Prune and restart' })).toHaveProperty('disabled', true);
    await user.clear(field);
    await user.type(field, '20');
    await user.click(within(dialog).getByRole('button', { name: 'Prune and restart' }));
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.storage.configure', {
      nodeId: 'node-1',
      change: { pruning: { mode: 'automatic', targetMiB: 20 * 1024 }, indexes: { txindex: false } },
      confirmed: true,
    });
  });

  it('does not offer a full node again when the chain would not fit', async () => {
    const user = userEvent.setup();
    await renderPage(<StoragePage node={runningNode} />);
    await user.click(await screen.findByRole('button', { name: 'Become a full node again…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/There is not enough room: about 785 GiB is needed and 60 GiB is free/),
    ).toBeDefined();
    expect(within(dialog).getByRole('button', { name: 'Download the whole chain' })).toHaveProperty('disabled', true);
  });

  it('checks the latest blocks, rebuilds databases and deletes unused index files on request', async () => {
    const user = userEvent.setup();
    await renderPage(<StoragePage node={runningNode} />);
    await user.click(await screen.findByRole('button', { name: 'Check the latest blocks' }));
    expect(await screen.findByText('Bitcoin Core found no problems in the latest 6 blocks (1 s).')).toBeDefined();

    // A pruned node cannot rebuild its chainstate from blocks it no longer has.
    expect(screen.getByRole('button', { name: 'Rebuild the chainstate…' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Rebuild all databases…' }));
    expect(
      within(await screen.findByRole('alertdialog')).getByText(/downloads and verifies the whole chain again/),
    ).toBeDefined();
    await confirmIn(user, 'Restart and rebuild');
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.storage.reindex', {
      nodeId: 'node-1',
      scope: 'full',
      confirmed: true,
    });

    await user.click(screen.getByRole('button', { name: 'Delete these files…' }));
    await confirmIn(user, 'Delete files');
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.storage.removeIndexFiles', {
      nodeId: 'node-1',
      part: 'txindex',
      confirmed: true,
    });
  });

  it('offers no changes for a node BTCortex did not set up', async () => {
    overview = { ...OVERVIEW, manageable: false };
    await renderPage(<StoragePage node={runningNode} />);
    expect(await screen.findByText(/changes the storage of nodes it set up only/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Switch on' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete these files…' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check the latest blocks' })).toBeDefined();
  });
});
