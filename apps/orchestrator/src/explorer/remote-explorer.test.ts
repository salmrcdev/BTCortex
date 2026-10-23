import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { GENESIS_HASHES } from '@btcortex/contracts';
import type { NodeWithStatus } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { explorerPageUrl, RemoteExplorerService } from './remote-explorer-service';

const logger = new StructuredLogger([new MemorySink()], 'debug');
const servers: Server[] = [];
const TXID = 'ab'.repeat(32);
/** The node's blocks after the genesis block, and those of a chain that shares its genesis block (as Knots does). */
const OUR_BLOCK = 'aa'.repeat(32);
const FORK_BLOCK = 'bb'.repeat(32);

/** A mempool instance serving the Esplora API under /api, on the chain whose genesis is given. */
function mempool(genesis: string, height: () => number, recent = OUR_BLOCK): Promise<string> {
  const server = createServer((request, response) => {
    const answers: Record<string, string> = {
      '/api/blocks/tip/height': String(height()),
      '/api/block-height/0': genesis,
    };
    const recentBlock = /^\/api\/block-height\/[1-9]\d*$/.test(request.url ?? '') ? recent : undefined;
    const body = answers[request.url ?? ''] ?? recentBlock;
    response.writeHead(body === undefined ? 404 : 200, { 'content-type': 'text/plain' });
    response.end(body ?? 'Not found');
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
    });
  });
}

function settings() {
  const values = new Map<string, string>();
  return {
    get: <T>(key: string, schema: z.ZodType<T>) => {
      const value = values.get(key);
      return value === undefined ? undefined : schema.parse(JSON.parse(value));
    },
    set: (key: string, value: unknown) => {
      values.set(key, JSON.stringify(value));
    },
  };
}

function service(options: { genesis?: string; blocks?: number; opened?: string[]; stored?: unknown[] } = {}) {
  const node = {
    profile: { id: 'n1', name: 'Regtest node', network: 'regtest' },
    status: { state: 'running', snapshot: { blockchain: { blocks: options.blocks ?? 105 } } },
  } as unknown as NodeWithStatus;
  const store = settings();
  if (options.stored) store.set('explorers.remote', options.stored);
  return new RemoteExplorerService({
    settings: store,
    nodes: {
      get: () => node,
      rpc: () => ({
        call: <T>(method: string, params?: unknown[]) =>
          Promise.resolve(
            (method === 'getblockcount'
              ? (options.blocks ?? 105)
              : method === 'getblockhash' && params?.[0] !== 0
                ? OUR_BLOCK
                : (options.genesis ?? GENESIS_HASHES.regtest)) as T,
          ),
      }),
    },
    socksPort: () => undefined,
    logger,
    openInBrowser: (url) => {
      options.opened?.push(url);
      return Promise.resolve();
    },
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('block explorers on other computers', () => {
  it('tests an explorer and tells its chain from its genesis block', async () => {
    const url = await mempool(GENESIS_HASHES.regtest, () => 101);
    expect(await service().test({ url, kind: 'mempool', via: 'direct' })).toEqual({
      reachable: true,
      apiUrl: `${url}/api`,
      genesisHash: GENESIS_HASHES.regtest,
      network: 'regtest',
      height: 101,
      error: null,
    });
    const nothing = await service().test({ url: 'http://127.0.0.1:1', kind: 'mempool', via: 'direct' });
    expect(nothing).toMatchObject({ reachable: false, network: null });
    expect(nothing.error).toMatch(/Nothing answers/);
  });

  it('adds an explorer for a node only when it follows the node’s chain, and says how far behind it is', async () => {
    let height = 101;
    const url = await mempool(GENESIS_HASHES.regtest, () => height);
    const remote = service({ blocks: 105 });
    const added = await remote.add({ name: 'Umbrel', url: `${url}/`, kind: 'mempool', via: 'direct', nodeId: 'n1' });
    expect(added).toMatchObject([
      {
        explorer: { name: 'Umbrel', url, apiUrl: `${url}/api`, network: 'regtest', nodeId: 'n1' },
        status: { state: 'online', height: 101, blocksBehind: 4 },
      },
    ]);
    height = 105;
    await remote.checkAll();
    expect(remote.list()[0]?.status).toMatchObject({ state: 'online', height: 105, blocksBehind: 0 });

    await expect(
      remote.add({ name: 'Again', url, kind: 'mempool', via: 'direct', nodeId: null }),
    ).rejects.toMatchObject({
      error: { code: 'explorers.remote.duplicate' },
    });
    const mainnet = await mempool(GENESIS_HASHES.mainnet, () => 900_000);
    await expect(
      remote.add({ name: 'Elsewhere', url: mainnet, kind: 'mempool', via: 'direct', nodeId: 'n1' }),
    ).rejects.toMatchObject({ error: { code: 'explorers.remote.wrong-chain' } });
  });

  it('notices when an explorer stops answering, and when it answers again', async () => {
    const url = await mempool(GENESIS_HASHES.regtest, () => 101);
    const remote = service();
    await remote.add({ name: 'Home', url, kind: 'mempool', via: 'direct', nodeId: null });
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    expect(await remote.checkOne(remote.list()[0]?.explorer.id ?? '')).toMatchObject({
      state: 'unreachable',
      height: 101,
    });
    expect(remote.list()[0]?.status.unreachableSince).not.toBeNull();
  });

  it('tells a chain that shares the genesis block apart by a recent block, as Bitcoin Knots’ does', async () => {
    const url = await mempool(GENESIS_HASHES.regtest, () => 101, FORK_BLOCK);
    await expect(
      service().add({ name: 'Knots box', url, kind: 'mempool', via: 'direct', nodeId: 'n1' }),
    ).rejects.toMatchObject({ error: { code: 'explorers.remote.wrong-chain' } });
  });

  it('follows a plain http:// explorer only on the local network', async () => {
    const remote = service();
    expect((await remote.test({ url: 'http://mempool.example.org', kind: 'mempool', via: 'direct' })).error).toMatch(
      /Plain http/,
    );
    expect((await remote.test({ url: 'http://umbrel.local:3006', kind: 'mempool', via: 'direct' })).error).not.toMatch(
      /Plain http/,
    );
  });

  it('gives the address of a page on an explorer reached through Tor instead of opening the browser', async () => {
    const opened: string[] = [];
    const explorer = (id: string, url: string) => ({
      id,
      name: id,
      url,
      apiUrl: `${url}/api`,
      kind: 'mempool',
      via: 'tor',
      network: 'mainnet',
      nodeId: null,
      addedAt: '2026-10-23T12:00:00.000Z',
    });
    const onion = `http://${'a'.repeat(56)}.onion`;
    const remote = service({
      opened,
      stored: [explorer('public', 'https://mempool.example'), explorer('hidden', onion)],
    });
    // The browser would connect directly, tying this computer's address to the transaction.
    expect(await remote.open('public', { kind: 'transaction', txid: TXID })).toEqual({
      opened: false,
      url: `https://mempool.example/tx/${TXID}`,
    });
    expect(await remote.open('hidden', { kind: 'block', hash: '00'.repeat(32) })).toEqual({
      opened: false,
      url: `${onion}/block/${'00'.repeat(32)}`,
    });
    expect(opened).toEqual([]);
  });

  it('opens its pages in the browser, except onion ones, whose address it gives instead', async () => {
    const opened: string[] = [];
    const url = await mempool(GENESIS_HASHES.regtest, () => 101);
    const remote = service({ opened });
    const [entry] = await remote.add({ name: 'Home', url, kind: 'mempool', via: 'direct', nodeId: null });
    expect(await remote.open(entry?.explorer.id ?? '', { kind: 'transaction', txid: TXID })).toEqual({
      opened: true,
      url: `${url}/tx/${TXID}`,
    });
    expect(opened).toEqual([`${url}/tx/${TXID}`]);
    const onion = `http://${'a'.repeat(56)}.onion`;
    expect(explorerPageUrl({ url: onion }, { kind: 'address', address: 'bcrt1qexampleaddress0000' })).toBe(
      `${onion}/address/bcrt1qexampleaddress0000`,
    );
    // An onion explorer needs BTCortex's tor, and an onion address needs Tor at all.
    expect((await service().test({ url: onion, kind: 'mempool', via: 'direct' })).error).toMatch(/through Tor/);
    expect((await service().test({ url: onion, kind: 'mempool', via: 'tor' })).error).toMatch(/tor is not running/);
  });
});
