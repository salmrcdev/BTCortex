import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NodeProfile } from '@btcortex/contracts';
import { cookieFilePath, defaultRpcEndpoint } from '@btcortex/integration-bitcoin-core';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { NodeConfigService } from '../../apps/orchestrator/src/nodes/config-service';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { StorageService } from '../../apps/orchestrator/src/nodes/storage-service';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import { findTestBitcoind, startRegtestNode, TEST_ENV_RUNTIMES } from './support/regtest-node';
import type { RegtestNode } from './support/regtest-node';

// Storage and indexing against real regtest bitcoind nodes (specification
// section 5.10): one with the transaction and block filter indexes, one pruned.

const bitcoind = findTestBitcoind();
/** Regtest's genesis block time. */
const REGTEST_GENESIS_TIME = 1_296_688_602;

describe.skipIf(!bitcoind)('Storage and indexing (real bitcoind on regtest)', () => {
  let root: string;
  let indexed: RegtestNode;
  let pruned: RegtestNode;
  let database: DatabaseSync;
  let nodes: NodeManager;
  let storage: StorageService;

  const profile = (id: string, node: RegtestNode): NodeProfile => {
    const timestamp = new Date().toISOString();
    return {
      id,
      name: id,
      implementation: 'bitcoin-core',
      network: 'regtest',
      execution: 'external',
      runtimeVersion: null,
      dataDirectory: null,
      rpcEndpoint: defaultRpcEndpoint('regtest', node.rpcPort),
      authentication: { kind: 'cookie', cookieFile: cookieFilePath(node.dataDirectory, 'regtest') },
      keepRunningOnExit: true,
      startWithBtcortex: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-storage-'));
    [indexed, pruned] = await Promise.all([
      startRegtestNode(bitcoind ?? '', { settings: { txindex: '1', blockfilterindex: '1' } }),
      startRegtestNode(bitcoind ?? '', { settings: { prune: '550' } }),
    ]);
    const logger = new StructuredLogger([new MemorySink()], 'debug');
    database = openDatabase({ file: join(root, 'btcortex.db'), migrations, logger });
    const vault = new SecretVault(
      database,
      createShellCaller(() => Promise.reject(new Error('No vault needed.'))),
    );
    nodes = new NodeManager({
      repository: new NodeRepository(database),
      vault,
      runtimesDirectory: TEST_ENV_RUNTIMES,
      publish: () => undefined,
      logger,
    });
    nodes.track(profile('indexed', indexed));
    nodes.track(profile('pruned', pruned));
    storage = new StorageService({
      nodes,
      config: new NodeConfigService({ nodes, logger }),
      logger,
      appDataDirectory: root,
      env: { APPDATA: join(root, 'no-sparrow') },
    });

    const address = await indexed.client.call<string>('getnewaddress', []).catch(async () => {
      await indexed.client.call('createwallet', ['storage-test']);
      return indexed.client.call<string>('getnewaddress', [], { wallet: 'storage-test' });
    });
    await indexed.client.call('generatetoaddress', [150, address]);
    // Wait for both indexes to catch up with the chain.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const info = await indexed.client.getIndexInfo();
      if (Object.values(info).every((index) => index.synced && index.best_block_height === 150)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  afterAll(async () => {
    await nodes.shutdown();
    database.close();
    await Promise.all([indexed.stop(), pruned.stop()]);
    rmSync(root, { recursive: true, force: true });
  });

  it('measures the folders, indexes and disk of a local node', async () => {
    const overview = await storage.overview('indexed');
    expect(overview.local).toBe(true);
    expect(overview.networkDirectory).toBe(join(indexed.dataDirectory, 'regtest'));
    const sizes = Object.fromEntries((overview.breakdown ?? []).map((part) => [part.id, part.bytes]));
    for (const part of ['blocks', 'chainstate', 'txindex', 'blockfilterindex']) {
      expect(sizes[part], part).toBeGreaterThan(0);
    }
    expect(overview.indexes.filter((index) => index.enabled).map((index) => index.id)).toEqual([
      'txindex',
      'blockfilterindex',
    ]);
    expect(overview.indexes.find((index) => index.id === 'txindex')).toMatchObject({
      synced: true,
      bestBlockHeight: 150,
    });
    expect(overview.chain).toMatchObject({ height: 150 });
    expect(overview.pruning.enabled).toBe(false);
    expect(overview.volume?.freeBytes).toBeGreaterThan(0);
    expect(['ssd', 'hdd', 'unknown']).toContain(overview.volume?.kind);
    // Nothing is left behind by a switched-off index on a fresh node.
    expect(overview.warnings.filter((warning) => warning.code === 'unused-index')).toEqual([]);
    expect(overview.expectedFullBytes).toBeNull();
  });

  it('reports a pruned node’s target and the oldest block it keeps', async () => {
    const overview = await storage.overview('pruned');
    expect(overview.pruning).toEqual({
      enabled: true,
      automatic: true,
      targetBytes: 550 * 1024 * 1024,
      pruneHeight: 0,
      pruneTime: REGTEST_GENESIS_TIME,
    });
    expect(overview.indexes.every((index) => !index.enabled)).toBe(true);
  });
});
