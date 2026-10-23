import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitcoinRpcClient, cookieCredentials } from '@btcortex/bitcoin-rpc';
import { I2P_SAM_ADDRESS } from '@btcortex/contracts';
import type { I2pRouterStatus, Job, NodeProfile } from '@btcortex/contracts';
import { configFilePath } from '@btcortex/integration-bitcoin-core';
import { JobManager } from '../../apps/orchestrator/src/jobs/job-manager';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { NodeConfigService } from '../../apps/orchestrator/src/nodes/config-service';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { PrivacyService } from '../../apps/orchestrator/src/nodes/privacy-service';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { SettingsStore } from '../../apps/orchestrator/src/persistence/settings';
import { ensureAppDirectories, resolveAppPaths } from '../../apps/orchestrator/src/platform/paths';
import { SetupService } from '../../apps/orchestrator/src/setup/setup-service';
import { TorService } from '../../apps/orchestrator/src/tor/tor-service';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import {
  findTestBitcoind,
  freePort,
  removeTestRoot,
  shutDownNodeManager,
  TEST_ENV_RUNTIMES,
} from './support/regtest-node';

// A node BTCortex manages, routed through BTCortex's tor and given an onion
// service, end to end: a real regtest bitcoind and the real tor from
// .test-env. tor runs offline (DisableNetwork), so nothing reaches the Tor
// network, yet Bitcoin Core still authenticates to tor's control port with
// the cookie and creates its onion service, whose address it then reports.
// For I2P, a stand-in SAM bridge on 127.0.0.1:7656 records Bitcoin Core's
// greeting and refuses the session, so nothing reaches the I2P network.

const bitcoind = findTestBitcoind();
const version = bitcoind?.match(/runtimes[\\/]([^\\/]+)[\\/]/)?.[1];
const TOR_RUNTIMES = resolve(import.meta.dirname, '..', '..', '.test-env', 'tor', 'runtimes');
const torInstalled = existsSync(TOR_RUNTIMES) && readdirSync(TOR_RUNTIMES).length > 0;

/** A SAM bridge that greets back, refuses every session and keeps the lines it receives. */
function standInBridge(): Promise<{ server: Server; lines: string[] } | undefined> {
  const lines: string[] = [];
  const server = createServer((socket) => {
    let buffer = '';
    socket.setEncoding('latin1');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (let newline = buffer.indexOf('\n'); newline !== -1; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        lines.push(line);
        socket.write(
          line.startsWith('HELLO')
            ? 'HELLO REPLY RESULT=OK VERSION=3.1\n'
            : 'SESSION STATUS RESULT=I2P_ERROR MESSAGE="BTCortex test bridge"\n',
        );
      }
    });
    socket.on('error', () => undefined);
  });
  const [host = '', port = ''] = I2P_SAM_ADDRESS.split(':');
  return new Promise((resolveBridge) => {
    // A real I2P router on this computer keeps its port; the greeting is then not checked.
    server.once('error', () => {
      resolveBridge(undefined);
    });
    server.listen(Number(port), host, () => {
      resolveBridge({ server, lines });
    });
  });
}

async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Condition not met in time; last value: ${JSON.stringify(value)}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
}

describe.skipIf(!bitcoind || !version || !torInstalled)('A managed node through Tor (real bitcoind and tor)', () => {
  let root: string;
  let database: DatabaseSync;
  let nodes: NodeManager;
  let tor: TorService;
  let privacy: PrivacyService;
  let profile: NodeProfile;
  let client: BitcoinRpcClient;
  let bridge: Awaited<ReturnType<typeof standInBridge>>;
  let router: I2pRouterStatus = {
    available: false,
    samAddress: I2P_SAM_ADDRESS,
    samVersion: null,
    program: null,
    runningWithoutSam: null,
    checkedAt: new Date().toISOString(),
    error: null,
  };

  const restarted = async () => {
    await until(
      () => nodes.get(profile.id).status.state,
      (state) => state !== 'running',
      30_000,
    );
    await until(
      () => nodes.get(profile.id).status.state,
      (state) => state === 'running' || state === 'failed',
      120_000,
    );
    expect(nodes.get(profile.id).status.error).toBeUndefined();
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-privacy-'));
    const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: root });
    ensureAppDirectories(paths);
    const logger = new StructuredLogger([new MemorySink(5000)], 'debug');
    database = openDatabase({ file: paths.database, migrations, logger });
    const vault = new SecretVault(
      database,
      createShellCaller(() => Promise.reject(new Error('The vault is not needed for cookie authentication.'))),
    );
    const repository = new NodeRepository(database);
    nodes = new NodeManager({
      repository,
      vault,
      runtimesDirectory: TEST_ENV_RUNTIMES,
      publish: () => undefined,
      logger,
      beforeStart: (node, text) => privacy.prepareStart(node, text),
    });
    const jobs = new JobManager({ database, publish: () => undefined, logger });
    const settings = new SettingsStore(database);
    settings.set('tor', {
      autoStart: false,
      ports: { socks: await freePort(), applicationSocks: await freePort(), control: await freePort() },
    });
    tor = new TorService({
      runtimesDirectory: TOR_RUNTIMES,
      home: join(root, 'tor'),
      logsDirectory: paths.logs,
      downloadsDirectory: paths.downloads,
      settings,
      jobs,
      publish: () => undefined,
      logger,
      users: () => privacy.nodesUsingTor(),
      detectExternal: () => Promise.resolve([]),
      offline: true,
    });
    const config = new NodeConfigService({ nodes, logger });
    privacy = new PrivacyService({ nodes, config, tor, i2p: { status: () => Promise.resolve(router) }, logger });
    bridge = await standInBridge();

    const fetchLatest: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: `v${version ?? ''}`, prerelease: false, draft: false })));
    const setup = new SetupService({
      paths,
      repository,
      nodes,
      jobs,
      logger,
      runtimesDirectory: TEST_ENV_RUNTIMES,
      fetch: fetchLatest,
    });
    const jobId = setup.start('Regtest node behind Tor', 'regtest', 'general');
    const job = await until<Job>(
      () => jobs.get(jobId),
      (candidate) => candidate.state === 'succeeded' || candidate.state === 'failed',
    );
    expect(job.error).toBeUndefined();
    profile = nodes.get(job.result?.nodeId ?? '').profile;
    await until(
      () => nodes.get(profile.id).status.state,
      (state) => state === 'running',
    );
    client = new BitcoinRpcClient({
      endpoint: profile.rpcEndpoint,
      credentials: cookieCredentials(join(profile.dataDirectory ?? '', 'regtest', '.cookie')),
    });
  }, 240_000);

  afterAll(async () => {
    await shutDownNodeManager(nodes);
    await tor.stop().catch(() => undefined);
    // Clears its timers, so nothing reaches the database after it is closed.
    await tor.shutdown();
    await new Promise<void>((resolveClose) => {
      if (!bridge) {
        resolveClose();
        return;
      }
      bridge.server.close(() => {
        resolveClose();
      });
    });
    database.close();
    removeTestRoot(root);
  }, 60_000);

  it('starts as BTCortex sets nodes up: direct connections, no onion service', async () => {
    expect(await privacy.overview(profile.id)).toMatchObject({
      mode: 'off',
      onionService: false,
      onionAddress: null,
      manageable: true,
      privateBroadcastSupported: true,
      restartRequired: false,
    });
    expect((await privacy.nodesUsingTor()).map((user) => user.id)).toEqual([]);
  });

  it('routes the node only through Tor with an onion service: tor starts first and Bitcoin Core publishes its onion address', async () => {
    const result = await privacy.configure(profile.id, {
      mode: 'tor-only',
      onionService: true,
      privateBroadcast: true,
    });
    expect(result.restarting).toBe(true);
    expect(result.changedKeys).toEqual(expect.arrayContaining(['proxy', 'onlynet', 'listen', 'bind', 'torcontrol']));
    await restarted();
    expect(tor.isRunning()).toBe(true);

    const info = await until(
      () => client.getNetworkInfo(),
      (network) => network.localaddresses.some((local) => local.address.endsWith('.onion')),
      90_000,
    );
    const ports = tor.ports();
    expect(info.networks.find((network) => network.name === 'onion')).toMatchObject({
      reachable: true,
      proxy: `127.0.0.1:${String(ports.socks)}`,
    });
    // onlynet=onion: the clearnet is not used at all.
    expect(info.networks.find((network) => network.name === 'ipv4')?.reachable).toBe(false);

    const overview = await privacy.overview(profile.id);
    expect(overview).toMatchObject({ mode: 'tor-only', onionService: true, privateBroadcast: true });
    expect(overview.onionAddress).toMatch(/^[a-z2-7]{56}\.onion$/);
    expect(overview.restartRequired).toBe(false);
    expect((await privacy.nodesUsingTor()).map((user) => user.id)).toEqual([profile.id]);

    const text = readFileSync(configFilePath(profile.dataDirectory ?? ''), 'utf8');
    expect(text.slice(text.indexOf('[regtest]'))).toMatch(/bind=127\.0\.0\.1:\d+=onion/);
    expect(text).not.toMatch(/0\.0\.0\.0/);
  }, 240_000);

  it('goes back to direct connections and the onion address disappears', async () => {
    await privacy.configure(profile.id, { mode: 'off', onionService: false, privateBroadcast: false });
    await restarted();
    const info = await client.getNetworkInfo();
    expect(info.localaddresses.some((local) => local.address.endsWith('.onion'))).toBe(false);
    expect(await privacy.overview(profile.id)).toMatchObject({ mode: 'off', onionService: false, onionAddress: null });
    expect(await privacy.nodesUsingTor()).toEqual([]);
  }, 240_000);

  it('adds I2P peers only once an I2P router answers, alongside onion peers only', async () => {
    const change = { mode: 'tor-only', onionService: false, privateBroadcast: false, i2p: true } as const;
    await expect(privacy.configure(profile.id, change)).rejects.toMatchObject({
      error: { code: 'privacy.i2p-router-missing' },
    });
    router = { ...router, available: true, samVersion: '3.1', program: 'i2pd' };
    await privacy.configure(profile.id, change);
    await restarted();
    const info = await client.getNetworkInfo();
    expect(info.networks.find((network) => network.name === 'i2p')).toMatchObject({
      reachable: true,
      proxy: I2P_SAM_ADDRESS,
    });
    expect(info.networks.find((network) => network.name === 'onion')?.reachable).toBe(true);
    expect(info.networks.find((network) => network.name === 'ipv4')?.reachable).toBe(false);
    expect(await privacy.overview(profile.id)).toMatchObject({ mode: 'tor-only', i2p: true, restartRequired: false });
    expect(readFileSync(configFilePath(profile.dataDirectory ?? ''), 'utf8')).toContain('i2pacceptincoming=0');
  }, 240_000);

  it('reaches an I2P peer through the SAM bridge it was pointed at', async (context) => {
    if (!bridge) {
      context.skip();
      return;
    }
    // I2P peers have no port (SAM 3.1); the stand-in bridge refuses the session.
    await client.call('addnode', [`${'a'.repeat(52)}.b32.i2p:0`, 'onetry']);
    const lines = await until(
      () => [...(bridge?.lines ?? [])],
      (received) => received.length >= 2,
      30_000,
    );
    expect(lines[0]).toBe('HELLO VERSION MIN=3.1 MAX=3.1');
    // A new address for this connection alone: the node accepts no incoming I2P connections.
    expect(lines[1]).toMatch(/^SESSION CREATE STYLE=STREAM .*DESTINATION=TRANSIENT/);
  }, 120_000);

  it('removes I2P again', async () => {
    await privacy.configure(profile.id, { mode: 'off', onionService: false, privateBroadcast: false, i2p: false });
    await restarted();
    const info = await client.getNetworkInfo();
    expect(info.networks.find((network) => network.name === 'i2p')?.reachable).toBe(false);
    expect(await privacy.overview(profile.id)).toMatchObject({ mode: 'off', i2p: false });
    expect(readFileSync(configFilePath(profile.dataDirectory ?? ''), 'utf8')).not.toMatch(/i2psam=|i2pacceptincoming=/);
  }, 240_000);
});
