import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitcoinRpcClient, cookieCredentials } from '@btcortex/bitcoin-rpc';
import type { ElectrumServerStatus, Job, NodeProfile } from '@btcortex/contracts';
import { configFilePath } from '@btcortex/integration-bitcoin-core';
import { isProcessAlive, probeElectrumServer, readScripthash } from '@btcortex/integration-fulcrum';
import { ElectrumService } from '../../apps/orchestrator/src/electrum/electrum-service';
import { RemoteElectrumService } from '../../apps/orchestrator/src/electrum/remote-electrum-service';
import { JobManager } from '../../apps/orchestrator/src/jobs/job-manager';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { LogService } from '../../apps/orchestrator/src/logs/log-service';
import { NodeConfigService } from '../../apps/orchestrator/src/nodes/config-service';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { SettingsStore } from '../../apps/orchestrator/src/persistence/settings';
import { ensureAppDirectories, resolveAppPaths } from '../../apps/orchestrator/src/platform/paths';
import type { AppPaths } from '../../apps/orchestrator/src/platform/paths';
import { SetupService } from '../../apps/orchestrator/src/setup/setup-service';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import { connectAuthenticated, torLayout } from '@btcortex/integration-tor';
import { shortFolderPath } from '../../apps/orchestrator/src/platform/short-path';
import { TorService } from '../../apps/orchestrator/src/tor/tor-service';
import {
  findTestBitcoind,
  freePort,
  removeTestRoot,
  shutDownNodeManager,
  TEST_ENV_RUNTIMES,
} from './support/regtest-node';

// An Electrum server for a node BTCortex manages, end to end: a real regtest
// bitcoind and the real Fulcrum from .test-env (installed and verified by
// scripts/dev/install-fulcrum.ts). BTCortex's data lives under a folder with
// accented letters, as under a Windows user name like "José": the node's
// files, its cookie and Fulcrum's index all sit there, which Fulcrum's
// database cannot open directly. The set-up turns on the node's transaction
// index and block notifications and restarts it; Fulcrum then starts by
// itself, indexes the chain and answers Electrum clients, stops before its
// node, survives BTCortex closing while the node keeps running, and comes
// back after it is ended unexpectedly.

const bitcoind = findTestBitcoind();
const version = bitcoind?.match(/runtimes[\\/]([^\\/]+)[\\/]/)?.[1];
const FULCRUM_RUNTIMES = resolve(import.meta.dirname, '..', '..', '.test-env', 'fulcrum', 'runtimes');
const fulcrumInstalled = existsSync(FULCRUM_RUNTIMES) && readdirSync(FULCRUM_RUNTIMES).length > 0;
const TOR_RUNTIMES = resolve(import.meta.dirname, '..', '..', '.test-env', 'tor', 'runtimes');
const torInstalled = existsSync(TOR_RUNTIMES) && readdirSync(TOR_RUNTIMES).length > 0;

/** The DPAPI vault needs the native shell; these tests keep secrets in memory instead. */
function memoryVault() {
  const secrets = new Map<string, string>();
  return {
    secrets,
    store: (_purpose: string, plaintext: string) => {
      const id = `secret-${String(secrets.size + 1)}`;
      secrets.set(id, plaintext);
      return Promise.resolve(id);
    },
    reveal: (id: string) => {
      const value = secrets.get(id);
      return value === undefined ? Promise.reject(new Error('unknown secret')) : Promise.resolve(value);
    },
    remove: (id: string) => secrets.delete(id),
  };
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

describe.skipIf(!bitcoind || !version || !fulcrumInstalled)(
  'An Electrum server for a managed node (real bitcoind and Fulcrum)',
  () => {
    let root: string;
    let paths: AppPaths;
    let database: DatabaseSync;
    let logger: StructuredLogger;
    let nodes: NodeManager;
    let jobs: JobManager;
    let config: NodeConfigService;
    let vault: SecretVault;
    let electrumVault: ReturnType<typeof memoryVault>;
    let tor: TorService;
    let torControlPort: number;
    let electrum: ElectrumService;
    let profile: NodeProfile;
    let client: BitcoinRpcClient;
    let address: string;

    const createService = () =>
      new ElectrumService({
        runtimesDirectory: FULCRUM_RUNTIMES,
        home: join(paths.root, 'electrum'),
        logsDirectory: paths.logs,
        downloadsDirectory: paths.downloads,
        settings: new SettingsStore(database),
        nodes,
        config,
        vault: electrumVault,
        jobs,
        publish: () => undefined,
        logger,
        totalMemoryBytes: 6 * 1024 ** 3,
        latestVersion: () => Promise.reject(new Error('Fulcrum is installed already; nothing is downloaded.')),
        pollMs: { active: 500, idle: 1_000 },
        tor,
      });

    const status = (): ElectrumServerStatus => electrum.status(profile.id);
    const ready = () =>
      until(
        () => status(),
        (current) => current.state === 'ready' || current.state === 'failed',
        180_000,
      );

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), 'btcortex-électrum-José-'));
      paths = resolveAppPaths({ BTCORTEX_DATA_DIR: root });
      ensureAppDirectories(paths);
      logger = new StructuredLogger([new MemorySink(5000)], 'debug');
      database = openDatabase({ file: paths.database, migrations, logger });
      vault = new SecretVault(
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
        beforeStop: (node, restart) => electrum.beforeNodeStop(node, restart),
      });
      jobs = new JobManager({ database, publish: () => undefined, logger });
      config = new NodeConfigService({ nodes, logger });
      electrumVault = memoryVault();
      // BTCortex's tor, offline: it publishes onion services without reaching the Tor network.
      const torSettings = new SettingsStore(database);
      torControlPort = await freePort();
      torSettings.set('tor', {
        autoStart: false,
        ports: { socks: await freePort(), applicationSocks: await freePort(), control: torControlPort },
      });
      tor = new TorService({
        runtimesDirectory: TOR_RUNTIMES,
        home: join(paths.root, 'tor'),
        logsDirectory: paths.logs,
        downloadsDirectory: paths.downloads,
        settings: torSettings,
        jobs,
        publish: () => undefined,
        logger,
        users: () => Promise.resolve(electrum.torUsers()),
        detectExternal: () => Promise.resolve([]),
        offline: true,
      });
      electrum = createService();

      const fetchLatest: typeof fetch = () =>
        Promise.resolve(
          new Response(JSON.stringify({ tag_name: `v${version ?? ''}`, prerelease: false, draft: false })),
        );
      const setup = new SetupService({
        paths,
        repository,
        nodes,
        jobs,
        logger,
        runtimesDirectory: TEST_ENV_RUNTIMES,
        fetch: fetchLatest,
      });
      // A node set up for general use: its Electrum server needs the transaction index and a restart.
      const jobId = setup.start('Regtest node', 'regtest', 'general');
      const job = await until<Job>(
        () => jobs.get(jobId),
        (candidate) => candidate.state === 'succeeded' || candidate.state === 'failed',
      );
      expect(job.error).toBeUndefined();
      profile = nodes.get(job.result?.nodeId ?? '').profile;
      await until(
        () => nodes.get(profile.id).status,
        (current) => current.state === 'running' && current.snapshot !== undefined,
      );
      client = new BitcoinRpcClient({
        endpoint: profile.rpcEndpoint,
        credentials: cookieCredentials(join(profile.dataDirectory ?? '', 'regtest', '.cookie')),
      });
      await client.call('createwallet', ['miner']);
      address = await client.call<string>('getnewaddress', [], { wallet: 'miner' });
      await client.call('generatetoaddress', [150, address]);
      // Some transactions, so the index holds more than coinbases.
      for (let index = 0; index < 20; index += 1) {
        await client.call('sendtoaddress', { address, amount: 0.5, fee_rate: 2 }, { wallet: 'miner' });
      }
      await client.call('generatetoaddress', [1, address]);
      electrum.initialise();
    }, 300_000);

    afterAll(async () => {
      // Fulcrum has exited when this returns; then the node is stopped.
      await electrum.shutdown();
      await shutDownNodeManager(nodes);
      await tor.stop().catch(() => undefined);
      // Clears its timers, so nothing reaches the database after it is closed.
      await tor.shutdown();
      database.close();
      removeTestRoot(root);
    }, 60_000);

    it('plans the server: the node keeps every block, its transaction index and block notifications are added, and the node restarts once', async () => {
      expect(status()).toMatchObject({ state: 'not-set-up', enabled: false, connection: null });
      expect(status().unavailableReason).toBeUndefined();
      const plan = await electrum.plan(profile.id);
      expect(plan.blockers).toEqual([]);
      expect(plan.installsFulcrum).toBe(false);
      expect(plan.restartsNode).toBe(true);
      expect(plan.nodeChanges.map((change) => change.key)).toEqual(['txindex', 'zmqpubhashblock']);
      expect(plan.nodeChanges[1]?.value).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/);
      expect(plan.dataDirectory).toBe(`${profile.dataDirectory ?? ''}-electrum`);
      // The folder name has letters Fulcrum's database cannot open, so its short name is used.
      expect(plan.warnings.map((warning) => warning.code)).toContain('short-path');
      expect(plan.volume?.freeBytes).toBeGreaterThan(0);
    });

    it('refuses a folder that already holds other files', async () => {
      // BTCortex's own folder holds its database.
      const plan = await electrum.plan(profile.id, paths.root);
      expect(plan.blockers.map((blocker) => blocker.code)).toContain('folder-not-empty');
      const inside = await electrum.plan(profile.id, join(profile.dataDirectory ?? '', 'index'));
      expect(inside.blockers.map((blocker) => blocker.code)).toContain('folder-inside-node');
    });

    it('sets the server up: the node restarts with its transaction index, Fulcrum indexes the chain and answers Electrum clients', async () => {
      const plan = await electrum.plan(profile.id);
      const jobId = electrum.setUp(profile.id, plan.dataDirectory);
      const job = await until<Job>(
        () => jobs.get(jobId),
        (candidate) => candidate.state === 'succeeded' || candidate.state === 'failed',
        180_000,
      );
      expect(job.error).toBeUndefined();

      // Both settings apply on every network, so they sit in the file's common part.
      const text = readFileSync(configFilePath(profile.dataDirectory ?? ''), 'utf8');
      expect(text).toMatch(/^txindex=1$/m);
      expect(text).toMatch(/^zmqpubhashblock=tcp:\/\/127\.0\.0\.1:\d+$/m);

      const current = await ready();
      expect(current.error).toBeUndefined();
      const blocks = (await client.getBlockchainInfo()).blocks;
      expect(current).toMatchObject({ state: 'ready', enabled: true, runningVersion: '2.1.4' });
      expect(current.server).toMatchObject({ version: 'Fulcrum 2.1.4', height: blocks });
      expect(current.connection?.server).toBe(`127.0.0.1:${String(current.ports?.electrum)}:t`);
      expect(current.connection?.url).toBe(`tcp://127.0.0.1:${String(current.ports?.electrum)}`);

      // What a wallet sees: the node's chain, at the node's height.
      const probe = await probeElectrumServer({ port: current.ports?.electrum ?? 0 });
      expect(probe.serverVersion).toBe('Fulcrum 2.1.4');
      expect(probe.height).toBe(blocks);
      expect(probe.genesisHash).toBe(await client.call<string>('getblockhash', [0]));

      // Fulcrum's configuration: loopback only, private, no password, a path its database can open.
      const fulcrumConfig = readFileSync(join(paths.root, 'electrum', profile.id, 'fulcrum.conf'), 'utf8');
      expect(fulcrumConfig).toContain(`tcp = 127.0.0.1:${String(current.ports?.electrum)}`);
      expect(fulcrumConfig).toContain('peering = false');
      expect(fulcrumConfig).not.toMatch(/0\.0\.0\.0|rpcpassword|é/);
    }, 300_000);

    it('follows new blocks', async () => {
      await client.call('generatetoaddress', [3, address]);
      const blocks = (await client.getBlockchainInfo()).blocks;
      await until(
        () => status().server?.height,
        (height) => height === blocks,
        60_000,
      );
    }, 90_000);

    it('is read like an Electrum server on another computer, and answers its node’s address lookups that way', async () => {
      const port = status().ports?.electrum ?? 0;
      const remote = new RemoteElectrumService({
        settings: new SettingsStore(database),
        nodes,
        socksPort: () => undefined,
        logger,
      });
      // The regtest genesis block tells the chain, without asking the node.
      expect(await remote.test({ host: '127.0.0.1', port, tls: false, via: 'direct' })).toMatchObject({
        reachable: true,
        serverVersion: 'Fulcrum 2.1.4',
        network: 'regtest',
        certificate: null,
      });
      await remote.add({
        name: 'Fulcrum elsewhere',
        host: '127.0.0.1',
        port,
        tls: false,
        via: 'direct',
        certificateFingerprint: null,
        nodeId: profile.id,
      });
      const lookup = remote.lookupFor(profile.id);
      if (!lookup) throw new Error('The server was not offered for the node’s lookups.');
      const { scriptPubKey } = await client.call<{ scriptPubKey: string }>('validateaddress', [address]);
      const scripthash = createHash('sha256')
        .update(Buffer.from(scriptPubKey, 'hex'))
        .digest()
        .reverse()
        .toString('hex');
      const summary = await readScripthash({ port: 0, scripthash, socket: lookup.open });
      expect(summary.history.length).toBeGreaterThan(0);
      remote.remove(remote.list()[0]?.server.id ?? '');
    }, 90_000);

    it.skipIf(!torInstalled)(
      'is reachable from other devices through Tor, at an address that stays, published again when tor restarts',
      async () => {
        const detached = async () => {
          const control = await connectAuthenticated(torControlPort, torLayout(torHome).cookie);
          try {
            return await control.detachedOnions();
          } finally {
            control.close();
          }
        };
        const on = await electrum.setRemoteAccess(profile.id, true);
        // BTCortex's folder has accented letters, so tor, now running, was given its short 8.3 name.
        const torHome = (await shortFolderPath(join(paths.root, 'tor'))) ?? join(paths.root, 'tor');
        const onion = on.remoteAccess.onion;
        expect(on.remoteAccess).toMatchObject({ enabled: true });
        expect(on.remoteAccess.problem).toBeUndefined();
        expect(onion?.host).toMatch(/^[a-z2-7]{56}\.onion$/);
        // Wallets elsewhere use the usual regtest port; tor forwards it to this computer's.
        expect(onion?.server).toBe(`${onion?.host ?? ''}:60401:t`);
        expect(onion?.qr.size).toBeGreaterThan(20);
        const serviceId = (onion?.host ?? '').replace('.onion', '');
        expect(await detached()).toContain(serviceId);
        // The key is kept in the vault, never in the settings.
        expect([...electrumVault.secrets.values()][0]).toMatch(/^ED25519-V3:/);
        expect((await tor.status()).usedBy).toContainEqual(
          expect.objectContaining({ id: profile.id, kind: 'electrum' }),
        );

        const off = await electrum.setRemoteAccess(profile.id, false);
        // Off, but the address is kept for when access is turned on again (and lost only with the server).
        expect(off.remoteAccess).toEqual({ enabled: false, onion: null, addressKept: true });
        expect(await detached()).not.toContain(serviceId);

        // Turned on again, the address is the same, so wallets set up for it keep working.
        expect((await electrum.setRemoteAccess(profile.id, true)).remoteAccess.onion?.host).toBe(onion?.host);
        await tor.stop();
        await tor.start();
        await until(detached, (services) => services.includes(serviceId), 30_000);
      },
      120_000,
    );

    it('shows its lines in the log centre', async () => {
      const logs = new LogService({ paths, nodes, electrumLogs: () => electrum.logSources() });
      const source = logs.sources().find((candidate) => candidate.kind === 'fulcrum');
      expect(source).toMatchObject({ nodeId: profile.id, exists: true });
      const page = await logs.read({ sourceIds: [source?.id ?? ''], minimumSeverity: 'info', limit: 200 });
      expect(page.entries.some((entry) => entry.message.includes('up-to-date'))).toBe(true);
      expect(status().recentLines.length).toBeGreaterThan(0);
    });

    it('stops before its node and starts again with it', async () => {
      const pid = status().pid ?? 0;
      expect(isProcessAlive(pid)).toBe(true);
      await nodes.stop(profile.id);
      // Fulcrum stopped gracefully before Bitcoin Core was asked to stop.
      expect(isProcessAlive(pid)).toBe(false);
      await until(
        () => nodes.get(profile.id).status.state,
        (state) => state === 'stopped',
        120_000,
      );
      await until(
        () => status(),
        (current) => current.state === 'waiting' && current.waitingFor === 'node-stopped',
        30_000,
      );
      expect(status().enabled).toBe(true);
      await nodes.start(profile.id);
      expect((await ready()).error).toBeUndefined();
      expect(status().pid).not.toBe(pid);
    }, 300_000);

    it('keeps running when BTCortex closes while the node keeps running, and is found again', async () => {
      const pid = status().pid ?? 0;
      nodes.updateProfile({ ...profile, keepRunningOnExit: true });
      await electrum.shutdown();
      expect(isProcessAlive(pid)).toBe(true);
      // The next session.
      electrum = createService();
      electrum.initialise();
      const current = await ready();
      expect(current.pid).toBe(pid);
      expect(current.error).toBeUndefined();
      nodes.updateProfile(profile);
    }, 120_000);

    it('comes back by itself after it is ended unexpectedly', async () => {
      const pid = status().pid ?? 0;
      process.kill(pid);
      await until(
        () => status(),
        (current) => current.state === 'failed',
        30_000,
      );
      expect(status().error?.code).toBe('electrum.exited');
      // Started again after a short pause.
      const current = await until(
        () => status(),
        (candidate) => candidate.state === 'ready',
        120_000,
      );
      expect(current.error).toBeUndefined();
      expect(current.pid).not.toBe(pid);
    }, 180_000);

    it('stops when asked and stays stopped', async () => {
      const pid = status().pid ?? 0;
      expect((await electrum.stop(profile.id)).state).toBe('stopped');
      expect(isProcessAlive(pid)).toBe(false);
      await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
      expect(status()).toMatchObject({ state: 'stopped', enabled: false, pid: null });
    }, 60_000);

    it('is removed with its index when asked', async () => {
      const directory = status().dataDirectory ?? '';
      expect(existsSync(directory)).toBe(true);
      const removal = await electrum.remove(profile.id, true);
      expect(removal.deletedBytes).toBeGreaterThan(0);
      expect(removal.keptDirectory).toBeNull();
      expect(existsSync(directory)).toBe(false);
      expect(status()).toMatchObject({ state: 'not-set-up', connection: null });
    }, 60_000);
  },
);

describe.skipIf(!bitcoind || !version || !fulcrumInstalled)(
  'A node set up as an Electrum back end (real bitcoind and Fulcrum)',
  () => {
    let root: string;
    let database: DatabaseSync;
    let nodes: NodeManager;
    let electrum: ElectrumService;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), 'btcortex-electrum-backend-'));
    });

    afterAll(async () => {
      await electrum.shutdown();
      await shutDownNodeManager(nodes);
      database.close();
      removeTestRoot(root);
    }, 60_000);

    it('gets its Electrum server without any further step, and without a restart', async () => {
      const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: root });
      ensureAppDirectories(paths);
      const logger = new StructuredLogger([new MemorySink(5000)], 'debug');
      database = openDatabase({ file: paths.database, migrations, logger });
      const vault = new SecretVault(
        database,
        createShellCaller(() => Promise.reject(new Error('The vault is not needed for cookie authentication.'))),
      );
      const repository = new NodeRepository(database);
      const restarts: string[] = [];
      nodes = new NodeManager({
        repository,
        vault,
        runtimesDirectory: TEST_ENV_RUNTIMES,
        publish: () => undefined,
        logger,
        beforeStop: (node, restart) => {
          restarts.push(node.id);
          return electrum.beforeNodeStop(node, restart);
        },
      });
      const jobs = new JobManager({ database, publish: () => undefined, logger });
      const config = new NodeConfigService({ nodes, logger });
      electrum = new ElectrumService({
        runtimesDirectory: FULCRUM_RUNTIMES,
        home: join(paths.root, 'electrum'),
        logsDirectory: paths.logs,
        downloadsDirectory: paths.downloads,
        settings: new SettingsStore(database),
        nodes,
        config,
        vault,
        jobs,
        publish: () => undefined,
        logger,
        totalMemoryBytes: 6 * 1024 ** 3,
        latestVersion: () => Promise.reject(new Error('Fulcrum is installed already; nothing is downloaded.')),
        pollMs: { active: 500, idle: 1_000 },
      });
      electrum.initialise();
      const fetchLatest: typeof fetch = () =>
        Promise.resolve(
          new Response(JSON.stringify({ tag_name: `v${version ?? ''}`, prerelease: false, draft: false })),
        );
      const setup = new SetupService({
        paths,
        repository,
        nodes,
        jobs,
        logger,
        runtimesDirectory: TEST_ENV_RUNTIMES,
        fetch: fetchLatest,
        setUpElectrumServer: (nodeId) => {
          electrum.setUpForNewNode(nodeId);
        },
      });
      const jobId = setup.start('Electrum back end', 'regtest', 'electrum-backend');
      const job = await until<Job>(
        () => jobs.get(jobId),
        (candidate) => candidate.state === 'succeeded' || candidate.state === 'failed',
      );
      expect(job.error).toBeUndefined();
      const nodeId = job.result?.nodeId ?? '';
      const profile = nodes.get(nodeId).profile;
      // The transaction index was in the configuration from the first start.
      expect(readFileSync(configFilePath(profile.dataDirectory ?? ''), 'utf8')).toMatch(/^txindex=1$/m);
      // A new regtest chain counts as synchronising until its first block; meanwhile Fulcrum waits.
      await until(
        () => electrum.status(nodeId),
        (candidate) => candidate.state === 'waiting' && candidate.waitingFor === 'node-synchronising',
        60_000,
      );
      const client = new BitcoinRpcClient({
        endpoint: profile.rpcEndpoint,
        credentials: cookieCredentials(join(profile.dataDirectory ?? '', 'regtest', '.cookie')),
      });
      await client.call('createwallet', ['miner']);
      await client.call('generatetoaddress', [1, await client.call<string>('getnewaddress', [], { wallet: 'miner' })]);

      const current = await until(
        () => electrum.status(nodeId),
        (candidate) => candidate.state === 'ready' || candidate.state === 'failed',
        180_000,
      );
      expect(current.error).toBeUndefined();
      expect(current.state).toBe('ready');
      expect(current.dataDirectory).toBe(`${profile.dataDirectory ?? ''}-electrum`);
      expect(restarts).toEqual([]);
    }, 300_000);
  },
);
