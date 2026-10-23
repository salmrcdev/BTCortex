import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentDashboard, PaymentServerWithStatus } from '@btcortex/contracts';
import { renderPage } from '@/testing/render';

const callOrchestrator = vi.fn();

vi.mock('@/lib/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator')>();
  return { ...actual, callOrchestrator: (...args: unknown[]) => callOrchestrator(...args) as unknown };
});

const { PaymentsPage, formatAmount } = await import('./payments-page');

const SERVER: PaymentServerWithStatus = {
  server: {
    id: 'p1',
    kind: 'btcpay',
    name: 'Coffee shop',
    url: 'https://pay.example',
    via: 'direct',
    addedAt: '2026-10-22T08:00:00.000Z',
  },
  status: {
    serverId: 'p1',
    state: 'online',
    checkedAt: '2026-10-23T12:00:00.000Z',
    version: '2.4.5',
    onion: null,
    chains: [{ paymentMethodId: 'BTC-CHAIN', chainHeight: 950_000, syncHeight: 950_000, available: true }],
    error: null,
    unreachableSince: null,
  },
};

const DASHBOARD: PaymentDashboard = {
  serverId: 'p1',
  checkedAt: '2026-10-23T12:00:00.000Z',
  permissions: { stores: true, invoices: true, wallet: true },
  stores: [
    {
      id: 'store-1',
      name: 'Main counter',
      currency: 'EUR',
      archived: false,
      paymentMethods: [
        { id: 'BTC-CHAIN', enabled: true },
        { id: 'BTC-LN', enabled: false },
      ],
      balance: { total: '0.0125', confirmed: '0.0120', unconfirmed: '0.0005' },
      invoices: {
        recent: [
          {
            id: 'inv-1',
            status: 'Settled',
            additionalStatus: 'None',
            amount: '4.50',
            paidAmount: '4.50',
            currency: 'EUR',
            createdAt: '2026-10-23T11:00:00.000Z',
            expiresAt: null,
            orderId: 'A-17',
            checkoutLink: 'https://pay.example/i/inv-1',
          },
        ],
        counts: { New: 1, Processing: 0, Settled: 2, Expired: 1, Invalid: 0 },
        settled: [{ currency: 'EUR', amount: '4.55' }],
        complete: true,
      },
    },
  ],
};

let servers: PaymentServerWithStatus[] = [];

beforeEach(() => {
  servers = [];
  callOrchestrator.mockReset();
  callOrchestrator.mockImplementation((method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'payments.list':
        return Promise.resolve(servers);
      case 'payments.add':
        servers = [SERVER];
        return Promise.resolve({ ...SERVER, server: { ...SERVER.server, name: String(params['name']) } });
      case 'payments.dashboard':
        return Promise.resolve(DASHBOARD);
      case 'payments.remove':
        servers = [];
        return Promise.resolve({ removed: true });
      default:
        return Promise.reject(new Error(`unexpected ${method}`));
    }
  });
});

describe('Payments & merchants', () => {
  it('connects a server with a read-only key created in BTCPay itself', async () => {
    const user = userEvent.setup();
    await renderPage(<PaymentsPage />);
    expect(await screen.findByText('No BTCPay Server yet?')).toBeDefined();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Coffee shop');
    await user.type(screen.getByRole('textbox', { name: 'Address' }), 'https://pay.example/');
    const link = screen.getByRole('link', { name: /Create the key in BTCPay/ });
    const href = new URL(link.getAttribute('href') ?? '');
    expect(href.pathname).toBe('/api-keys/authorize');
    expect(href.searchParams.getAll('permissions')).toContain('btcpay.store.canviewinvoices');
    await user.type(screen.getByLabelText('API key'), 'abcdefghijklmnopqrstuvwxyz0123456789');
    await user.click(screen.getByRole('button', { name: 'Test and connect' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'payments.add',
      {
        name: 'Coffee shop',
        url: 'https://pay.example/',
        apiKey: 'abcdefghijklmnopqrstuvwxyz0123456789',
        via: 'direct',
      },
      { timeoutMs: 120_000 },
    );
    expect(await screen.findByRole('heading', { name: 'Main counter' })).toBeDefined();
  });

  it('reaches onion addresses through Tor', async () => {
    const user = userEvent.setup();
    await renderPage(<PaymentsPage />);
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Hidden shop');
    await user.type(screen.getByRole('textbox', { name: 'Address' }), 'http://abcdefghijklmnop.onion');
    expect(screen.getByText(/onion address, so BTCortex reaches it through its own tor/)).toBeDefined();
    expect(screen.queryByRole('radio', { name: /Directly/ })).toBeNull();
    await user.type(screen.getByLabelText('API key'), 'abcdefghijklmnopqrstuvwxyz0123456789');
    await user.click(screen.getByRole('button', { name: 'Test and connect' }));
    expect(callOrchestrator).toHaveBeenCalledWith(
      'payments.add',
      expect.objectContaining({ via: 'tor' }),
      expect.anything(),
    );
  });

  it('shows the server, each store’s methods, balance and invoices', async () => {
    servers = [SERVER];
    await renderPage(<PaymentsPage />);
    const store = (await screen.findByRole('heading', { name: 'Main counter' })).closest('section');
    if (!store) throw new Error('The store card is missing.');
    expect(within(store).getByText(/On chain · on/)).toBeDefined();
    expect(within(store).getByText(/Lightning · off/)).toBeDefined();
    expect(within(store).getByText('0.0125 BTC')).toBeDefined();
    expect(within(store).getByText('Settled: €4.55.')).toBeDefined();
    const table = within(store).getByRole('table');
    expect(within(table).getByText('A-17')).toBeDefined();
    expect(within(table).getByText('€4.50')).toBeDefined();
    expect(screen.getByText('On chain: synchronised at block 950000')).toBeDefined();
    expect(screen.getByText('Backing up BTCPay Server')).toBeDefined();
  });

  it('says what the key may not read', async () => {
    servers = [SERVER];
    callOrchestrator.mockImplementation((method: string) => {
      if (method === 'payments.list') return Promise.resolve(servers);
      if (method === 'payments.dashboard') {
        const store = DASHBOARD.stores[0];
        if (!store) throw new Error('fixture');
        return Promise.resolve({
          ...DASHBOARD,
          permissions: { stores: true, invoices: false, wallet: false },
          stores: [{ ...store, balance: null, invoices: null }],
        });
      }
      return Promise.reject(new Error(`unexpected ${method}`));
    });
    await renderPage(<PaymentsPage />);
    expect(await screen.findByText('The key may not read invoices.')).toBeDefined();
    expect(screen.getByText('The key may not read the wallet balance.')).toBeDefined();
  });

  it('disconnects only after confirmation', async () => {
    const user = userEvent.setup();
    servers = [SERVER];
    await renderPage(<PaymentsPage />);
    await user.click(await screen.findByRole('button', { name: 'Disconnect…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Nothing changes on the server/)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(callOrchestrator).toHaveBeenCalledWith('payments.remove', { serverId: 'p1' });
  });

  it('formats amounts in their currency', () => {
    expect(formatAmount('4.55', 'EUR')).toBe('€4.55');
    expect(formatAmount('0.0125', 'BTC')).toBe('0.0125 BTC');
    expect(formatAmount('12', 'USD')).toBe('US$12.00');
  });
});
