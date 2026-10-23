import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoinScan, OutputLookup } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { CoinsTab } = await import('./coins-tab');

const WPKH = `0014${'11'.repeat(20)}`;
const TR = `5120${'22'.repeat(32)}`;
const coin = (
  n: number,
  valueSats: number,
  script: string,
  type: 'p2wpkh' | 'p2tr' | 'p2wsh',
  height: number,
  coinbase = false,
) => ({
  txid: n.toString(16).padStart(64, '0'),
  vout: 0,
  valueSats,
  height,
  coinbase,
  descriptor: `addr(bcrt1q${String(n)})`,
  script,
  type,
});

const SCAN: CoinScan = {
  height: 200,
  bestBlock: 'ff'.repeat(32),
  coins: [
    coin(1, 5_000_000_000, WPKH, 'p2wpkh', 101),
    coin(2, 5_000_000_000, WPKH, 'p2wpkh', 150, true),
    coin(3, 300, TR, 'p2tr', 190),
    coin(4, 1_000, TR, 'p2tr', 195),
    coin(5, 20_000, `0020${'33'.repeat(32)}`, 'p2wsh', 120),
  ],
  totalSats: 10_000_021_300,
  feeRates: [
    { blocks: 2, satPerVb: 20 },
    { blocks: 6, satPerVb: 5 },
    { blocks: 144, satPerVb: 1 },
  ],
  estimated: false,
};

const UNSPENT: OutputLookup = {
  txid: 'aa'.repeat(32),
  vout: 1,
  unspent: true,
  valueSats: 125_000,
  confirmations: 3,
  coinbase: false,
  script: { hex: WPKH, type: 'p2wpkh', address: 'bcrt1qexample' },
  bestBlock: 'ff'.repeat(32),
};

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: Record<string, unknown>) => {
    if (method === 'devtools.scan') return Promise.resolve(SCAN);
    if (method === 'devtools.output') {
      return Promise.resolve(
        params['vout'] === 1 ? UNSPENT : { ...UNSPENT, unspent: false, valueSats: null, script: null },
      );
    }
    return Promise.reject(new Error(`unexpected ${method}`));
  });
});

describe('coins', () => {
  it('weighs each coin against what it costs to spend', async () => {
    const user = userEvent.setup();
    await renderPage(<CoinsTab nodeId="r1" />);
    await user.type(
      await screen.findByLabelText('Addresses or descriptors, one per line'),
      'bcrt1qfirst{enter}wpkh(tpubD6Nz/0/*)',
    );
    await user.click(screen.getByRole('button', { name: 'Find coins' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'devtools.scan',
      { nodeId: 'r1', targets: ['bcrt1qfirst', 'wpkh(tpubD6Nz/0/*)'] },
      { timeoutMs: 660_000 },
    );
    expect(await screen.findByText(/^5 coins holding/)).toBeDefined();
    expect(screen.getByText(/these rates are examples/)).toBeDefined();

    const rows = screen.getAllByRole('row');
    const rowOf = (txid: string) => rows.find((row) => row.textContent.includes(txid.slice(-6)));
    // A coinbase with 51 confirmations cannot be spent yet.
    expect(within(rowOf(SCAN.coins[1]?.txid ?? '') ?? document.body).getByText('Not spendable yet')).toBeDefined();
    // 300 sats in a Taproot output is dust, and 1 000 sats costs more than it is worth at 20 sat/vB but not at 1.
    expect(within(rowOf(SCAN.coins[2]?.txid ?? '') ?? document.body).getByText('Dust')).toBeDefined();
    expect(
      within(rowOf(SCAN.coins[3]?.txid ?? '') ?? document.body).queryByText('Costs more than it is worth'),
    ).toBeNull();
    expect(within(rowOf(SCAN.coins[0]?.txid ?? '') ?? document.body).getByText('1,360 sats')).toBeDefined();

    expect(screen.getByText(/Spending the 3 spendable coins together/)).toBeDefined();
    expect(screen.getByText(/share an address with another/)).toBeDefined();
    expect(screen.getByText(/such as P2SH and P2WSH cost what their scripts need/)).toBeDefined();
  });

  it('looks up an output, spent or not', async () => {
    const user = userEvent.setup();
    await renderPage(<CoinsTab nodeId="r1" />);
    const field = await screen.findByLabelText('Output (transaction id:index)');
    await user.type(field, `${'aa'.repeat(32)}:1`);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('Unspent, 3 confirmations')).toBeDefined();
    expect(screen.getByText('bcrt1qexample')).toBeDefined();
    await user.clear(field);
    await user.type(field, `${'aa'.repeat(32)}:0`);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('Spent, or it never existed')).toBeDefined();
  });
});
