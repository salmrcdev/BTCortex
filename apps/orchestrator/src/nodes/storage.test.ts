import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import type { IndexStatus, NodeWithStatus, Volume } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { folderSize, topLevelFilesSize } from '../platform/disks';
import { StorageService, storageWarnings } from './storage-service';

const GIB = 1024 ** 3;

const ssd: Volume = {
  root: 'D:\\',
  totalBytes: 1000 * GIB,
  freeBytes: 500 * GIB,
  kind: 'ssd',
  bus: 'NVMe',
  model: null,
};
const noIndexes: IndexStatus[] = [];

describe('storageWarnings', () => {
  const base = {
    volume: ssd,
    pruned: false,
    initialBlockDownload: false,
    chainBytes: 700 * GIB,
    expectedFullBytes: 870 * GIB,
    indexes: noIndexes,
    breakdown: null,
  };

  it('warns before Bitcoin Core runs out of room', () => {
    expect(storageWarnings({ ...base, volume: { ...ssd, freeBytes: GIB } })).toEqual([
      { code: 'disk-critical', severity: 'danger', bytes: GIB },
    ]);
    expect(storageWarnings({ ...base, volume: { ...ssd, freeBytes: 5 * GIB } })[0]?.code).toBe('disk-low');
    expect(storageWarnings(base)).toEqual([]);
  });

  it('says when an unpruned chain still downloading will not fit', () => {
    const syncing = {
      ...base,
      initialBlockDownload: true,
      chainBytes: 100 * GIB,
      volume: { ...ssd, freeBytes: 300 * GIB },
    };
    expect(storageWarnings(syncing)).toContainEqual({
      code: 'chain-will-not-fit',
      severity: 'danger',
      bytes: 770 * GIB,
    });
    // A pruned node keeps only its target, so the full chain never has to fit.
    expect(storageWarnings({ ...syncing, pruned: true }).map((warning) => warning.code)).not.toContain(
      'chain-will-not-fit',
    );
  });

  it('points out hard disks and external drives', () => {
    const hdd = { ...ssd, kind: 'hdd' as const, bus: 'USB' };
    expect(storageWarnings({ ...base, volume: hdd, initialBlockDownload: true })).toEqual([
      { code: 'hard-disk', severity: 'warning' },
      { code: 'external-drive', severity: 'warning' },
    ]);
    expect(storageWarnings({ ...base, volume: hdd })[0]).toEqual({ code: 'hard-disk', severity: 'info' });
  });

  it('notices index files left behind by a switched-off index', () => {
    const indexes: IndexStatus[] = [
      { id: 'txindex', enabled: false, synced: false, bestBlockHeight: null, bytes: 40 * GIB },
      { id: 'blockfilterindex', enabled: true, synced: true, bestBlockHeight: 900_000, bytes: 12 * GIB },
    ];
    const warnings = storageWarnings({
      ...base,
      indexes,
      breakdown: [
        { id: 'txindex', bytes: 40 * GIB },
        { id: 'blockfilterindex', bytes: 12 * GIB },
        { id: 'old-coinstatsindex', bytes: GIB },
      ],
    });
    expect(warnings).toEqual([
      { code: 'unused-index', severity: 'info', bytes: 40 * GIB, part: 'txindex' },
      { code: 'unused-index', severity: 'info', bytes: GIB, part: 'old-coinstatsindex' },
    ]);
  });
});

describe('folder sizes', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-sizes-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('adds up nested files, and only the top level when asked', async () => {
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'top.dat'), Buffer.alloc(100));
    writeFileSync(join(root, 'a', 'one.dat'), Buffer.alloc(1000));
    writeFileSync(join(root, 'a', 'b', 'two.dat'), Buffer.alloc(10_000));
    expect(await folderSize(root)).toBe(11_100);
    expect(await topLevelFilesSize(root)).toBe(100);
    expect(await folderSize(join(root, 'missing'))).toBe(0);
  });
});

describe('StorageService', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-storage-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  interface SetUpOptions {
    pruned?: boolean;
    execution?: 'managed' | 'external';
    config?: string;
    freeBytes?: number;
    runningIndexes?: Record<string, { synced: boolean; best_block_height: number }>;
    /** A Bitcoin Knots 29 node, whose live coin statistics index is in indexes\coinstats. */
    knots?: boolean;
  }

  function setUp(options: SetUpOptions = {}) {
    const dataDirectory = join(root, 'Bitcoin');
    const network = join(dataDirectory, 'testnet4');
    const file = (path: string, bytes: number) => {
      mkdirSync(join(network, path, '..'), { recursive: true });
      writeFileSync(join(network, path), Buffer.alloc(bytes));
    };
    file(join('blocks', 'blk00000.dat'), 5000);
    file(join('chainstate', '000001.ldb'), 3000);
    file(join('indexes', 'txindex', '000001.ldb'), 700);
    file(join('indexes', 'blockfilter', 'basic', 'fltr00000.dat'), 400);
    file(join('wallets', 'savings', 'wallet.dat'), 200);
    file('peers.dat', 50);
    if (options.knots) file(join('indexes', 'coinstats', 'db', '000001.ldb'), 900);
    if (options.config !== undefined) writeFileSync(join(dataDirectory, 'bitcoin.conf'), options.config);
    const appData = join(root, 'BTCortex');
    mkdirSync(join(appData, 'logs'), { recursive: true });
    mkdirSync(join(appData, 'nodes'), { recursive: true });
    writeFileSync(join(appData, 'logs', 'orchestrator.log'), Buffer.alloc(80));
    writeFileSync(join(appData, 'nodes', 'huge.dat'), Buffer.alloc(9999));
    writeFileSync(join(appData, 'btcortex.db'), Buffer.alloc(20));
    const calls: { method: string; params: unknown; options: unknown }[] = [];
    const client = {
      getBlockchainInfo: () =>
        Promise.resolve({
          blocks: 120_000,
          headers: 120_000,
          initialblockdownload: false,
          size_on_disk: 5000,
          pruned: options.pruned ?? false,
          ...(options.pruned ? { pruneheight: 100_000, automatic_pruning: true, prune_target_size: 2 * GIB } : {}),
        }),
      getIndexInfo: () =>
        Promise.resolve(
          options.runningIndexes ?? { 'basic block filter index': { synced: false, best_block_height: 60_000 } },
        ),
      call: (method: string, params?: unknown, callOptions?: unknown) => {
        calls.push({ method, params, options: callOptions });
        if (method === 'getblockhash') return Promise.resolve('00'.repeat(32));
        if (method === 'getblockheader') return Promise.resolve({ time: 1_761_000_000 });
        if (method === 'verifychain') return Promise.resolve(true);
        return Promise.reject(new Error(`unexpected ${method}`));
      },
    } as unknown as BitcoinRpcClient;
    const node = {
      profile: {
        id: 'node-1',
        name: 'Test node',
        network: 'testnet4',
        execution: options.execution ?? 'managed',
        ...(options.knots ? { implementation: 'bitcoin-knots', runtimeVersion: '29.4.2.knots20260508' } : {}),
        dataDirectory,
        authentication: { kind: 'cookie' },
      },
      status: { state: 'running' },
    } as NodeWithStatus;
    const saves: { text: string; revision: string; acceptedRisks: readonly string[] }[] = [];
    const restarts: { nodeId: string; options: unknown }[] = [];
    const service = new StorageService({
      nodes: {
        get: () => node,
        rpc: () => client,
        restart: (nodeId, restartOptions) => {
          restarts.push({ nodeId, options: restartOptions });
          return Promise.resolve();
        },
      },
      config: {
        get: () =>
          Promise.resolve({
            path: join(dataDirectory, 'bitcoin.conf'),
            exists: true,
            editable: options.execution !== 'external',
            text: options.config ?? '',
            revision: 'revision-1',
            restartRequired: false,
            commandLine: [],
          }),
        save: (_nodeId, request) => {
          saves.push(request);
          return Promise.resolve({
            revision: 'revision-2',
            restartRequired: true,
            backup: 'bitcoin.conf.bak',
            changedKeys: request.text === (options.config ?? '') ? [] : ['changed'],
          });
        },
      },
      logger: new StructuredLogger([new MemorySink()], 'debug'),
      appDataDirectory: appData,
      env: { APPDATA: join(root, 'Roaming') },
      measureVolume: () => Promise.resolve({ ...ssd, freeBytes: options.freeBytes ?? 5 * GIB }),
    });
    return { service, calls, network, saves, restarts };
  }

  it('measures a local node’s folders, indexes and disk', async () => {
    const { service, network } = setUp();
    const overview = await service.overview('node-1');
    expect(overview.local).toBe(true);
    expect(overview.manageable).toBe(true);
    expect(overview.networkDirectory).toBe(network);
    expect(Object.fromEntries((overview.breakdown ?? []).map((part) => [part.id, part.bytes]))).toMatchObject({
      blocks: 5000,
      chainstate: 3000,
      txindex: 700,
      blockfilterindex: 400,
      wallets: 200,
      other: 50,
    });
    expect(overview.wallets).toEqual({ count: 1, bytes: 200 });
    expect(overview.indexes.find((index) => index.id === 'blockfilterindex')).toEqual({
      id: 'blockfilterindex',
      enabled: true,
      synced: false,
      bestBlockHeight: 60_000,
      bytes: 400,
    });
    expect(overview.pruning).toEqual({
      enabled: false,
      automatic: false,
      targetBytes: null,
      pruneHeight: null,
      pruneTime: null,
    });
    // The txindex folder is on disk while txindex is off.
    expect(overview.warnings.map((warning) => warning.code)).toEqual(['disk-low', 'unused-index']);
    // BTCortex's own folder, without the managed nodes' data counted with the nodes themselves.
    expect(overview.locations.find((location) => location.id === 'btcortex')?.bytes).toBe(100);
    expect(overview.locations.find((location) => location.id === 'bitcoin-core')?.bytes).toBe(9350);
  });

  it('reads what bitcoin.conf asks for, and does not call switched-on index files unused', async () => {
    const { service } = setUp({ config: '[testnet4]\ntxindex=1\nprune=0\nblockfilterindex=basic\n' });
    const overview = await service.overview('node-1');
    expect(overview.configured).toEqual({
      indexes: { txindex: true, blockfilterindex: true, coinstatsindex: false, txospenderindex: false },
      pruneMiB: 0,
    });
    // txindex starts using its files again after a restart.
    expect(overview.warnings.map((warning) => warning.code)).toEqual(['disk-low']);
  });

  it('dates the oldest block a pruned node still keeps', async () => {
    const { service, calls } = setUp({ pruned: true });
    const overview = await service.overview('node-1');
    expect(overview.pruning).toEqual({
      enabled: true,
      automatic: true,
      targetBytes: 2 * GIB,
      pruneHeight: 100_000,
      pruneTime: 1_761_000_000,
    });
    expect(calls.map((call) => call.method)).toEqual(['getblockhash', 'getblockheader']);
  });

  describe('changes', () => {
    it('needs confirmation and a node BTCortex set up', async () => {
      const { service } = setUp();
      await expect(service.configure('node-1', { indexes: { coinstatsindex: true } }, false)).rejects.toMatchObject({
        error: { code: 'storage.confirmation-required' },
      });
      const external = setUp({ execution: 'external' }).service;
      await expect(external.configure('node-1', { indexes: { coinstatsindex: true } }, true)).rejects.toMatchObject({
        error: { code: 'storage.not-managed' },
      });
      await expect(external.reindex('node-1', 'full')).rejects.toMatchObject({
        error: { code: 'storage.not-managed' },
      });
    });

    it('refuses pruning while an index needs every block, and switches both in one change', async () => {
      const { service, saves, restarts } = setUp({ config: '[testnet4]\ntxindex=1\n' });
      await expect(
        service.configure('node-1', { pruning: { mode: 'automatic', targetMiB: 2000 } }, true),
      ).rejects.toMatchObject({ error: { code: 'storage.incompatible' } });
      expect(saves).toEqual([]);

      const result = await service.configure(
        'node-1',
        { indexes: { txindex: false }, pruning: { mode: 'automatic', targetMiB: 2000 } },
        true,
      );
      // prune applies to every network, so it goes in the global part, as the editor would put it.
      expect(saves[0]?.text).toBe('prune=2000\n[testnet4]\n');
      expect(saves[0]?.acceptedRisks).toEqual(['prune']);
      expect(restarts).toEqual([{ nodeId: 'node-1', options: { oneShotArguments: [] } }]);
      expect(result).toEqual({
        changedKeys: ['changed'],
        backup: 'bitcoin.conf.bak',
        restarting: true,
        reindexing: false,
      });
    });

    it('refuses to drop the block filter index while peers are served filters', async () => {
      const { service } = setUp({ config: 'peerblockfilters=1\nblockfilterindex=1\n' });
      await expect(service.configure('node-1', { indexes: { blockfilterindex: false } }, true)).rejects.toMatchObject({
        error: { code: 'storage.incompatible' },
      });
    });

    it('leaves pruning with a full re-download, only when the chain fits on the disk', async () => {
      const tight = setUp({ pruned: true, config: '[testnet4]\nprune=2000\n', freeBytes: 10 * GIB });
      await expect(tight.service.configure('node-1', { pruning: { mode: 'off' } }, true)).rejects.toMatchObject({
        error: { code: 'storage.not-enough-space' },
      });
      expect(tight.saves).toEqual([]);

      const roomy = setUp({ pruned: true, config: '[testnet4]\nprune=2000\n', freeBytes: 500 * GIB });
      const result = await roomy.service.configure('node-1', { pruning: { mode: 'off' } }, true);
      expect(roomy.saves[0]?.text).toBe('[testnet4]\n');
      expect(roomy.restarts).toEqual([{ nodeId: 'node-1', options: { oneShotArguments: ['-reindex'] } }]);
      expect(result.reindexing).toBe(true);
    });

    it('does not restart when nothing changed', async () => {
      const { service, restarts } = setUp({ config: '[testnet4]\ncoinstatsindex=1\n' });
      const result = await service.configure('node-1', { indexes: { coinstatsindex: true } }, true);
      expect(result.restarting).toBe(false);
      expect(restarts).toEqual([]);
    });

    it('rebuilds databases with one-shot flags, never the chainstate of a pruned node', async () => {
      const pruned = setUp({ pruned: true });
      await expect(pruned.service.reindex('node-1', 'chainstate')).rejects.toMatchObject({
        error: { code: 'storage.reindex-not-possible' },
      });
      await pruned.service.reindex('node-1', 'full');
      expect(pruned.restarts).toEqual([{ nodeId: 'node-1', options: { oneShotArguments: ['-reindex'] } }]);

      const full = setUp();
      await full.service.reindex('node-1', 'chainstate');
      expect(full.restarts).toEqual([{ nodeId: 'node-1', options: { oneShotArguments: ['-reindex-chainstate'] } }]);
    });

    it('deletes the files of a switched-off index only', async () => {
      const { service, network } = setUp();
      await expect(service.removeIndexFiles('node-1', 'blockfilterindex')).rejects.toMatchObject({
        error: { code: 'storage.index-in-use' },
      });
      await expect(service.removeIndexFiles('node-1', 'blocks')).rejects.toMatchObject({
        error: { code: 'storage.not-an-index' },
      });
      expect(await service.removeIndexFiles('node-1', 'txindex')).toBe(700);
      expect(existsSync(join(network, 'indexes', 'txindex'))).toBe(false);
      expect(existsSync(join(network, 'indexes', 'blockfilter'))).toBe(true);
    });

    it('treats the indexes/coinstats folder of a Bitcoin Knots node as its live coin statistics index', async () => {
      const running = {
        coinstatsindex: { synced: true, best_block_height: 120_000 },
      };
      const { service, network } = setUp({ knots: true, runningIndexes: running });
      const overview = await service.overview('node-1');
      const parts = Object.fromEntries((overview.breakdown ?? []).map((part) => [part.id, part.bytes]));
      expect(parts['coinstatsindex']).toBe(900);
      expect(parts['old-coinstatsindex']).toBeUndefined();
      expect(overview.warnings.some((warning) => warning.part === 'coinstatsindex')).toBe(false);
      // Bitcoin Knots 29 has no txospenderindex to offer.
      expect(overview.indexes.map((index) => index.id)).not.toContain('txospenderindex');
      await expect(service.removeIndexFiles('node-1', 'old-coinstatsindex')).rejects.toMatchObject({
        error: { code: 'storage.not-an-index' },
      });
      await expect(service.removeIndexFiles('node-1', 'coinstatsindex')).rejects.toMatchObject({
        error: { code: 'storage.index-in-use' },
      });
      expect(existsSync(join(network, 'indexes', 'coinstats'))).toBe(true);
    });

    it('asks Bitcoin Core to verify the latest blocks', async () => {
      const { service, calls } = setUp();
      expect(await service.verify('node-1')).toMatchObject({ valid: true, checkLevel: 3, blocks: 6 });
      expect(calls).toContainEqual({ method: 'verifychain', params: [3, 6], options: { timeoutMs: 600_000 } });
    });
  });
});
