import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cookieCredentials, CookieFileError, parseCookie, staticCredentials } from './auth';
import { BitcoinRpcClient } from './client';
import { BitcoinRpcError, isTransient, RpcAuthenticationError, RpcForbiddenError, RpcTransportError } from './errors';

// A stand-in for bitcoind's HTTP JSON-RPC server, so the client is exercised
// over real HTTP. Integration tests against a real regtest node live elsewhere.

type Handler = (request: { method: string; params: unknown; auth: string | undefined; path: string }) => {
  status?: number;
  body?: unknown;
  delayMs?: number;
};

let server: Server;
let endpoint: string;
let handler: Handler;
let directory: string;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'btcortex-rpc-'));
  handler = () => ({ body: { jsonrpc: '2.0', id: 1, result: null } });
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    request.on('end', () => {
      const parsed = JSON.parse(raw) as { method: string; params: unknown };
      const answer = handler({
        method: parsed.method,
        params: parsed.params,
        auth: request.headers.authorization,
        path: request.url ?? '/',
      });
      setTimeout(() => {
        response.writeHead(answer.status ?? 200, { 'Content-Type': 'application/json' });
        response.end(answer.body === undefined ? '' : JSON.stringify(answer.body));
      }, answer.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  rmSync(directory, { recursive: true, force: true });
});

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

const blockchainInfo = {
  chain: 'regtest',
  blocks: 101,
  headers: 101,
  bestblockhash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
  difficulty: 4.6565423739069247e-10,
  time: 1_760_000_000,
  mediantime: 1_760_000_000,
  verificationprogress: 1,
  initialblockdownload: false,
  chainwork: '00000000000000000000000000000000000000000000000000000000000000cc',
  size_on_disk: 30_123,
  pruned: false,
  warnings: [],
  future_field_from_32: true,
};

describe('BitcoinRpcClient', () => {
  it('sends authenticated JSON-RPC 2.0 requests and validates typed results', async () => {
    handler = ({ method, auth }) => {
      expect(auth).toBe(basic('alice', 'secret'));
      return method === 'getblockchaininfo'
        ? { body: { jsonrpc: '2.0', id: 1, result: blockchainInfo } }
        : { body: { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } } };
    };
    const client = new BitcoinRpcClient({
      endpoint,
      credentials: staticCredentials({ username: 'alice', password: 'secret' }),
    });
    const info = await client.getBlockchainInfo();
    expect(info.chain).toBe('regtest');
    expect(info.warnings).toEqual([]);
    // Unknown fields from newer releases pass through.
    expect((info as Record<string, unknown>)['future_field_from_32']).toBe(true);
  });

  it('normalises the legacy string form of warnings', async () => {
    handler = () => ({
      body: { jsonrpc: '2.0', id: 1, result: { ...blockchainInfo, warnings: 'This is a pre-release test build' } },
    });
    const client = new BitcoinRpcClient({ endpoint, credentials: staticCredentials({ username: 'a', password: 'b' }) });
    expect((await client.getBlockchainInfo()).warnings).toEqual(['This is a pre-release test build']);
  });

  it('reloads a changed cookie after HTTP 401 and retries once', async () => {
    const cookiePath = join(directory, '.cookie');
    let current = `__cookie__:${'a'.repeat(64)}`;
    writeFileSync(cookiePath, current);
    handler = ({ auth }) =>
      auth === basic('__cookie__', current.split(':')[1] ?? '')
        ? { body: { jsonrpc: '2.0', id: 1, result: 42 } }
        : { status: 401 };

    const client = new BitcoinRpcClient({ endpoint, credentials: cookieCredentials(cookiePath) });
    expect(await client.call('getblockcount')).toBe(42);

    // The node restarted and wrote a new cookie.
    current = `__cookie__:${'b'.repeat(64)}`;
    writeFileSync(cookiePath, current);
    expect(await client.call('getblockcount')).toBe(42);
  });

  it('reports rejected credentials once the retry also fails', async () => {
    handler = () => ({ status: 401 });
    const client = new BitcoinRpcClient({
      endpoint,
      credentials: staticCredentials({ username: 'a', password: 'wrong' }),
    });
    await expect(client.call('getblockcount')).rejects.toBeInstanceOf(RpcAuthenticationError);
  });

  it('distinguishes whitelist refusals, node errors and warm-up', async () => {
    const client = new BitcoinRpcClient({ endpoint, credentials: staticCredentials({ username: 'a', password: 'b' }) });

    handler = () => ({ status: 403 });
    await expect(client.call('stop')).rejects.toBeInstanceOf(RpcForbiddenError);

    handler = () => ({ body: { jsonrpc: '2.0', id: 1, error: { code: -28, message: 'Loading block index…' } } });
    const warmup = await client.call('getblockchaininfo').catch((error: unknown) => error);
    expect(warmup).toBeInstanceOf(BitcoinRpcError);
    expect((warmup as BitcoinRpcError).isWarmingUp).toBe(true);
    expect(isTransient(warmup)).toBe(true);

    // Legacy JSON-RPC 1.1 style: HTTP 500 with both fields.
    handler = () => ({
      status: 500,
      body: { result: null, error: { code: -8, message: 'Block height out of range' }, id: 1 },
    });
    await expect(client.call('getblockhash', [999])).rejects.toMatchObject({ code: -8, method: 'getblockhash' });
  });

  it('times out slow answers and reports unreachable nodes', async () => {
    handler = () => ({ delayMs: 300, body: { jsonrpc: '2.0', id: 1, result: 1 } });
    const slow = new BitcoinRpcClient({
      endpoint,
      timeoutMs: 50,
      credentials: staticCredentials({ username: 'a', password: 'b' }),
    });
    await expect(slow.call('getblockcount')).rejects.toMatchObject({ failure: 'timeout' });

    const unreachable = new BitcoinRpcClient({
      endpoint: 'http://127.0.0.1:9',
      credentials: staticCredentials({ username: 'a', password: 'b' }),
    });
    const error = await unreachable.call('getblockcount').catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(RpcTransportError);
    expect((error as RpcTransportError).failure).toBe('unreachable');
  });

  it('rejects answers that do not match the expected schema', async () => {
    handler = () => ({ body: { jsonrpc: '2.0', id: 1, result: { chain: 'main' } } });
    const client = new BitcoinRpcClient({ endpoint, credentials: staticCredentials({ username: 'a', password: 'b' }) });
    await expect(client.getBlockchainInfo()).rejects.toMatchObject({ failure: 'invalid-response' });
  });

  it('routes wallet calls to the wallet endpoint and reports call statistics', async () => {
    let seenPath = '';
    handler = ({ path }) => {
      seenPath = path;
      return { body: { jsonrpc: '2.0', id: 1, result: [] } };
    };
    const client = new BitcoinRpcClient({
      endpoint,
      wallet: 'watch only',
      credentials: staticCredentials({ username: 'a', password: 'b' }),
    });
    const calls: string[] = [];
    client.onCall((statistics) => calls.push(`${statistics.method}:${String(statistics.ok)}`));
    await client.call('listunspent');
    expect(seenPath).toBe('/wallet/watch%20only');
    expect(calls).toEqual(['listunspent:true']);
  });
});

describe('cookie credentials', () => {
  it('parses cookies and explains missing or malformed files', async () => {
    const secret = '0123456789abcdef'.repeat(4);
    expect(parseCookie(`__cookie__:${secret}\n`)).toEqual({ username: '__cookie__', password: secret });
    expect(parseCookie('no-separator')).toBeUndefined();
    // Anything that is not exactly a Bitcoin Core cookie is refused, so other files are never sent as credentials.
    expect(parseCookie('alice:hunter2')).toBeUndefined();
    expect(parseCookie(`__cookie__:${secret}extra`)).toBeUndefined();
    expect(parseCookie('[section]\nkey: value')).toBeUndefined();

    await expect(cookieCredentials(join(directory, 'absent')).get()).rejects.toMatchObject({ reason: 'missing' });
    const malformed = join(directory, 'bad');
    writeFileSync(malformed, 'garbage');
    await expect(cookieCredentials(malformed).get()).rejects.toBeInstanceOf(CookieFileError);
  });
});
