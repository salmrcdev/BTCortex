import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppFailure } from '@btcortex/contracts';
import { GreenfieldError, GreenfieldTransportError } from '@btcortex/integration-btcpay';
import type { GreenfieldClientOptions, GreenfieldInvoice } from '@btcortex/integration-btcpay';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { openDatabase } from '../persistence/database';
import { migrations } from '../persistence/migrations';
import { SettingsStore } from '../persistence/settings';
import { addDecimal, checkServerAddress, PaymentService } from './payment-service';
import type { Greenfield } from './payment-service';

const logger = new StructuredLogger([new MemorySink()], 'debug');
const NOW = new Date('2026-10-23T12:00:00.000Z');

let root: string;
let database: DatabaseSync;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'btcortex-payments-'));
  database = openDatabase({ file: join(root, 'test.db'), migrations, logger });
});

afterEach(() => {
  database.close();
  rmSync(root, { recursive: true, force: true });
});

const invoice = (
  id: string,
  status: GreenfieldInvoice['status'],
  amount: string,
  minutesAgo: number,
): GreenfieldInvoice => ({
  id,
  status,
  amount,
  paidAmount: status === 'Settled' ? amount : '0',
  currency: 'EUR',
  createdTime: Math.floor(NOW.getTime() / 1000) - minutesAgo * 60,
  expirationTime: null,
  checkoutLink: `https://pay.example/i/${id}`,
  metadata: { orderId: `order-${id}` },
});

interface World {
  key?: string;
  unreachable?: boolean;
  noStores?: boolean;
  noWallet?: boolean;
  noInvoices?: boolean;
}

function fakeClient(world: World, seen: GreenfieldClientOptions[]) {
  return (options: GreenfieldClientOptions): Greenfield => {
    seen.push(options);
    const guard = () => {
      if (world.unreachable)
        throw new GreenfieldTransportError('pay.example cannot be reached (ENOTFOUND).', 'unreachable');
      if (options.apiKey !== (world.key ?? 'good-key-0123456789')) {
        throw new GreenfieldError('Authentication is required', 401, 'auth', 'unauthenticated');
      }
    };
    const denied = () => new GreenfieldError('Insufficient API Permissions.', 403, 'permission', 'missing-permission');
    return {
      health: () => {
        if (world.unreachable)
          return Promise.reject(new GreenfieldTransportError('pay.example cannot be reached.', 'unreachable'));
        return Promise.resolve({ synchronized: true });
      },
      serverInfo: () => {
        guard();
        return Promise.resolve({
          version: '2.4.5',
          onion: null,
          supportedPaymentMethods: ['BTC-CHAIN', 'BTC-LN'],
          fullySynched: true,
          syncStatus: [{ paymentMethodId: 'BTC-CHAIN', chainHeight: 950_000, syncHeight: 950_000, available: true }],
        });
      },
      stores: () => {
        guard();
        if (world.noStores) return Promise.reject(denied());
        return Promise.resolve([{ id: 'store-1', name: 'Coffee shop', defaultCurrency: 'EUR', archived: false }]);
      },
      paymentMethods: () =>
        Promise.resolve([
          { paymentMethodId: 'BTC-CHAIN', enabled: true },
          { paymentMethodId: 'BTC-LN', enabled: false },
        ]),
      wallet: () =>
        world.noWallet
          ? Promise.reject(denied())
          : Promise.resolve({ balance: '0.0125', confirmedBalance: '0.0120', unconfirmedBalance: '0.0005' }),
      invoices: () =>
        world.noInvoices
          ? Promise.reject(denied())
          : Promise.resolve([
              invoice('a', 'Settled', '4.50', 300),
              invoice('b', 'Settled', '0.05', 10),
              invoice('c', 'Expired', '12', 60),
              invoice('d', 'New', '3.20', 1),
            ]),
    };
  };
}

function setUp(world: World = {}) {
  const secrets = new Map<string, string>();
  const seen: GreenfieldClientOptions[] = [];
  let torPort: number | undefined;
  const service = new PaymentService({
    settings: new SettingsStore(database),
    vault: {
      store: (_purpose, plaintext) => {
        const id = `secret-${String(secrets.size + 1)}`;
        secrets.set(id, plaintext);
        return Promise.resolve(id);
      },
      reveal: (id) => Promise.resolve(secrets.get(id) ?? ''),
      remove: (id) => secrets.delete(id),
    },
    torSocksPort: () => torPort,
    logger,
    now: () => NOW,
    client: fakeClient(world, seen),
  });
  return {
    service,
    secrets,
    seen,
    setTor: (port: number | undefined) => {
      torPort = port;
    },
  };
}

const ADD = { name: 'Shop', url: 'https://pay.example/', apiKey: 'good-key-0123456789', via: 'direct' } as const;

describe('payment servers', () => {
  it('accepts HTTPS, onion services through Tor and plain HTTP only on the local network', () => {
    expect(checkServerAddress('https://pay.example/btcpay/', 'direct')).toEqual({
      url: 'https://pay.example/btcpay',
      via: 'direct',
    });
    expect(checkServerAddress('http://192.168.1.20:23000', 'direct').url).toBe('http://192.168.1.20:23000');
    expect(() => checkServerAddress('http://pay.example', 'direct')).toThrow(/in clear across the internet/);
    expect(() => checkServerAddress('http://abcdefghijklmnop.onion', 'direct')).toThrow(/choose Tor/);
    expect(checkServerAddress('http://abcdefghijklmnop.onion', 'tor').via).toBe('tor');
    expect(() => checkServerAddress('https://user:secret@pay.example', 'direct')).toThrow(/Leave the user name/);
    expect(() => checkServerAddress('pay.example', 'direct')).toThrow(/not a web address/);
  });

  it('tests the key before keeping it, and keeps it only in the vault', async () => {
    const { service, secrets } = setUp();
    const added = await service.add(ADD);
    expect(added.server).toMatchObject({ name: 'Shop', url: 'https://pay.example', via: 'direct', kind: 'btcpay' });
    expect(added.status).toMatchObject({
      state: 'online',
      version: '2.4.5',
      chains: [{ paymentMethodId: 'BTC-CHAIN', available: true }],
    });
    expect([...secrets.values()]).toEqual(['good-key-0123456789']);
    expect(JSON.stringify(service.list())).not.toContain('good-key');
    await expect(service.add(ADD)).rejects.toMatchObject({ error: { code: 'payments.duplicate' } });
  });

  it('says why a connection is refused, and keeps nothing', async () => {
    const wrongKey = setUp({ key: 'another-key-012345' });
    const failure = await wrongKey.service.add(ADD).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppFailure);
    expect(failure).toMatchObject({
      error: { code: 'payments.connection-failed', message: expect.stringContaining('refused the API key') as unknown },
    });
    expect(wrongKey.secrets.size).toBe(0);
    expect(wrongKey.service.list()).toEqual([]);

    const limited = setUp({ noStores: true });
    await expect(limited.service.add(ADD)).rejects.toMatchObject({ error: { code: 'payments.permission-missing' } });
    expect(limited.secrets.size).toBe(0);

    const offline = setUp({ unreachable: true });
    await expect(offline.service.add(ADD)).rejects.toMatchObject({
      error: { message: expect.stringContaining('cannot be reached') as unknown },
    });
  });

  it('reaches onion services only through BTCortex’s tor', async () => {
    const { service, setTor, seen } = setUp();
    const onion = {
      ...ADD,
      url: 'http://abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx.onion',
      via: 'tor',
    } as const;
    await expect(service.add(onion)).rejects.toMatchObject({ error: { code: 'payments.tor-needed' } });
    setTor(9150);
    await service.add(onion);
    expect(seen.at(-1)?.connect).toBeTypeOf('function');
    expect(seen.at(-1)?.timeoutMs).toBe(60_000);
  });

  it('sums up each store, and leaves out what the key may not read', async () => {
    const { service } = setUp();
    const { server } = await service.add(ADD);
    const dashboard = await service.dashboard(server.id, false);
    expect(dashboard.permissions).toEqual({ stores: true, invoices: true, wallet: true });
    const store = dashboard.stores[0];
    expect(store).toMatchObject({
      id: 'store-1',
      name: 'Coffee shop',
      currency: 'EUR',
      paymentMethods: [
        { id: 'BTC-CHAIN', enabled: true },
        { id: 'BTC-LN', enabled: false },
      ],
      balance: { total: '0.0125', confirmed: '0.0120', unconfirmed: '0.0005' },
    });
    expect(store?.invoices?.counts).toEqual({ New: 1, Processing: 0, Settled: 2, Expired: 1, Invalid: 0 });
    expect(store?.invoices?.settled).toEqual([{ currency: 'EUR', amount: '4.55' }]);
    expect(store?.invoices?.recent.map((entry) => entry.id)).toEqual(['d', 'b', 'c', 'a']);
    expect(store?.invoices?.recent[0]).toMatchObject({ orderId: 'order-d', createdAt: '2026-10-23T11:59:00.000Z' });

    const limited = setUp({ noWallet: true, noInvoices: true });
    const second = await limited.service.add({ ...ADD, url: 'https://shop.example' });
    const partial = await limited.service.dashboard(second.server.id, false);
    expect(partial.permissions).toEqual({ stores: true, invoices: false, wallet: false });
    expect(partial.stores[0]).toMatchObject({ balance: null, invoices: null });
  });

  it('forgets a server and its key', async () => {
    const { service, secrets } = setUp();
    const { server } = await service.add(ADD);
    service.remove(server.id);
    expect(service.list()).toEqual([]);
    expect(secrets.size).toBe(0);
  });

  it('adds amounts exactly', () => {
    expect(addDecimal('0', '4.50')).toBe('4.50');
    expect(addDecimal('4.50', '0.05')).toBe('4.55');
    expect(addDecimal('0.1', '0.2')).toBe('0.3');
    expect(addDecimal('0.00012345', '1')).toBe('1.00012345');
    expect(addDecimal('-1.5', '1')).toBe('-0.5');
  });
});
