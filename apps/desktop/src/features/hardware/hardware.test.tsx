import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HardwareOverview, Job, NodeSignerStatus, PsbtReview, SignerWalletDetail } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';
import { runningNode } from '@/testing/fixtures';
import { parseBitcoinAmount, parseFeeRate } from './amounts';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { HardwarePage } = await import('./hardware-page');

const OVERVIEW: HardwareOverview = {
  devices: [
    {
      id: '1209:53c1:A',
      vendor: 'trezor',
      model: null,
      mode: 'firmware',
      confidence: 'certain',
      vendorId: '1209',
      productId: '53c1',
      windowsName: 'TREZOR',
      driver: { ok: true, problemCode: null },
    },
    {
      id: '2c97:5011:B',
      vendor: 'ledger',
      model: 'Nano S Plus',
      mode: 'firmware',
      confidence: 'certain',
      vendorId: '2c97',
      productId: '5011',
      windowsName: 'Nano S Plus',
      driver: { ok: false, problemCode: 28 },
    },
  ],
  hwi: { version: '3.2.0', verifiedAt: '2026-10-23T03:00:00.000Z' },
  trezorSuite: { installed: null, running: false, holdsDevice: false },
  trezorBridge: { present: true, running: true, path: null },
  scannedAt: '2026-10-23T03:00:00.000Z',
};

const SIGNERS: NodeSignerStatus = {
  manageable: true,
  configured: true,
  restartRequired: false,
  running: true,
  signers: [{ fingerprint: 'd34db33f', name: 'trezor_safe 5' }],
  wallets: [{ name: 'Trezor', fingerprint: 'd34db33f', balanceSats: 50 * 1e8, pendingSats: 0, immatureSats: 0 }],
};

const DETAIL: SignerWalletDetail = {
  ...SIGNERS.wallets[0]!,
  addressTypes: ['bech32', 'bech32m'],
  transactions: [
    {
      txid: 'a'.repeat(64),
      amountSats: 50 * 1e8,
      confirmations: 101,
      time: '2026-10-23T02:00:00.000Z',
      category: 'generate',
    },
  ],
  pruned: false,
};

const REVIEW: PsbtReview = {
  psbt: 'cHNidP8BAA==',
  inputs: [{ txid: 'a'.repeat(64), vout: 0, amountSats: 50 * 1e8, address: 'bcrt1pinput' }],
  outputs: [
    { address: 'bcrt1qpayee000000000000000000000000000000', amountSats: 1e8, ownedByWallet: false },
    { address: 'bcrt1qchange00000000000000000000000000000', amountSats: 49 * 1e8 - 300, ownedByWallet: true },
  ],
  feeSats: 300,
  feeRateSatPerVb: 2,
  estimatedVsize: 150,
  next: 'updater',
  complete: false,
};

let overview: HardwareOverview;

beforeEach(() => {
  overview = OVERVIEW;
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'hardware.overview':
        return Promise.resolve(overview);
      case 'nodes.list':
        return Promise.resolve([runningNode]);
      case 'nodes.signers':
        return Promise.resolve(SIGNERS);
      case 'wallets.signer.detail':
        return Promise.resolve(DETAIL);
      case 'nodes.mempool':
        return Promise.resolve({ estimates: [{ target: 6, satPerVb: 3.2, blocks: 6 }] });
      case 'hardware.identify':
        return Promise.resolve([
          {
            type: 'trezor',
            model: 'trezor_safe 5',
            label: 'My Trezor',
            fingerprint: 'd34db33f',
            locked: false,
            needsPassphrase: false,
          },
        ]);
      case 'hardware.installHwi':
        return Promise.resolve({ jobId: 'job-1' });
      case 'jobs.get':
        return Promise.resolve({
          id: 'job-1',
          kind: 'hwi.install',
          title: 'Install HWI',
          state: 'running',
          progress: { stage: 'verifying-signatures', message: 'Checking.' },
          createdAt: '2026-10-23T03:00:00.000Z',
          updatedAt: '2026-10-23T03:00:01.000Z',
        } satisfies Job);
      case 'wallets.signer.newAddress':
        return Promise.resolve({ address: 'bcrt1qfresh0000000000000000000000000000000' });
      case 'wallets.signer.displayAddress':
        return Promise.resolve({ shown: true });
      case 'wallets.psbt.create':
        return Promise.resolve(REVIEW);
      case 'wallets.psbt.sign':
        return Promise.resolve({ review: { ...REVIEW, complete: true, next: 'extractor' }, hex: '0200000001abcdef' });
      case 'wallets.psbt.broadcast':
        return Promise.resolve({ txid: 'b'.repeat(64) });
      default:
        return Promise.reject(new Error(`unexpected ${method} ${JSON.stringify(params)}`));
    }
  });
});

describe('Hardware wallets', () => {
  it('lists connected devices with their driver state, and warns about the deprecated Trezor Bridge', async () => {
    await renderPage(<HardwarePage />);
    expect(await screen.findByText('Ledger Nano S Plus')).toBeDefined();
    // Every recent Trezor shares one USB identity, so the model is not named yet.
    expect(screen.getByText(/its model appears once HWI identifies it/)).toBeDefined();
    expect(screen.getByText('Windows reports a driver problem (code 28)')).toBeDefined();
    expect(screen.getByText(/Trezor has deprecated it/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Install Trezor Suite' })).toBeDefined();
  });

  it('identifies devices with HWI only when asked', async () => {
    const user = userEvent.setup();
    await renderPage(<HardwarePage />);
    expect(callOrchestrator).not.toHaveBeenCalledWith('hardware.identify', expect.anything(), expect.anything());
    await user.click(await screen.findByRole('button', { name: 'Identify with HWI' }));
    expect(await screen.findByText('trezor_safe 5', { selector: 'td' })).toBeDefined();
    expect(screen.getByText('My Trezor')).toBeDefined();
    expect(callOrchestrator).toHaveBeenCalledWith('hardware.identify', { network: 'mainnet' }, { timeoutMs: 120_000 });
  });

  it('installs HWI with its verification shown step by step', async () => {
    overview = { ...OVERVIEW, hwi: null };
    const user = userEvent.setup();
    await renderPage(<HardwarePage />);
    await user.click(await screen.findByRole('button', { name: 'Install HWI' }));
    expect(await screen.findByText('Checking the signatures')).toBeDefined();
  });

  it('warns when Trezor Suite holds the device', async () => {
    overview = {
      ...OVERVIEW,
      trezorSuite: {
        installed: { path: 'C:\\x', version: '26.10.2', installedByBtcortex: true },
        running: true,
        holdsDevice: true,
      },
    };
    await renderPage(<HardwarePage />);
    expect(await screen.findByText(/Close Trezor Suite before using the Trezor/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Trezor Suite is open' })).toHaveProperty('disabled', true);
  });

  it('shows a receiving address on the device before it is shared', async () => {
    const user = userEvent.setup();
    await renderPage(<HardwarePage />);
    await user.click(await screen.findByRole('button', { name: 'New address' }));
    expect(await screen.findByText('bcrt1qfresh0000000000000000000000000000000')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Show on the device' }));
    expect(await screen.findByText('The device showed the same address')).toBeDefined();
  });

  it('sends in separate steps: review, sign on the device after confirmation, then broadcast after confirmation', async () => {
    const user = userEvent.setup();
    await renderPage(<HardwarePage />);
    await user.type(await screen.findByLabelText('Pay to address'), 'bcrt1qpayee000000000000000000000000000000');
    await user.type(screen.getByLabelText('Amount in BTC'), '1');
    // The node's estimate for six blocks, rounded up.
    expect(screen.getByLabelText('Fee rate in sat/vB')).toHaveProperty('value', '4');
    await user.click(screen.getByRole('button', { name: 'Review the transaction' }));
    expect(callOrchestrator).toHaveBeenCalledWith('wallets.psbt.create', {
      nodeId: 'node-1',
      wallet: 'Trezor',
      outputs: [{ address: 'bcrt1qpayee000000000000000000000000000000', amountSats: 1e8 }],
      feeRateSatPerVb: 4,
    });
    expect(await screen.findByText('Not signed yet')).toBeDefined();
    expect(screen.getByText('Change, back to this wallet')).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('wallets.psbt.sign', expect.anything(), expect.anything());

    await user.click(screen.getByRole('button', { name: 'Sign on the hardware wallet…' }));
    const signDialog = await screen.findByRole('alertdialog');
    expect(within(signDialog).getByText(/Check the address and the amount on its screen/)).toBeDefined();
    await user.click(within(signDialog).getByRole('button', { name: 'Send to the device' }));
    expect(await screen.findByText('Signed and ready to send')).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('wallets.psbt.broadcast', expect.anything());

    await user.click(screen.getByRole('button', { name: 'Send to the network…' }));
    const sendDialog = await screen.findByRole('alertdialog');
    expect(within(sendDialog).getByText(/cannot be taken back/)).toBeDefined();
    await user.click(within(sendDialog).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Sent to the network')).toBeDefined();
    expect(callOrchestrator).toHaveBeenCalledWith('wallets.psbt.broadcast', {
      nodeId: 'node-1',
      hex: '0200000001abcdef',
      confirmed: true,
    });
  });

  it('refuses amounts and fee rates that are not numbers it can send', async () => {
    const user = userEvent.setup();
    await renderPage(<HardwarePage />);
    await user.type(await screen.findByLabelText('Amount in BTC'), '0.123456789');
    await user.click(screen.getByRole('button', { name: 'Review the transaction' }));
    expect(await screen.findByText('Enter an amount in BTC, with at most 8 decimals.')).toBeDefined();
    expect(screen.getByText('Enter the address you are paying.')).toBeDefined();
    expect(callOrchestrator).not.toHaveBeenCalledWith('wallets.psbt.create', expect.anything());
  });
});

describe('amounts', () => {
  it('converts bitcoin amounts to satoshis without floating point, accepting a decimal comma', () => {
    expect(parseBitcoinAmount('0.1')).toBe(10_000_000);
    expect(parseBitcoinAmount('0,00000001')).toBe(1);
    expect(parseBitcoinAmount('1')).toBe(100_000_000);
    expect(parseBitcoinAmount('21000001')).toBeNull();
    expect(parseBitcoinAmount('0.123456789')).toBeNull();
    expect(parseBitcoinAmount('1,000.5')).toBeNull();
    expect(parseBitcoinAmount('0')).toBeNull();
    expect(parseFeeRate('2')).toBe(2);
    expect(parseFeeRate('1,5')).toBe(1.5);
    expect(parseFeeRate('0.05')).toBeNull();
  });
});
