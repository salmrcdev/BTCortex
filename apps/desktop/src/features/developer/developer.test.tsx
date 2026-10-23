import { useSearch } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NodeWithStatus,
  ProtocolFeatures,
  PsbtAnalysis,
  RawTransactionCheck,
  TrackedTransaction,
} from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { DeveloperPage } = await import('./developer-page');
type Tab = import('./tabs').DeveloperTab;

const NODE = {
  profile: { id: 'r1', name: 'Regtest node', network: 'regtest', execution: 'managed' },
  status: { nodeId: 'r1', state: 'running', checkedAt: '2026-10-23T08:00:00.000Z' },
} as unknown as NodeWithStatus;

const PSBT: PsbtAnalysis = {
  txid: 'aa'.repeat(32),
  version: 2,
  locktime: 0,
  inputs: [
    {
      outpoint: `${'bb'.repeat(32)}:0`,
      amountSats: 100_000_000,
      hasUtxo: true,
      partialSignatures: 0,
      final: false,
      missing: ['1 signature(s)'],
      next: 'signer',
    },
  ],
  outputs: [{ address: 'bcrt1qpayee', amountSats: 99_990_000, script: '0014' }],
  feeSats: 10_000,
  estimatedVsize: 110,
  estimatedFeeRateSatPerVb: 90.91,
  next: 'signer',
  raw: { tx: { txid: 'aa'.repeat(32) } },
};

const SIGNED: RawTransactionCheck = {
  transaction: {
    txid: 'cd'.repeat(32),
    wtxid: 'ce'.repeat(32),
    version: 2,
    lockTime: 0,
    sizeBytes: 222,
    vsize: 141,
    weight: 561,
    segwit: true,
    signalsReplaceable: true,
    status: { state: 'not-seen' },
    feeSats: 10_000,
    feeRate: 70.9,
    totalInputSats: 100_000_000,
    totalOutputSats: 99_990_000,
    inputs: [],
    outputs: [],
    hex: '02000000000101',
  },
  acceptance: { allowed: true },
};

const TRACKED: TrackedTransaction = {
  nodeId: 'r1',
  txid: 'cd'.repeat(32),
  addedAt: '2026-10-23T12:00:00.000Z',
  state: 'mempool',
  confirmations: 0,
  blockHash: null,
  blockHeight: null,
  checkedAt: '2026-10-23T12:00:00.000Z',
};

const FEATURES: ProtocolFeatures = {
  nodeId: 'r1',
  version: '31.1.0',
  features: [
    {
      id: 'deployment.taproot',
      title: 'Taproot and Schnorr signatures (BIP340–342)',
      category: 'consensus',
      state: 'on',
      detail: 'Active since block 1 (buried deployment).',
      since: null,
    },
    {
      id: 'cluster-mempool',
      title: 'Cluster mempool',
      category: 'relay-policy',
      state: 'on',
      detail: 'Clusters of at most 64 transactions.',
      since: '31.0',
    },
  ],
};

let tracked: TrackedTransaction[] = [];

beforeEach(() => {
  tracked = [];
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'nodes.list':
        return Promise.resolve([NODE]);
      case 'devtools.psbt':
        return Promise.resolve(PSBT);
      case 'devtools.psbt.combine':
        return Promise.resolve({ psbt: 'cHNidP8BAHcombined', analysis: { ...PSBT, next: 'finalizer' } });
      case 'devtools.psbt.finalise':
        return Promise.resolve({ complete: true, psbt: null, hex: SIGNED.transaction.hex });
      case 'explorer.decodeRaw':
        return Promise.resolve(SIGNED);
      case 'devtools.broadcast':
        return Promise.resolve({ txid: SIGNED.transaction.txid, tracked: TRACKED });
      case 'devtools.track.list':
        return Promise.resolve(tracked);
      case 'devtools.features':
        return Promise.resolve(FEATURES);
      case 'devtools.mine':
        return Promise.resolve({ hashes: Array.from({ length: Number(params['blocks']) }, () => 'h'), height: 104 });
      case 'devtools.zmq.status':
        return Promise.resolve({
          nodeId: 'r1',
          notifications: [{ type: 'pubhashblock', address: 'tcp://127.0.0.1:28372', hwm: 1000 }],
          watching: false,
          unavailableReason: null,
        });
      case 'devtools.zmq.watch':
        return Promise.resolve({
          nodeId: 'r1',
          notifications: [{ type: 'pubhashblock', address: 'tcp://127.0.0.1:28372', hwm: 1000 }],
          watching: params['watch'] === true,
          unavailableReason: null,
        });
      case 'devtools.probe':
        return Promise.resolve({
          reachable: true,
          steps: [
            { name: 'Connection', ok: true, durationMs: 3, detail: 'Connected to 127.0.0.1:50001' },
            { name: 'Answer', ok: true, durationMs: 5, detail: 'The Electrum server answered server.version.' },
          ],
          answer: '{"id":1,"result":["Fulcrum 2.1.4","1.4"]}',
        });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

function RoutedDeveloperPage() {
  const search: { tab?: Tab } = useSearch({ strict: false });
  return <DeveloperPage tab={search.tab} />;
}

describe('Developer tools', () => {
  it('decodes a PSBT with the chosen node and shows what it still needs', async () => {
    const user = userEvent.setup();
    await renderPage(<RoutedDeveloperPage />, '/developer');
    await user.click(await screen.findByRole('radio', { name: /PSBT/ }));
    await user.type(screen.getByLabelText(/^PSBT \(base64, or hexadecimal\)/), 'cHNidP8BAH0CAAAAAQ');
    await user.click(screen.getByRole('button', { name: 'Decode' }));
    expect(callOrchestrator).toHaveBeenCalledWith('devtools.psbt', { nodeId: 'r1', psbt: 'cHNidP8BAH0CAAAAAQ' });
    expect(await screen.findByText('1 signature(s)')).toBeDefined();
    expect(screen.getAllByText('signer').length).toBeGreaterThan(0);
    expect(screen.getByText('bcrt1qpayee')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open the RPC console' }).getAttribute('href')).toBe('/nodes/r1/console');
  });

  it('combines PSBTs, finalises them and sends the transaction only once the user confirms', async () => {
    const user = userEvent.setup();
    await renderPage(<RoutedDeveloperPage />, '/developer');
    await user.click(await screen.findByRole('radio', { name: /PSBT/ }));
    await user.type(
      screen.getByLabelText(/^PSBT \(base64, or hexadecimal\)/),
      'cHNidP8BAHfirst{enter}cHNidP8BAHsecond',
    );
    await user.click(screen.getByRole('button', { name: 'Decode' }));
    expect(callOrchestrator).toHaveBeenCalledWith('devtools.psbt.combine', {
      nodeId: 'r1',
      psbts: ['cHNidP8BAHfirst', 'cHNidP8BAHsecond'],
    });
    expect(await screen.findByText('The PSBTs combined into one:')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Finalise' }));
    expect(await screen.findByText('Every input is signed: this is the transaction.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Send to the network…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Send this transaction on Regtest?')).toBeDefined();
    expect(
      within(dialog).getByText(/cannot be taken back once it has been sent, although on this network/),
    ).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('devtools.broadcast', expect.anything());
    tracked = [TRACKED];
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(callOrchestrator).toHaveBeenCalledWith('devtools.broadcast', {
      nodeId: 'r1',
      hex: '02000000000101',
      confirmed: true,
    });
    expect(await screen.findByText('Waiting in the mempool')).toBeDefined();
  });

  it('says when the transactions followed cannot be loaded or stopped, instead of showing none', async () => {
    const answers = callOrchestrator.getMockImplementation();
    let listFails = true;
    callOrchestrator.mockImplementation((method: string, params: Record<string, unknown>) => {
      if (method === 'devtools.track.list' && listFails) return Promise.reject(new Error('The list is unreadable.'));
      if (method === 'devtools.track.remove') return Promise.reject(new Error('The node did not answer.'));
      return answers?.(method, params) as Promise<unknown>;
    });
    const user = userEvent.setup();
    await renderPage(<RoutedDeveloperPage />, '/developer');
    expect(await screen.findByText('The transactions followed could not be loaded')).toBeDefined();
    expect(screen.queryByText(/^Nothing is followed/)).toBeNull();

    listFails = false;
    tracked = [TRACKED];
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Waiting in the mempool')).toBeDefined();
    const shown = vi.spyOn(toast, 'error');
    await user.click(screen.getByRole('button', { name: /^Stop following/ }));
    await waitFor(() => {
      expect(shown).toHaveBeenCalledWith('The action could not be completed', {
        description: 'The node did not answer.',
      });
    });
    shown.mockRestore();
  });

  it('converts amounts in the window, refusing fractions of a satoshi', async () => {
    const user = userEvent.setup();
    await renderPage(<RoutedDeveloperPage />, '/developer?tab=convert');
    expect(await screen.findByText('100,000')).toBeDefined();
    const value = screen.getAllByLabelText('Value')[0];
    if (!value) throw new Error('The amount field is missing.');
    await user.clear(value);
    await user.type(value, '0.000000001');
    expect(screen.getByText('Smaller than a satoshi.')).toBeDefined();
  });

  it('estimates a transaction’s size and fee from its inputs and outputs', async () => {
    const user = userEvent.setup();
    await renderPage(<RoutedDeveloperPage />, '/developer?tab=convert');
    // One P2WPKH input to two P2WPKH outputs at 5 sat/vB.
    expect(await screen.findByText('141 vB')).toBeDefined();
    expect(screen.getByText(/^705 sats/)).toBeDefined();
    const taproot = screen.getAllByLabelText('P2TR (key path)')[0];
    if (!taproot) throw new Error('The Taproot input field is missing.');
    await user.clear(taproot);
    await user.type(taproot, '1');
    // Adding a Taproot key-path input: 562 + 230 weight units.
    expect(screen.getByText('198 vB')).toBeDefined();
  });

  it('lists protocol features by kind of rule', async () => {
    await renderPage(<RoutedDeveloperPage />, '/developer?tab=features');
    expect(await screen.findByRole('heading', { name: 'Consensus rules' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Relay policy' })).toBeDefined();
    expect(screen.getByText('Since 31.0')).toBeDefined();
  });

  it('generates regtest blocks and probes an endpoint', async () => {
    const user = userEvent.setup();
    const { router } = await renderPage(<RoutedDeveloperPage />, '/developer?tab=testnets');
    const blocks = await screen.findByLabelText('Blocks');
    await user.clear(blocks);
    await user.type(blocks, '2');
    await user.click(screen.getByRole('button', { name: 'Generate blocks' }));
    expect(callOrchestrator).toHaveBeenCalledWith('devtools.mine', { nodeId: 'r1', blocks: 2 });
    expect(await screen.findByText('Generated 2 blocks; the chain is at 104.')).toBeDefined();

    await router.navigate({ to: '/developer', search: { tab: 'endpoints' } });
    await user.click(await screen.findByRole('button', { name: 'Probe' }));
    await waitFor(() => {
      expect(callOrchestrator).toHaveBeenCalledWith(
        'devtools.probe',
        { kind: 'electrum', host: '127.0.0.1', port: 50001, tls: false, viaTor: false },
        { timeoutMs: 60_000 },
      );
    });
    expect(await screen.findByText('The Electrum server answered server.version.')).toBeDefined();
  });

  it('watches a node’s ZMQ notifications from the live events tab', async () => {
    const user = userEvent.setup();
    await renderPage(<RoutedDeveloperPage />, '/developer?tab=events');
    expect(await screen.findByText('tcp://127.0.0.1:28372')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Watch' }));
    expect(callOrchestrator).toHaveBeenCalledWith('devtools.zmq.watch', { nodeId: 'r1', watch: true });
    expect(await screen.findByRole('button', { name: 'Stop watching' })).toBeDefined();
  });
});
