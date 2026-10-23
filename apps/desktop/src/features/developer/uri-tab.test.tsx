import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressCheck, ParsedPaymentUri, PaymentUri } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { AddressWithErrors, UriTab } = await import('./uri-tab');

const ADDRESS = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const CHECK: AddressCheck = {
  address: ADDRESS,
  valid: true,
  error: null,
  errorLocations: [],
  type: 'p2wpkh',
  scriptPubKey: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
  witnessVersion: 0,
  witnessProgram: '751e76e8199196d454941c45d1b3a323f1433bd6',
};
const MADE: PaymentUri = {
  uri: `bitcoin:${ADDRESS}?amount=0.00025&label=Rent`,
  qr: { size: 21, rows: Array.from({ length: 21 }, () => '1'.repeat(21)) },
  address: CHECK,
};
const READ: ParsedPaymentUri = {
  problems: ['It requires “somethingnew”, which BTCortex does not understand, so the whole URI is invalid.'],
  address: null,
  addressCheck: null,
  amountSats: 100_000_000,
  label: 'Coffee',
  message: null,
  instructions: [{ key: 'sp', kind: 'silent-payment', value: 'sp1example' }],
  proofOfPayment: { callback: 'wallet-callback:', required: true, allowedScheme: true },
  ignored: [{ key: 'colour', value: 'orange' }],
};

beforeEach(() => {
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string) => {
    if (method === 'devtools.uri.create') return Promise.resolve(MADE);
    if (method === 'devtools.uri.read') return Promise.resolve(READ);
    return Promise.reject(new Error(`unexpected ${method}`));
  });
});

describe('payment URIs', () => {
  it('makes a URI with its QR code for an address the node accepts', async () => {
    const user = userEvent.setup();
    await renderPage(<UriTab nodeId="r1" />);
    const [address] = await screen.findAllByLabelText('Address');
    if (!address) throw new Error('No address field.');
    await user.type(address, ADDRESS);
    await user.type(screen.getByLabelText('Amount (BTC)'), '0.00025');
    await user.type(screen.getByLabelText('Label'), 'Rent');
    await user.click(screen.getByRole('button', { name: 'Make the URI' }));
    expect(callOrchestrator).toHaveBeenCalledWith('devtools.uri.create', {
      nodeId: 'r1',
      address: ADDRESS,
      amountSats: 25_000,
      label: 'Rent',
    });
    expect(await screen.findByRole('img', { name: 'QR code of the payment URI' })).toBeDefined();
    expect(screen.getByText(MADE.uri)).toBeDefined();
    expect(screen.getByText('Valid on this node’s network: P2WPKH (native SegWit)')).toBeDefined();
  });

  it('refuses an amount below a satoshi before asking the node', async () => {
    const user = userEvent.setup();
    await renderPage(<UriTab nodeId="r1" />);
    await user.type(await screen.findByLabelText('Amount (BTC)'), '0.000000001');
    expect(screen.getByText('Smaller than a satoshi.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Make the URI' }).hasAttribute('disabled')).toBe(true);
  });

  it('reads a URI and explains every part, paying and opening nothing', async () => {
    const user = userEvent.setup();
    await renderPage(<UriTab nodeId="r1" />);
    await user.type(await screen.findByLabelText('Payment URI'), 'bitcoin:?sp=sp1example&req-somethingnew=1');
    await user.click(screen.getByRole('button', { name: 'Read' }));
    expect(await screen.findByText('Not a valid payment URI:')).toBeDefined();
    expect(screen.getByText(/requires “somethingnew”/)).toBeDefined();
    expect(screen.getByText('Silent payment address (BIP 352)')).toBeDefined();
    expect(screen.getByText('Not known: colour')).toBeDefined();
    expect(screen.getByText(/BTCortex never opens such callbacks/)).toBeDefined();
    expect(callOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('marks where the node found mistakes in an address', async () => {
    const { container } = await renderPage(
      <AddressWithErrors check={{ ...CHECK, valid: false, errorLocations: [4, 9] }} />,
    );
    await screen.findByText((_, element) => element?.tagName === 'SPAN' && element.textContent === ADDRESS);
    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([ADDRESS[4], ADDRESS[9]]);
  });
});
