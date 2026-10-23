import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyDetachedSignatures } from '@btcortex/installation-manager';
import {
  buildFulcrumConfig,
  fetchLatestFulcrumVersion,
  FULCRUM_TRUSTED_KEYS,
  fulcrumCredentialsEnvironment,
  fulcrumDatabaseMemory,
  FulcrumConfigError,
  fulcrumReleaseFiles,
  isFulcrumCompatiblePath,
  LineRpcConnection,
  LineRpcError,
  parseFulcrumInfo,
  parseFulcrumLogLine,
  parseFulcrumStats,
  parseFulcrumVersion,
  probeElectrumServer,
  readFulcrumLogTail,
  readFulcrumPid,
  requestFulcrumStop,
} from './index';

const servers: Server[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A line-based JSON-RPC server answering with `answer`, which may also push notifications. */
async function fakeServer(
  answer: (request: { id: number; method: string; params: unknown[] }, socket: Socket) => unknown,
  lineEnding = '\n',
): Promise<number> {
  const server = createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let end = buffer.indexOf('\n');
      while (end !== -1) {
        const request = JSON.parse(buffer.slice(0, end)) as { id: number; method: string; params: unknown[] };
        buffer = buffer.slice(end + 1);
        const reply = answer(request, socket);
        if (reply !== undefined) socket.write(`${JSON.stringify(reply)}${lineEnding}`);
        end = buffer.indexOf('\n');
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

describe('Fulcrum releases', () => {
  it('names the signed checksums and the Windows archive of a release', () => {
    expect(fulcrumReleaseFiles('2.1.4')).toEqual({
      manifest: 'https://github.com/cculianu/Fulcrum/releases/download/v2.1.4/Fulcrum-2.1.4-shasums.txt',
      signature: 'https://github.com/cculianu/Fulcrum/releases/download/v2.1.4/Fulcrum-2.1.4-shasums.txt.asc',
      archiveName: 'Fulcrum-2.1.4-win64.zip',
      archive: 'https://github.com/cculianu/Fulcrum/releases/download/v2.1.4/Fulcrum-2.1.4-win64.zip',
      root: 'Fulcrum-2.1.4-win64',
    });
    expect(() => fulcrumReleaseFiles('2.1.4/../x')).toThrow(/not a Fulcrum release/);
  });

  it('accepts the latest final release only', async () => {
    const answer = (body: unknown) =>
      (() => Promise.resolve(new Response(JSON.stringify(body)))) as unknown as typeof fetch;
    expect(await fetchLatestFulcrumVersion(answer({ tag_name: 'v2.1.4' }))).toBe('2.1.4');
    await expect(fetchLatestFulcrumVersion(answer({ tag_name: 'v2.2.0', prerelease: true }))).rejects.toThrow(
      /not a final release/,
    );
  });

  it('verifies the real 2.1.4 checksums with the pinned DSA key, and refuses altered ones', async () => {
    const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'testing', name));
    const signature = fixture('Fulcrum-2.1.4-shasums.txt.asc').toString('utf8');
    const manifest = fixture('Fulcrum-2.1.4-shasums.txt');
    const good = await verifyDetachedSignatures(manifest, signature, { keys: FULCRUM_TRUSTED_KEYS, threshold: 1 });
    expect(good.meetsThreshold).toBe(true);
    expect(good.validSigners[0]?.fingerprint).toBe('D465135F97D0047E18E99DC321810A542031C02C');
    const altered = Buffer.from(manifest.toString('utf8').replace('9e8b', '0e8b'));
    const bad = await verifyDetachedSignatures(altered, signature, { keys: FULCRUM_TRUSTED_KEYS, threshold: 1 });
    expect(bad.meetsThreshold).toBe(false);
  });

  it('reads the version Fulcrum.exe prints', () => {
    expect(
      parseFulcrumVersion('Fulcrum 2.1.4 (Release 02e22da9)\nProtocol: version min: 1.4, version max: 1.6\n'),
    ).toBe('2.1.4');
    expect(parseFulcrumVersion('something else')).toBeUndefined();
  });
});

describe('Fulcrum configuration', () => {
  const options = {
    dataDirectory: 'D:\\BTCortex\\electrum\\node-1',
    bitcoind: { host: '127.0.0.1', port: 8332 },
    cookieFile: 'C:\\Users\\Bob\\AppData\\Local\\Bitcoin\\.cookie',
    ports: { electrum: 50001, admin: 50100, stats: 50101 },
    pidFile: 'C:\\Users\\Bob\\AppData\\Local\\BTCortex\\electrum\\node-1\\fulcrum.pid',
  };

  it('binds every port to loopback and keeps Fulcrum private', () => {
    const text = buildFulcrumConfig({ ...options, databaseMemoryMiB: 1024 });
    expect(text).toContain('tcp = 127.0.0.1:50001\n');
    expect(text).toContain('admin = 127.0.0.1:50100\n');
    expect(text).toContain('stats = 127.0.0.1:50101\n');
    expect(text).toContain('peering = false\nannounce = false\nupnp = false\n');
    expect(text).toContain('rpccookie = C:\\Users\\Bob\\AppData\\Local\\Bitcoin\\.cookie\n');
    expect(text).toContain('db_mem = 1024\n');
    expect(text).not.toMatch(/rpcpassword|rpcuser|0\.0\.0\.0/);
  });

  it('leaves the password out of the file', () => {
    const { cookieFile: _cookieFile, ...withoutCookie } = options;
    const text = buildFulcrumConfig(withoutCookie);
    expect(text).not.toContain('rpccookie');
    expect(text).not.toContain('db_mem');
    expect(fulcrumCredentialsEnvironment({ username: 'fulcrum', password: 'secret' })).toEqual({
      RPCUSER: 'fulcrum',
      RPCPASSWORD: 'secret',
    });
  });

  it('refuses paths Fulcrum or its database cannot use', () => {
    expect(isFulcrumCompatiblePath('C:\\Users\\José\\data')).toBe(false);
    expect(isFulcrumCompatiblePath('C:\\data #1')).toBe(false);
    expect(isFulcrumCompatiblePath('C:\\Users\\JOSE~1\\data dir')).toBe(true);
    expect(() => buildFulcrumConfig({ ...options, dataDirectory: 'C:\\Users\\José\\data' })).toThrow(
      FulcrumConfigError,
    );
    expect(() => buildFulcrumConfig({ ...options, cookieFile: 'C:\\a\nupnp = true' })).toThrow(FulcrumConfigError);
    expect(() => buildFulcrumConfig({ ...options, pidFile: 'relative\\fulcrum.pid' })).toThrow(/absolute/);
    expect(() => buildFulcrumConfig({ ...options, ports: { ...options.ports, admin: 70000 } })).toThrow(/valid port/);
  });

  it('gives the database less memory on smaller computers', () => {
    const gib = 1024 ** 3;
    expect(fulcrumDatabaseMemory(32 * gib)).toBeUndefined();
    expect(fulcrumDatabaseMemory(8 * gib)).toBe(1024);
    expect(fulcrumDatabaseMemory(6 * gib)).toBe(512);
  });
});

describe('Fulcrum status', () => {
  it('reads indexing progress from /stats', () => {
    const indexing = parseFulcrumStats({
      'Bitcoin Daemon': {
        'bitcoind info': { subversion: '/Satoshi:31.1.0/', zmqNotifications: [['hashblock', 'tcp://127.0.0.1:28332']] },
      },
      Controller: {
        Chain: 'regtest',
        'Header count': 1139,
        StateMachine: { Height: 3001, State: 'DownloadingBlocks', 'Blocks downloaded this run': 1148 },
        tasks: [],
      },
    });
    expect(indexing).toEqual({
      chain: 'regtest',
      indexedHeight: 1138,
      targetHeight: 3001,
      activity: 'DownloadingBlocks',
      node: { subversion: '/Satoshi:31.1.0/', zmqBlockNotifications: true },
    });
    const starting = parseFulcrumStats({ Controller: { Chain: '', 'Header count': 0, StateMachine: null } });
    expect(starting).toMatchObject({
      chain: null,
      indexedHeight: null,
      targetHeight: null,
      activity: null,
      node: null,
    });
    expect(() => parseFulcrumStats({})).toThrow(/Controller/);
  });

  it('reads the figures of a running server from getinfo', () => {
    const info = parseFulcrumInfo({
      chain: 'regtest',
      clients_connected: 2,
      genesis_hash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
      height: 110,
      memory_usage: { physical_kb: 46140, virtual_kb: 95280 },
      pid: 624,
      subscriptions: 4,
      txs_sent: 0,
      uptime: '1.0 secs',
      version: 'Fulcrum 2.1.4',
    });
    expect(info).toEqual({
      version: 'Fulcrum 2.1.4',
      chain: 'regtest',
      height: 110,
      genesisHash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
      clients: 2,
      uptime: '1.0 secs',
      pid: 624,
      memoryBytes: 46140 * 1024,
      subscriptions: 4,
      transactionsSent: 0,
    });
    expect(() => parseFulcrumInfo({ version: 'Fulcrum 2.1.4' })).toThrow(/unexpected shape/);
  });

  it('splits log lines and recognises trouble by its wording', () => {
    expect(parseFulcrumLogLine('[2026-10-23 03:04:02.414] <Controller> Block height 3001, up-to-date')).toEqual({
      time: '2026-10-23T03:04:02.414Z',
      source: 'Controller',
      message: 'Block height 3001, up-to-date',
      severity: 'info',
    });
    expect(
      parseFulcrumLogLine('[2026-10-23 03:06:51.220] FATAL: Caught exception: Error opening fulc2_db'),
    ).toMatchObject({ severity: 'error' });
    expect(
      parseFulcrumLogLine('[2026-10-23 03:06:51.220] <BitcoinD.1> Lost connection to bitcoind, will retry'),
    ).toMatchObject({ severity: 'warning', source: 'BitcoinD.1' });
    expect(parseFulcrumLogLine('no timestamp')).toBeUndefined();
  });

  it('reads the pid file and the end of the log', () => {
    const directory = mkdtempSync(join(tmpdir(), 'btcortex-fulcrum-'));
    directories.push(directory);
    writeFileSync(join(directory, 'fulcrum.pid'), '624\n');
    expect(readFulcrumPid(join(directory, 'fulcrum.pid'))).toBe(624);
    expect(readFulcrumPid(join(directory, 'missing.pid'))).toBeUndefined();
    writeFileSync(join(directory, 'fulcrum.log'), 'one\r\ntwo\n\nthree\n');
    expect(readFulcrumLogTail(join(directory, 'fulcrum.log'), 2)).toEqual(['two', 'three']);
  });
});

describe('line-based JSON-RPC', () => {
  it('matches answers to requests, accepts CRLF and reports errors', async () => {
    const port = await fakeServer(
      (request) =>
        request.method === 'fail'
          ? { id: request.id, jsonrpc: '2.0', error: { code: -32601, message: 'unknown method' } }
          : { id: request.id, jsonrpc: '2.0', result: { echo: request.method } },
      '\r\n',
    );
    const connection = await LineRpcConnection.open({ port });
    const [first, second] = await Promise.all([connection.request('getinfo'), connection.request('clients')]);
    expect(first).toEqual({ echo: 'getinfo' });
    expect(second).toEqual({ echo: 'clients' });
    await expect(connection.request('fail')).rejects.toMatchObject({ code: -32601, message: 'unknown method' });
    connection.close();
    await expect(connection.request('getinfo')).rejects.toMatchObject({ failure: 'closed' });
  });

  it('times out, and tells when nothing listens', async () => {
    const port = await fakeServer(() => undefined);
    const connection = await LineRpcConnection.open({ port, timeoutMs: 200 });
    await expect(connection.request('getinfo')).rejects.toMatchObject({ failure: 'timeout' });
    connection.close();
    const server = servers.pop();
    await new Promise((resolve) => server?.close(resolve));
    await expect(LineRpcConnection.open({ port, timeoutMs: 2_000 })).rejects.toBeInstanceOf(LineRpcError);
  });

  it('passes notifications to listeners', async () => {
    const port = await fakeServer((request, socket) => {
      if (request.method === 'blockchain.headers.subscribe') {
        setTimeout(() => {
          socket.write(
            `${JSON.stringify({ jsonrpc: '2.0', method: 'blockchain.headers.subscribe', params: [{ height: 111 }] })}\n`,
          );
        }, 20);
      }
      return { id: request.id, jsonrpc: '2.0', result: { height: 110 } };
    });
    const connection = await LineRpcConnection.open({ port });
    const notified = new Promise((resolve) => {
      connection.onNotification((method, params) => {
        resolve({ method, params });
      });
    });
    expect(await connection.request('blockchain.headers.subscribe')).toEqual({ height: 110 });
    expect(await notified).toEqual({ method: 'blockchain.headers.subscribe', params: [{ height: 111 }] });
    connection.close();
  });

  it('stops Fulcrum through its admin port', async () => {
    const seen: string[] = [];
    const port = await fakeServer((request) => {
      seen.push(request.method);
      return { id: request.id, jsonrpc: '2.0', result: true };
    }, '\r\n');
    await requestFulcrumStop(port);
    expect(seen).toEqual(['stop']);
  });
});

describe('Electrum probe', () => {
  it('negotiates the protocol first, then reads the features and the tip', async () => {
    const seen: { method: string; params: unknown[] }[] = [];
    const port = await fakeServer((request) => {
      seen.push({ method: request.method, params: request.params });
      const results: Record<string, unknown> = {
        'server.version': ['Fulcrum 2.1.4', '1.6'],
        'server.features': { genesis_hash: 'genesis', protocol_max: '1.6' },
        'blockchain.headers.subscribe': { height: 110, hex: '00' },
      };
      return { id: request.id, jsonrpc: '2.0', result: results[request.method] };
    });
    expect(await probeElectrumServer({ port })).toEqual({
      serverVersion: 'Fulcrum 2.1.4',
      protocolVersion: '1.6',
      genesisHash: 'genesis',
      height: 110,
    });
    expect(seen.map((request) => request.method)).toEqual([
      'server.version',
      'server.features',
      'blockchain.headers.subscribe',
    ]);
    expect(seen[0]?.params).toEqual(['BTCortex', ['1.4', '1.6']]);
  });
});
