import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AddressDetail,
  ExplorerOverview,
  ExplorerSearchResult,
  RawTransactionCheck,
  TransactionDetail,
} from '@btcortex/contracts';
import { runningNode } from '@/testing/fixtures';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { ExplorerPage } = await import('./explorer-page');

const TXID = 'a'.repeat(64);
const PARENT = 'b'.repeat(64);
const BLOCK = 'c'.repeat(64);

const OVERVIEW: ExplorerOverview = {
  chain: 'main',
  height: 950_123,
  bestBlockHash: BLOCK,
  difficulty: 1.2e14,
  networkHashRate: 8.5e20,
  transactions: { count: 1_200_000_000, perSecond: 6.2 },
  pruned: true,
  pruneHeight: 940_000,
  transactionIndex: false,
  addressLookups: false,
  feeEstimates: { nextBlock: 12.5, halfHour: 8, hour: 5, day: null },
  mempool: { transactions: 42_000, vsize: 120_000_000, minimumFeeRate: 1 },
  recentBlocks: [
    {
      hash: BLOCK,
      height: 950_123,
      time: 1_792_731_201,
      transactionCount: 3_412,
      sizeBytes: 1_650_000,
      medianFeeRate: 6.4,
    },
  ],
};

const TRANSACTION: TransactionDetail = {
  txid: TXID,
  wtxid: 'd'.repeat(64),
  version: 2,
  lockTime: 0,
  sizeBytes: 222,
  vsize: 141,
  weight: 561,
  segwit: true,
  signalsReplaceable: true,
  status: { state: 'confirmed', blockHash: BLOCK, blockHeight: 950_123, blockTime: 1_792_731_201, confirmations: 3 },
  feeSats: 705,
  feeRate: 5,
  totalInputSats: 150_000_705,
  totalOutputSats: 150_000_000,
  inputs: [
    {
      previous: { txid: PARENT, vout: 1 },
      sequence: 4_294_967_293,
      witness: ['30440220', '0322aa'],
      prevout: {
        valueSats: 150_000_705,
        coinbase: false,
        script: { hex: '0014aa', asm: '0 aa', type: 'witness_v0_keyhash', address: 'bc1qsender' },
      },
    },
  ],
  outputs: [
    {
      n: 0,
      valueSats: 150_000_000,
      unspent: false,
      script: { hex: '0014bb', asm: '0 bb', type: 'witness_v0_keyhash', address: 'bc1qrecipient' },
    },
  ],
  hex: '0200000001',
};

let searchResult: ExplorerSearchResult;
let address: AddressDetail;

beforeEach(() => {
  searchResult = { kind: 'transaction', id: TXID };
  address = {
    address: 'bc1qrecipient',
    script: { hex: '0014bb', asm: '0 bb', type: 'witness_v0_keyhash' },
    scripthash: 'e'.repeat(64),
    source: 'unavailable',
    unavailableReason: 'Bitcoin Core keeps no index of addresses.',
    balance: null,
    history: [],
    unspent: [],
  };
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    switch (method) {
      case 'nodes.list':
        return Promise.resolve([runningNode]);
      case 'explorer.overview':
        return Promise.resolve(OVERVIEW);
      case 'explorer.search':
        return Promise.resolve(searchResult);
      case 'explorer.transaction':
        return Promise.resolve(TRANSACTION);
      case 'explorer.address':
        return Promise.resolve(address);
      case 'explorer.decodeRaw':
        return Promise.resolve({
          transaction: { ...TRANSACTION, status: { state: 'not-seen' } },
          acceptance: { allowed: false, reason: 'min relay fee not met' },
        } satisfies RawTransactionCheck);
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Explorer', () => {
  it('shows the chain at a glance and says plainly what this node cannot look up', async () => {
    await renderPage(<ExplorerPage search={{}} />);
    expect(await screen.findByText('Fee estimates')).toBeDefined();
    expect(screen.getAllByRole('link', { name: '950,123' }).length).toBeGreaterThan(0);
    expect(screen.getByText('12.5 sat/vB')).toBeDefined();
    expect(screen.getByText(/blocks below height 940,000 are gone/)).toBeDefined();
    expect(screen.getByText(/keeps no transaction index/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Electrum servers' })).toBeDefined();
    expect(screen.getByText('850 EH/s')).toBeDefined();
  });

  it('finds what was searched for and goes there', async () => {
    const user = userEvent.setup();
    const { router } = await renderPage(<ExplorerPage search={{}} />);
    await user.type(await screen.findByLabelText('Search'), TXID);
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'explorer.search',
      { nodeId: 'node-1', query: TXID },
      { timeoutMs: 60_000 },
    );
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ node: 'node-1', tx: TXID });
    });
  });

  it('explains what can be searched for when nothing is found', async () => {
    searchResult = { kind: 'none', message: 'The node has no block at height 5000 yet.' };
    const user = userEvent.setup();
    await renderPage(<ExplorerPage search={{}} />);
    await user.type(await screen.findByLabelText('Search'), '5000');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/no block at height 5000 yet\. You can search for a block height/)).toBeDefined();
  });

  it('shows a transaction with its fee, the coins it spends and its outputs', async () => {
    await renderPage(<ExplorerPage search={{ node: 'node-1', tx: TXID }} />);
    expect(await screen.findByText('3 confirmations')).toBeDefined();
    expect(screen.getByText('5.00 sat/vB')).toBeDefined();
    expect(screen.getByRole('link', { name: 'bc1qsender' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'bc1qrecipient' })).toBeDefined();
    expect(screen.getByText('Spent')).toBeDefined();
    expect(screen.getByText(/replaceable \(BIP 125\)/)).toBeDefined();
  });

  it('checks a pasted raw transaction without broadcasting it', async () => {
    searchResult = { kind: 'raw-transaction', id: '0200000001' };
    const user = userEvent.setup();
    await renderPage(<ExplorerPage search={{}} />);
    await user.type(await screen.findByLabelText('Search'), '0200000001');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(
      await screen.findByText('The node’s mempool would refuse this transaction: min relay fee not met'),
    ).toBeDefined();
    expect(screen.getByText('Checked only: BTCortex has not broadcast it.')).toBeDefined();
  });

  it('forgets a failed decoding once something else is looked up', async () => {
    const answers = callOrchestrator.getMockImplementation();
    callOrchestrator.mockImplementation((method: string, ...rest: unknown[]) =>
      method === 'explorer.decodeRaw'
        ? Promise.reject(new Error('The node could not decode this transaction.'))
        : (answers?.(method, ...rest) as Promise<unknown>),
    );
    searchResult = { kind: 'raw-transaction', id: '0200000001' };
    const user = userEvent.setup();
    await renderPage(<ExplorerPage search={{}} />);
    const box = await screen.findByLabelText('Search');
    await user.type(box, '0200000001');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('The node could not decode this transaction.')).toBeDefined();

    searchResult = { kind: 'none', message: 'The node has no block at height 5000 yet.' };
    await user.clear(box);
    await user.type(box, '5000');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/no block at height 5000 yet/)).toBeDefined();
    expect(screen.queryByText('The node could not decode this transaction.')).toBeNull();
  });

  it('sends address lookups to the node’s own Electrum server, or says why it cannot', async () => {
    await renderPage(<ExplorerPage search={{ node: 'node-1', address: 'bc1qrecipient' }} />);
    expect(await screen.findByText(/keeps no index of addresses/)).toBeDefined();
    expect(screen.queryByText('Confirmed balance')).toBeNull();
  });
});
