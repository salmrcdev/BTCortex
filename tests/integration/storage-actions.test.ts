import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitcoinRpcClient, cookieCredentials } from '@btcortex/bitcoin-rpc';
import type { Job, NodeProfile, NodeStatus } from '@btcortex/contracts';
import { configFilePath } from '@btcortex/integration-bitcoin-core';
import { JobManager } from '../../apps/orchestrator/src/jobs/job-manager';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { NodeConfigService } from '../../apps/orchestrator/src/nodes/config-service';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { StorageService } from '../../apps/orchestrator/src/nodes/storage-service';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { ensureAppDirectories, resolveAppPaths } from '../../apps/orchestrator/src/platform/paths';
import { SetupService } from '../../apps/orchestrator/src/setup/setup-service';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import { findTestBitcoind, removeTestRoot, shutDownNodeManager, TEST_ENV_RUNTIMES } from './support/regtest-node';

// Storage changes and maintenance on a node BTCortex manages, against a real
// regtest bitcoind (specification section 5.10): indexes switched on and
// built, the chain verified, the chainstate rebuilt, pruning switched on and
// then left again with a full reindex.

const bitcoind = findTestBitcoind();
const version = bitcoind?.match(/runtimes[\\/]([^\\/]+)[\\/]/)?.[1];
const BLOCKS = 120;

async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Condition not met in time; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe.skipIf(!bitcoind || !version)('Storage changes on a managed node (real bitcoind on regtest)', () => {
  const sink = new MemorySink(5000);
  let root: string;
  let database: DatabaseSync;
  let nodes: NodeManager;
  let storage: StorageService;
  let profile: NodeProfile;
  let client: BitcoinRpcClient;

  /** Waits for the restart to finish: the node first leaves `running`, then comes back with the whole chain. */
  const restarted = async (): Promise<NodeStatus> => {
    await until(
      () => nodes.get(profile.id).status.state,
      (state) => state !== 'running',
      30_000,
    );
    return until(
      () => nodes.get(profile.id).status,
      (status) => status.state === 'running' && status.snapshot?.blockchain.blocks === BLOCKS,
      180_000,
    );
  };

  const startArguments = () =>
    sink.entries
      .filter((entry) => entry.message === 'Started bitcoind')
      .map((entry) => (entry.context as { arguments: string[] }).arguments);

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-storage-actions-'));
    const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: root });
    ensureAppDirectories(paths);
    const logger = new StructuredLogger([sink], 'debug');
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
    });
    const jobs = new JobManager({ database, publish: () => undefined, logger });
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
    const config = new NodeConfigService({ nodes, logger });
    storage = new StorageService({
      nodes,
      config,
      logger,
      appDataDirectory: root,
      env: { APPDATA: join(root, 'none') },
    });

    const jobId = setup.start('Regtest storage node', 'regtest', 'general');
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
      credentials: cookieCredentials(profile.authentication.kind === 'cookie' ? profile.authentication.cookieFile : ''),
    });
    const { descriptor } = await client.call<{ descriptor: string }>('getdescriptorinfo', ['raw(51)']);
    await client.call('generatetodescriptor', [BLOCKS, descriptor]);
    await until(
      () => nodes.get(profile.id).status.snapshot?.blockchain.blocks,
      (blocks) => blocks === BLOCKS,
    );
  }, 180_000);

  afterAll(async () => {
    await shutDownNodeManager(nodes);
    database.close();
    removeTestRoot(root);
  });

  it('switches indexes on, restarts the node and builds them', async () => {
    const result = await storage.configure(
      profile.id,
      { indexes: { blockfilterindex: true, coinstatsindex: true } },
      true,
    );
    expect(result).toMatchObject({ restarting: true, reindexing: false });
    expect(result.changedKeys.sort()).toEqual(['blockfilterindex', 'coinstatsindex']);
    await restarted();
    const indexes = await until(
      () => client.getIndexInfo(),
      (info) => Object.values(info).length === 2 && Object.values(info).every((index) => index.synced),
    );
    expect(Object.keys(indexes).sort()).toEqual(['basic block filter index', 'coinstatsindex']);
    const overview = await storage.overview(profile.id);
    expect(overview.configured?.indexes).toMatchObject({ blockfilterindex: true, coinstatsindex: true });
    expect(overview.indexes.filter((index) => index.enabled).map((index) => index.id)).toEqual([
      'blockfilterindex',
      'coinstatsindex',
    ]);
  }, 240_000);

  it('verifies the latest blocks with Bitcoin Core', async () => {
    expect(await storage.verify(profile.id)).toMatchObject({ valid: true, checkLevel: 3, blocks: 6 });
  });

  it('rebuilds the chainstate with a one-shot flag that never reaches bitcoin.conf', async () => {
    await storage.reindex(profile.id, 'chainstate');
    await restarted();
    expect(startArguments().at(-1)).toContain('-reindex-chainstate');
    expect(readFileSync(configFilePath(profile.dataDirectory ?? ''), 'utf8')).not.toContain('reindex');
  }, 240_000);

  it('refuses the transaction index together with pruning', async () => {
    await expect(
      storage.configure(
        profile.id,
        { indexes: { txindex: true }, pruning: { mode: 'automatic', targetMiB: 550 } },
        true,
      ),
    ).rejects.toMatchObject({ error: { code: 'storage.incompatible' } });
  });

  it('prunes, then becomes a full node again through a full reindex', async () => {
    const pruned = await storage.configure(profile.id, { pruning: { mode: 'automatic', targetMiB: 550 } }, true);
    expect(pruned).toMatchObject({ restarting: true, reindexing: false });
    await restarted();
    expect((await storage.overview(profile.id)).pruning).toMatchObject({ enabled: true, automatic: true });
    await expect(storage.reindex(profile.id, 'chainstate')).rejects.toMatchObject({
      error: { code: 'storage.reindex-not-possible' },
    });

    const full = await storage.configure(profile.id, { pruning: { mode: 'off' } }, true);
    expect(full).toMatchObject({ restarting: true, reindexing: true });
    await restarted();
    expect(startArguments().at(-1)).toContain('-reindex');
    expect((await storage.overview(profile.id)).pruning.enabled).toBe(false);
  }, 360_000);
});
