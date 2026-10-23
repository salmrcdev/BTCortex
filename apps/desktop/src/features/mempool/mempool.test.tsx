import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MempoolOverview, MempoolTransaction, MetricsPoint, NodeWithStatus } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';
import { runningNode } from '@/testing/fixtures';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { MempoolPage } = await import('./mempool-page');

const PARENT = 'aa'.repeat(32);
const CHILD = 'bb'.repeat(32);
const SIBLING = 'cc'.repeat(32);

const OVERVIEW: MempoolOverview = {
  loaded: true,
  transactions: 12_480,
  virtualBytes: 5_400_000,
  memoryUsageBytes: 125_829_120,
  maxMemoryBytes: 300_000_000,
  totalFeeBtc: 0.23456789,
  minimumFeeSatPerVb: 1,
  minimumRelayFeeSatPerVb: 0.1,
  incrementalRelayFeeSatPerVb: 0.1,
  unbroadcast: 0,
  fullRbf: true,
  clusterLimitCount: 64,
  clusterLimitVirtualBytes: 101_000,
  maxDataCarrierBytes: 100_000,
  feeRateBuckets: [
    { minimum: 0, maximum: 1, virtualBytes: 1_000_000, feeSats: 50_000 },
    { minimum: 1, maximum: 2, virtualBytes: 2_000_000, feeSats: 3_000_000 },
    { minimum: 2, maximum: 3, virtualBytes: 1_500_000, feeSats: 3_750_000 },
    { minimum: 200, maximum: null, virtualBytes: 10_000, feeSats: 2_500_000 },
  ],
  nextBlockMinimumSatPerVb: 2.5,
  estimates: [
    { target: 1, satPerVb: 12.5, blocks: 2 },
    { target: 6, satPerVb: 3, blocks: 6 },
    { target: 1008, satPerVb: null, blocks: null },
  ],
  policyFeatures: [
    { id: 'package-relay', supported: true, since: '28.0' },
    { id: 'cluster-mempool', supported: false, since: '31.0' },
  ],
};

// A parent paying 1 sat/vB with a child paying 50: mined together as one chunk.
const TRANSACTION: MempoolTransaction = {
  txid: PARENT,
  wtxid: PARENT,
  virtualBytes: 150,
  weight: 600,
  feeSats: 150,
  satPerVb: 1,
  seenAt: 1_761_040_000,
  heightWhenSeen: 900_000,
  ancestors: { count: 1, virtualBytes: 150, feeSats: 150 },
  descendants: { count: 3, virtualBytes: 450, feeSats: 7950 },
  chunk: { feeSats: 7650, weight: 1200, satPerVb: 25.5 },
  parents: [],
  children: [CHILD, SIBLING],
  replaceable: true,
  replacement: {
    minimumFeeSats: 7965,
    minimumSatPerVb: 53.1,
    replacedFeeSats: 7950,
    evicts: 2,
    mustImproveDiagram: true,
  },
  unbroadcast: false,
  cluster: {
    transactions: 3,
    weight: 1800,
    chunks: [
      { feeSats: 7650, weight: 1200, satPerVb: 25.5, txids: [PARENT, CHILD] },
      { feeSats: 300, weight: 600, satPerVb: 2, txids: [SIBLING] },
    ],
  },
  inputs: 1,
  outputs: [
    { index: 0, valueSats: 50_000, address: 'bcrt1qexampleaddress', type: 'witness_v0_keyhash' },
    { index: 1, valueSats: 0, type: 'nulldata' },
  ],
};

let metrics: MetricsPoint[] = [];
let overview: MempoolOverview = OVERVIEW;

beforeEach(() => {
  metrics = [];
  overview = OVERVIEW;
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: { txid?: string }) => {
    switch (method) {
      case 'nodes.mempool':
        return Promise.resolve(overview);
      case 'nodes.metrics':
        return Promise.resolve(metrics);
      case 'nodes.mempool.transaction':
        return params.txid === PARENT
          ? Promise.resolve(TRANSACTION)
          : Promise.reject(new Error('This transaction is not in the node’s mempool.'));
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Mempool', () => {
  it('shows this node’s mempool, its fee-rate distribution and fee estimates', async () => {
    const user = userEvent.setup();
    await renderPage(<MempoolPage node={runningNode} />);
    expect(await screen.findByText(/this node’s own mempool/)).toBeDefined();
    expect(screen.getByText('12.5k')).toBeDefined();
    expect(screen.getByText('12,480')).toBeDefined();
    expect(screen.getByText('5.40 MvB')).toBeDefined();
    expect(screen.getByText('0.23456789 BTC')).toBeDefined();
    expect(screen.getByText(/paying about 2.50 sat\/vB or more/)).toBeDefined();
    // Every column is its own keyboard stop that states its value.
    expect(screen.getByRole('img', { name: '1–2: 2.00 MvB, Fees 0.03000000 BTC' })).toHaveProperty('tabIndex', 0);

    await user.click(screen.getByRole('button', { name: 'Show table' }));
    const table = screen.getByRole('table', { name: 'Fee-rate distribution' });
    expect(within(table).getByText('200+')).toBeDefined();
    expect(within(table).getByText('10.00 kvB')).toBeDefined();

    expect(screen.getByText('Next block, about 10 minutes')).toBeDefined();
    expect(screen.getByText('Within 6 blocks, about 1 hour')).toBeDefined();
    expect(screen.getByText('Within 1008 blocks, about 7 days')).toBeDefined();
    expect(screen.getByText('12.5 sat/vB')).toBeDefined();
    expect(screen.getByText('Any unconfirmed transaction can be replaced')).toBeDefined();
    expect(screen.getByText('64 transactions, 101 kvB')).toBeDefined();
    const features = screen.getByRole('region', { name: 'Relay features of this version' });
    expect(within(features).getByText(/Since Bitcoin Core 28\.0/)).toBeDefined();
    expect(within(features).getByText(/Needs Bitcoin Core 31\.0 or later/)).toBeDefined();
    expect(screen.getByText(/The trend appears after two minutes/)).toBeDefined();
  });

  it('draws the size trend once there are samples and reads them out by keyboard', async () => {
    const user = userEvent.setup();
    metrics = [1_000_000, 1_100_000, 1_234_567].map((size, index) => ({
      at: new Date(Date.UTC(2026, 9, 21, 10, index)).toISOString(),
      blocks: 900_000,
      peers: 10,
      mempoolTransactions: 3000,
      mempoolVirtualBytes: size,
      mempoolMinimumFeeSatPerVb: 1,
    }));
    await renderPage(<MempoolPage node={runningNode} />);
    const chart = await screen.findByRole('img', {
      name: /^Mempool size over time\. Use the left and right arrow keys/,
    });
    chart.focus();
    await user.keyboard('{End}');
    expect(screen.getByText(/^1\.2 MvB, 21 Oct 2026/)).toBeDefined();
    await user.keyboard('{Home}');
    expect(screen.getByText(/^1\.0 MvB, 21 Oct 2026/)).toBeDefined();

    // One measure at a time, each on its own scale.
    await user.click(screen.getByRole('tab', { name: 'Transactions' }));
    expect(
      await screen.findByRole('img', { name: /^Transactions waiting over time\. Use the left and right arrow keys/ }),
    ).toBeDefined();
    expect(screen.queryByRole('img', { name: /^Mempool size over time/ })).toBeNull();
  });

  it('explains the rate a transaction is really mined at when a child pays for it', async () => {
    const user = userEvent.setup();
    await renderPage(<MempoolPage node={runningNode} />);
    const field = await screen.findByLabelText('Transaction ID');
    await user.type(field, 'not-a-txid');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter a transaction ID: 64 hexadecimal characters.');
    expect(callOrchestrator).not.toHaveBeenCalledWith('nodes.mempool.transaction', expect.anything());

    await user.clear(field);
    await user.type(field, ` ${PARENT.toUpperCase()} `);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText(/A descendant pays for this transaction \(CPFP\)/)).toBeDefined();
    expect(callOrchestrator).toHaveBeenCalledWith('nodes.mempool.transaction', { nodeId: 'node-1', txid: PARENT });
    expect(screen.getByText(/mined at 25.5 sat\/vB, more than its own rate/)).toBeDefined();
    expect(screen.getByText('2 others, 450 vB including this one')).toBeDefined();
    expect(screen.getByText('150 sats')).toBeDefined();
    expect(
      screen.getByText('A replacement of the same size must pay at least 7,965 sats (53.1 sat/vB).'),
    ).toBeDefined();
    expect(screen.getByText(/7,950 sats paid by this transaction and its 2 descendants/)).toBeDefined();
    const chunks = screen.getByRole('table', { name: /Its cluster of 3 transactions is mined in these chunks/ });
    expect(within(chunks).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('nulldata')).toBeDefined();
    expect(screen.getByText('0.00050000 BTC')).toBeDefined();
  });

  it('says when a transaction cannot be found', async () => {
    const user = userEvent.setup();
    await renderPage(<MempoolPage node={runningNode} />);
    await user.type(await screen.findByLabelText('Transaction ID'), 'dd'.repeat(32));
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('The transaction cannot be shown')).toBeDefined();
  });

  it('explains when the node gives no fee-rate breakdown', async () => {
    overview = { ...OVERVIEW, feeRateBuckets: null, nextBlockMinimumSatPerVb: null };
    await renderPage(<MempoolPage node={runningNode} />);
    expect(await screen.findByText(/does not report a fee-rate breakdown/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Show table' })).toBeNull();
  });

  it('asks for the node to be running', async () => {
    const stopped: NodeWithStatus = { ...runningNode, status: { ...runningNode.status, state: 'stopped' } };
    await renderPage(<MempoolPage node={stopped} />);
    expect(await screen.findByText('Start the node to see its mempool.')).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('nodes.mempool', expect.anything());
  });
});
