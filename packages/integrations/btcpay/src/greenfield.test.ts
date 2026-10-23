import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { btcpayAuthorizeUrl as authorizeUrl } from '@btcortex/contracts';
import { GreenfieldClient, GreenfieldError, GreenfieldTransportError } from './greenfield';

// A stand-in for BTCPay Server answering the Greenfield routes BTCortex uses,
// with the shapes of the published OpenAPI document.

const requests: { path: string; authorization: string | undefined }[] = [];
let server: Server;
let base: string;

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function handle(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://localhost');
  requests.push({ path: `${url.pathname}${url.search}`, authorization: request.headers.authorization });
  const key = request.headers.authorization;
  const path = url.pathname.replace(/^\/btcpay/, '');
  if (path === '/api/v1/health') {
    json(response, 200, { synchronized: true });
    return;
  }
  if (path === '/not-btcpay/api/v1/health') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<html>Hello</html>');
    return;
  }
  if (path === '/moved/api/v1/health') {
    response.writeHead(302, { Location: 'https://elsewhere.example/' });
    response.end();
    return;
  }
  if (key !== 'token good-key' && key !== 'token limited-key') {
    json(response, 401, {
      code: 'unauthenticated',
      message: 'Authentication is required for accessing this endpoint',
    });
    return;
  }
  if (path === '/api/v1/server/info') {
    json(response, 200, {
      version: '2.4.5',
      onion: 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx.onion',
      supportedPaymentMethods: ['BTC-CHAIN', 'BTC-LN'],
      fullySynched: false,
      syncStatus: [
        {
          paymentMethodId: 'BTC-CHAIN',
          chainHeight: 950_000,
          syncHeight: 949_990,
          available: false,
          nodeInformation: {},
        },
      ],
    });
    return;
  }
  if (key === 'token limited-key') {
    json(response, 403, { code: 'missing-permission', message: 'Insufficient API Permissions.' });
    return;
  }
  if (path === '/api/v1/stores') {
    json(response, 200, [
      { id: 'store-1', name: 'Coffee shop', defaultCurrency: 'EUR', archived: false, website: null },
    ]);
    return;
  }
  if (path === '/api/v1/stores/store-1/invoices') {
    json(response, 200, [
      {
        id: 'inv-1',
        storeId: 'store-1',
        status: 'Settled',
        additionalStatus: 'None',
        amount: '4.50',
        paidAmount: '4.50',
        currency: 'EUR',
        createdTime: 1_792_000_000,
        expirationTime: 1_792_000_900,
        checkoutLink: 'https://pay.example/i/inv-1',
        metadata: { orderId: 'A-17', itemDesc: 'Flat white' },
      },
    ]);
    return;
  }
  if (path === '/api/v1/stores/store-1/payment-methods') {
    json(response, 200, [
      { paymentMethodId: 'BTC-CHAIN', enabled: true, config: {} },
      { paymentMethodId: 'BTC-LN', enabled: false, config: {} },
    ]);
    return;
  }
  if (path === '/api/v1/stores/store-1/payment-methods/BTC-CHAIN/wallet') {
    json(response, 200, { balance: '0.0125', confirmedBalance: '0.0120', unconfirmedBalance: '0.0005' });
    return;
  }
  json(response, 404, { code: 'store-not-found', message: 'The store was not found' });
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

describe('Greenfield client', () => {
  it('asks for health without the key and for everything else with it', async () => {
    const client = new GreenfieldClient({ baseUrl: `${base}/`, apiKey: 'good-key' });
    expect(await client.health()).toEqual({ synchronized: true });
    expect(requests.at(-1)?.authorization).toBeUndefined();
    const info = await client.serverInfo();
    expect(requests.at(-1)?.authorization).toBe('token good-key');
    expect(info).toMatchObject({
      version: '2.4.5',
      fullySynched: false,
      supportedPaymentMethods: ['BTC-CHAIN', 'BTC-LN'],
    });
    expect(info.syncStatus[0]).toMatchObject({
      paymentMethodId: 'BTC-CHAIN',
      chainHeight: 950_000,
      syncHeight: 949_990,
    });
  });

  it('reads stores, invoices, payment methods and the on-chain balance', async () => {
    const client = new GreenfieldClient({ baseUrl: `${base}/btcpay`, apiKey: 'good-key' });
    expect(await client.stores()).toEqual([
      { id: 'store-1', name: 'Coffee shop', defaultCurrency: 'EUR', archived: false },
    ]);
    const invoices = await client.invoices('store-1', { take: 20, startDate: 1_791_000_000 });
    expect(requests.at(-1)?.path).toBe('/btcpay/api/v1/stores/store-1/invoices?take=20&startDate=1791000000');
    expect(invoices[0]).toMatchObject({ id: 'inv-1', status: 'Settled', amount: '4.50', currency: 'EUR' });
    expect(invoices[0]?.metadata?.orderId).toBe('A-17');
    expect(await client.paymentMethods('store-1')).toEqual([
      { paymentMethodId: 'BTC-CHAIN', enabled: true },
      { paymentMethodId: 'BTC-LN', enabled: false },
    ]);
    expect(await client.wallet('store-1')).toEqual({
      balance: '0.0125',
      confirmedBalance: '0.0120',
      unconfirmedBalance: '0.0005',
    });
  });

  it('tells a wrong key from a missing permission', async () => {
    await expect(new GreenfieldClient({ baseUrl: base, apiKey: 'wrong' }).serverInfo()).rejects.toMatchObject({
      name: 'GreenfieldError',
      kind: 'auth',
      status: 401,
      code: 'unauthenticated',
    });
    const limited = new GreenfieldClient({ baseUrl: base, apiKey: 'limited-key' });
    await expect(limited.serverInfo()).resolves.toMatchObject({ version: '2.4.5' });
    const failure = await limited.stores().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GreenfieldError);
    expect(failure).toMatchObject({ kind: 'permission', message: 'Insufficient API Permissions.' });
  });

  it('refuses answers that are not BTCPay’s, redirects, and closed ports', async () => {
    await expect(new GreenfieldClient({ baseUrl: `${base}/not-btcpay` }).health()).rejects.toMatchObject({
      name: 'GreenfieldTransportError',
      failure: 'protocol',
    });
    await expect(new GreenfieldClient({ baseUrl: `${base}/moved` }).health()).rejects.toMatchObject({
      failure: 'protocol',
      message: expect.stringContaining('redirects elsewhere') as unknown,
    });
    const closed = new GreenfieldClient({ baseUrl: 'http://127.0.0.1:1' });
    const failure = await closed.health().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GreenfieldTransportError);
    expect(failure).toMatchObject({ failure: 'refused' });
    expect(() => new GreenfieldClient({ baseUrl: 'ftp://pay.example' })).toThrow(/https/);
  });

  it('builds the link to BTCPay’s own API key form with read-only permissions', () => {
    const link = new URL(authorizeUrl('https://pay.example.com/btcpay/'));
    expect(link.origin + link.pathname).toBe('https://pay.example.com/btcpay/api-keys/authorize');
    expect(link.searchParams.getAll('permissions')).toEqual([
      'btcpay.store.canviewstoresettings',
      'btcpay.store.canviewinvoices',
      'btcpay.store.canviewwallet',
    ]);
    expect(link.searchParams.get('applicationName')).toBe('BTCortex');
    expect(link.searchParams.get('strict')).toBe('true');
  });
});
