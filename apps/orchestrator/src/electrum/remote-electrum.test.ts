import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { join } from 'node:path';
import { createSecureContext, createServer as createTlsServer } from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { GENESIS_HASHES } from '@btcortex/contracts';
import type { NodeWithStatus } from '@btcortex/contracts';
import { blockHashOfHeader, readScripthash } from '@btcortex/integration-fulcrum';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { RemoteElectrumService } from './remote-electrum-service';

const logger = new StructuredLogger([new MemorySink()], 'debug');
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const SCRIPTHASH = 'ab'.repeat(32);
/** The header of the node's recent block, and one of another chain that shares the genesis block (as Knots does). */
const OUR_HEADER = '00'.repeat(80);
const FORK_HEADER = '01'.repeat(80);

/** An Electrum server answering the calls BTCortex makes, one JSON object per line. */
function answer(socket: Socket, genesis: string, header = OUR_HEADER) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const request = JSON.parse(buffer.slice(0, newline)) as { id: number; method: string };
      buffer = buffer.slice(newline + 1);
      const results: Record<string, unknown> = {
        'server.version': ['electrs/0.10.9', '1.4'],
        'server.features': { genesis_hash: genesis },
        'blockchain.headers.subscribe': { height: 101, hex: '' },
        'blockchain.block.header': header,
        'blockchain.scripthash.get_balance': { confirmed: 5000, unconfirmed: 0 },
        'blockchain.scripthash.get_history': [{ tx_hash: 'cd'.repeat(32), height: 100 }],
        'blockchain.scripthash.listunspent': [{ tx_hash: 'cd'.repeat(32), tx_pos: 0, value: 5000, height: 100 }],
      };
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: results[request.method] ?? null })}\n`);
      newline = buffer.indexOf('\n');
    }
  });
  socket.on('error', () => undefined);
}

const servers: Server[] = [];

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

const tcpServer = (genesis = GENESIS_HASHES.regtest, header = OUR_HEADER) =>
  listen(
    createServer((socket) => {
      answer(socket, genesis, header);
    }),
  );
let certificate = 'a';
const tlsServer = () =>
  listen(
    createTlsServer(
      {
        SNICallback: (_name, done) => {
          // Served from the fixture of the moment, so a test can swap certificates.
          done(
            null,
            createSecureContext({
              key: fixture(`test-${certificate}.key`),
              cert: fixture(`test-${certificate}.pem`),
            }),
          );
        },
        key: fixture('test-a.key'),
        cert: fixture('test-a.pem'),
      },
      (socket) => {
        answer(socket, GENESIS_HASHES.regtest);
      },
    ),
  );

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

function service(options: { genesis?: string; torPort?: number } = {}) {
  const node = { profile: { id: 'n1', name: 'Regtest node', network: 'regtest' } } as unknown as NodeWithStatus;
  return new RemoteElectrumService({
    settings: settings(),
    nodes: {
      get: () => node,
      rpc: () => ({
        call: <T>(method: string, params?: unknown[]) =>
          Promise.resolve(
            (method === 'getblockcount'
              ? 105
              : method === 'getblockhash' && params?.[0] !== 0
                ? blockHashOfHeader(OUR_HEADER)
                : (options.genesis ?? GENESIS_HASHES.regtest)) as T,
          ),
      }),
    },
    socksPort: () => options.torPort,
    logger,
  });
}

afterEach(async () => {
  certificate = 'a';
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('Electrum servers on other computers', () => {
  it('tests a server over TCP and tells its chain from its genesis block', async () => {
    const port = await tcpServer();
    expect(await service().test({ host: '127.0.0.1', port, tls: false, via: 'direct' })).toMatchObject({
      reachable: true,
      serverVersion: 'electrs/0.10.9',
      network: 'regtest',
      height: 101,
      certificate: null,
      error: null,
    });
    const nothing = await service().test({ host: '127.0.0.1', port: 1, tls: false, via: 'direct' });
    expect(nothing).toMatchObject({ reachable: false });
    expect(nothing.error).not.toBeNull();
  });

  it('adds a server for a node only when it follows the node’s chain, and answers its address lookups', async () => {
    const port = await tcpServer();
    const remote = service();
    const added = await remote.add({
      name: 'Umbrel',
      host: '127.0.0.1',
      port,
      tls: false,
      via: 'direct',
      certificateFingerprint: null,
      nodeId: 'n1',
    });
    expect(added).toMatchObject([
      { server: { name: 'Umbrel', nodeId: 'n1' }, status: { state: 'online', network: 'regtest' } },
    ]);
    const lookup = remote.lookupFor('n1');
    expect(lookup?.name).toBe('Umbrel');
    const summary = await readScripthash({
      port: 0,
      scripthash: SCRIPTHASH,
      socket: lookup?.open ?? (() => Promise.reject(new Error('none'))),
    });
    expect(summary.balance.confirmedSats).toBe(5000);
    expect(summary.unspent).toHaveLength(1);

    const mainnetServer = await tcpServer(GENESIS_HASHES.mainnet);
    await expect(
      remote.add({
        name: 'Elsewhere',
        host: '127.0.0.1',
        port: mainnetServer,
        tls: false,
        via: 'direct',
        certificateFingerprint: null,
        nodeId: 'n1',
      }),
    ).rejects.toMatchObject({ error: { code: 'electrum.remote.wrong-chain' } });
    await expect(
      remote.add({
        name: 'Again',
        host: '127.0.0.1',
        port,
        tls: false,
        via: 'direct',
        certificateFingerprint: null,
        nodeId: null,
      }),
    ).rejects.toMatchObject({ error: { code: 'electrum.remote.duplicate' } });
  });

  it('shows a self-signed certificate, pins it only once accepted, and notices when it changes', async () => {
    const port = await tlsServer();
    const remote = service();
    const tested = await remote.test({ host: 'localhost', port, tls: true, via: 'direct' });
    expect(tested.reachable).toBe(true);
    expect(tested.certificate).toMatchObject({ subject: 'localhost', publiclyTrusted: false });
    const fingerprint = tested.certificate?.fingerprint ?? '';
    expect(fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

    const params = { name: 'Home', host: 'localhost', port, tls: true, via: 'direct' as const, nodeId: null };
    await expect(remote.add({ ...params, certificateFingerprint: null })).rejects.toMatchObject({
      error: { code: 'electrum.remote.certificate-untrusted' },
    });
    const added = await remote.add({ ...params, certificateFingerprint: fingerprint });
    expect(added[0]?.server.certificateFingerprint).toBe(fingerprint);

    // Someone else's certificate: refused before a request is sent.
    certificate = 'b';
    await remote.checkAll();
    expect(remote.list()[0]?.status).toMatchObject({ state: 'certificate-changed' });
  });

  it('tells a chain that shares the genesis block apart by a recent block, as Bitcoin Knots’ does', async () => {
    const port = await tcpServer(GENESIS_HASHES.regtest, FORK_HEADER);
    await expect(
      service().add({
        name: 'Knots box',
        host: '127.0.0.1',
        port,
        tls: false,
        via: 'direct',
        certificateFingerprint: null,
        nodeId: 'n1',
      }),
    ).rejects.toMatchObject({ error: { code: 'electrum.remote.wrong-chain' } });
  });

  it('connects without TLS only on the local network or to an onion address', async () => {
    const remote = service();
    // Nothing is sent: the address is refused before any connection.
    expect((await remote.test({ host: 'electrum.example.net', port: 50001, tls: false, via: 'direct' })).error).toMatch(
      /Without TLS/,
    );
    expect((await remote.test({ host: 'electrum.example.net', port: 50001, tls: false, via: 'tor' })).error).toMatch(
      /Without TLS/,
    );
    expect(
      (await remote.test({ host: `${'a'.repeat(56)}.onion`, port: 50001, tls: false, via: 'tor' })).error,
    ).not.toMatch(/Without TLS/);
  });

  it('reaches onion addresses only through BTCortex’s tor', async () => {
    const onion = `${'a'.repeat(56)}.onion`;
    expect((await service().test({ host: onion, port: 50001, tls: false, via: 'direct' })).error).toMatch(
      /through Tor/,
    );
    expect((await service().test({ host: onion, port: 50001, tls: false, via: 'tor' })).error).toMatch(
      /tor is not running/,
    );
  });
});
