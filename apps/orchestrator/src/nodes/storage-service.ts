import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  BitcoinConfig,
  CHAIN_SIZE_ESTIMATES,
  effectiveScalar,
  interpretBoolean,
  NETWORK_PARAMETERS,
  resolveEffective,
  setOption,
} from '@btcortex/bitcoin-config';
import type { BitcoinNetwork } from '@btcortex/bitcoin-config';
import { BitcoinRpcError } from '@btcortex/bitcoin-rpc';
import type { IndexInfo } from '@btcortex/bitcoin-rpc';
import { AppFailure } from '@btcortex/contracts';
import type {
  AppError,
  ChainVerification,
  ConfigureStorageResult,
  IndexId,
  IndexStatus,
  NodeProfile,
  ReindexScope,
  StorageChange,
  StorageLocation,
  StorageOverview,
  StoragePart,
  StoragePartId,
  StorageWarning,
  Volume,
} from '@btcortex/contracts';
import { configFilePath } from '@btcortex/integration-bitcoin-core';
import { sparrowHome } from '@btcortex/integration-sparrow';
import type { Logger } from '../logging/logger';
import { folderSize, measureVolume, topLevelFilesSize } from '../platform/disks';
import type { NodeConfigService } from './config-service';
import { localDataDirectory } from './local-files';
import { parseCoreVersion } from './version-risk';
import { describeNodeError, nodeComponent } from './node-errors';
import type { NodeManager } from './node-manager';

// Storage and indexing (specification section 5.10). Bitcoin Core reports
// pruning and indexes over RPC; folder sizes and the disk can only be measured
// when the node's files are on this computer. Walking the block folders is
// cheap but not free, so local measurements are reused for a minute.
//
// Changes are offered only for nodes BTCortex set up. They go through the
// configuration service (same checks, backup and atomic write as the editor),
// and incompatible combinations are refused here with an explanation before
// Bitcoin Core would refuse to start.

const GIB = 1024 ** 3;
/** Below this, Bitcoin Core is close to its own "Disk space is too low!" shutdown at 50 MiB. */
const CRITICAL_FREE_BYTES = 2 * GIB;
const LOW_FREE_BYTES = 10 * GIB;
const MEASUREMENT_REUSE_MS = 60_000;
const EXTERNAL_BUSES = new Set(['USB', 'SD', 'MMC', '1394']);
/** verifychain's defaults: level 3 checks the blocks and disconnects them from the chainstate. */
const VERIFY_LEVEL = 3;
const VERIFY_BLOCKS = 6;
const VERIFY_TIMEOUT_MS = 10 * 60_000;

/** The optional indexes and their names in getindexinfo, which lists only those switched on. */
const INDEXES: readonly { id: IndexId; name: string }[] = [
  { id: 'txindex', name: 'txindex' },
  { id: 'blockfilterindex', name: 'basic block filter index' },
  { id: 'coinstatsindex', name: 'coinstatsindex' },
  { id: 'txospenderindex', name: 'txospenderindex' },
];
/** Indexes that need every block, so Bitcoin Core refuses them together with pruning. */
const NEEDS_EVERY_BLOCK: readonly IndexId[] = ['txindex', 'txospenderindex'];

type IndexPartId = Exclude<StoragePartId, 'blocks' | 'chainstate' | 'wallets' | 'other'>;

/** Folders under `indexes`, relative to the network folder. */
const INDEX_FOLDERS: Record<IndexPartId, string> = {
  txindex: join('indexes', 'txindex'),
  blockfilterindex: join('indexes', 'blockfilter'),
  coinstatsindex: join('indexes', 'coinstatsindex'),
  txospenderindex: join('indexes', 'txospenderindex'),
  // Before 30.0 the coin statistics index lived here; 30.0 and later leave it for downgrades.
  'old-coinstatsindex': join('indexes', 'coinstats'),
};

function isIndexPart(part: StoragePartId): part is IndexPartId {
  return Object.hasOwn(INDEX_FOLDERS, part);
}

/**
 * Bitcoin Knots 29 and Bitcoin Core before 30.0 keep the live coin statistics
 * index in indexes\coinstats, the folder 30.0 and later leave behind; on those
 * nodes it is the index itself, never an old copy to delete.
 */
function keepsCoinstatsInOldFolder(profile: NodeProfile): boolean {
  if (profile.implementation === 'bitcoin-knots') return true;
  const version = parseCoreVersion(profile.runtimeVersion);
  return version !== undefined && version.major < 30;
}

/** The index folders of this node: where each index of its version lives. */
function indexFoldersOf(profile: NodeProfile): Partial<Record<IndexPartId, string>> {
  if (!keepsCoinstatsInOldFolder(profile)) return INDEX_FOLDERS;
  const { 'old-coinstatsindex': _leftBehind, ...current } = INDEX_FOLDERS;
  return { ...current, coinstatsindex: join('indexes', 'coinstats') };
}

/** txospenderindex arrived in Bitcoin Core 31.0; Bitcoin Knots 29 ignores it. */
function indexesOf(profile: NodeProfile): readonly { id: IndexId; name: string }[] {
  const version = parseCoreVersion(profile.runtimeVersion);
  const hasSpenderIndex = profile.implementation !== 'bitcoin-knots' && (version === undefined || version.major >= 31);
  return hasSpenderIndex ? INDEXES : INDEXES.filter((index) => index.id !== 'txospenderindex');
}

const BlockHeaderSchema = z.looseObject({ time: z.number().int() });

interface LocalMeasurements {
  networkDirectory: string;
  volume: Volume;
  breakdown: StoragePart[];
  wallets: { count: number; bytes: number };
}

export interface ConfiguredStorage {
  indexes: Record<IndexId, boolean>;
  pruneMiB: number;
  /** peerblockfilters: serving filters to peers, which needs the block filter index. */
  servesFilters: boolean;
}

/** The indexes and pruning bitcoin.conf asks for, read as Bitcoin Core reads them. */
export function configuredStorage(text: string, network: BitcoinNetwork): ConfiguredStorage {
  const effective = resolveEffective(BitcoinConfig.parse(text), network);
  const flag = (key: string) => {
    const value = effectiveScalar(effective, key);
    return value !== undefined && interpretBoolean(value);
  };
  // -blockfilterindex takes "1" (or nothing) for every filter type, a type name such as "basic", or "0".
  const filters = effectiveScalar(effective, 'blockfilterindex');
  const prune = Number.parseInt(effectiveScalar(effective, 'prune') ?? '0', 10);
  return {
    indexes: {
      txindex: flag('txindex'),
      blockfilterindex: filters !== undefined && filters.trim() !== '0',
      coinstatsindex: flag('coinstatsindex'),
      txospenderindex: flag('txospenderindex'),
    },
    pruneMiB: Number.isFinite(prune) && prune > 0 ? prune : 0,
    servesFilters: flag('peerblockfilters'),
  };
}

export function storageWarnings(input: {
  volume: Volume | null;
  pruned: boolean;
  initialBlockDownload: boolean;
  /** Block, undo and chainstate files so far. */
  chainBytes: number;
  expectedFullBytes: number | null;
  indexes: readonly IndexStatus[];
  breakdown: readonly StoragePart[] | null;
  /** Indexes switched on in bitcoin.conf, whose files the next start will use. */
  configured?: ConfiguredStorage | null;
}): StorageWarning[] {
  const warnings: StorageWarning[] = [];
  const { volume } = input;
  if (volume) {
    if (volume.freeBytes < CRITICAL_FREE_BYTES) {
      warnings.push({ code: 'disk-critical', severity: 'danger', bytes: volume.freeBytes });
    } else if (volume.freeBytes < LOW_FREE_BYTES) {
      warnings.push({ code: 'disk-low', severity: 'warning', bytes: volume.freeBytes });
    }
    if (!input.pruned && input.initialBlockDownload && input.expectedFullBytes !== null) {
      const needed = Math.max(0, input.expectedFullBytes - input.chainBytes);
      if (needed > volume.freeBytes) warnings.push({ code: 'chain-will-not-fit', severity: 'danger', bytes: needed });
    }
    if (volume.kind === 'hdd') {
      warnings.push({ code: 'hard-disk', severity: input.initialBlockDownload ? 'warning' : 'info' });
    }
    if (volume.bus !== null && EXTERNAL_BUSES.has(volume.bus.toUpperCase())) {
      warnings.push({ code: 'external-drive', severity: 'warning' });
    }
  }
  for (const part of input.breakdown ?? []) {
    if (part.bytes === 0) continue;
    const index = input.indexes.find((candidate) => candidate.id === part.id);
    const wanted = index !== undefined && input.configured?.indexes[index.id] === true;
    if ((index && !index.enabled && !wanted) || part.id === 'old-coinstatsindex') {
      warnings.push({ code: 'unused-index', severity: 'info', bytes: part.bytes, part: part.id });
    }
  }
  return warnings;
}

export interface StorageServiceOptions {
  nodes: Pick<NodeManager, 'get' | 'rpc' | 'restart'>;
  config: Pick<NodeConfigService, 'get' | 'save'>;
  logger: Logger;
  /** BTCortex's own data folder. */
  appDataDirectory: string;
  env?: { APPDATA?: string | undefined };
  measureVolume?: (path: string) => Promise<Volume>;
  folderSize?: (path: string) => Promise<number>;
  now?: () => number;
}

export class StorageService {
  private readonly measurements = new Map<string, { at: number; value: Promise<LocalMeasurements> }>();

  constructor(private readonly options: StorageServiceOptions) {}

  async overview(nodeId: string): Promise<StorageOverview> {
    const { profile } = this.options.nodes.get(nodeId);
    const client = this.options.nodes.rpc(nodeId);
    try {
      const [blockchain, indexInfo] = await Promise.all([
        client.getBlockchainInfo(),
        client.getIndexInfo().catch((error: unknown): IndexInfo => {
          if (error instanceof BitcoinRpcError && error.isMethodNotFound) return {};
          throw error;
        }),
      ]);
      let pruneTime: number | null = null;
      if (blockchain.pruned && blockchain.pruneheight !== undefined) {
        const hash = await client.call<string>('getblockhash', [blockchain.pruneheight]);
        pruneTime = BlockHeaderSchema.parse(await client.call('getblockheader', [hash])).time;
      }
      const [local, configured] = await Promise.all([this.local(nodeId, profile), this.configured(profile)]);
      const sizes = new Map(local?.breakdown.map((part) => [part.id, part.bytes]));
      const indexes: IndexStatus[] = indexesOf(profile).map(({ id, name }) => {
        const info = indexInfo[name];
        return {
          id,
          enabled: info !== undefined,
          synced: info?.synced ?? false,
          bestBlockHeight: info?.best_block_height ?? null,
          bytes: local ? (sizes.get(id) ?? 0) : null,
        };
      });
      const expectedFullBytes = this.expectedFullBytes(profile.network);
      return {
        local: local !== undefined,
        manageable: profile.execution === 'managed',
        configured: configured && { indexes: configured.indexes, pruneMiB: configured.pruneMiB },
        networkDirectory: local?.networkDirectory ?? null,
        volume: local?.volume ?? null,
        blockFilesBytes: blockchain.size_on_disk,
        breakdown: local?.breakdown ?? null,
        chain: {
          height: blockchain.blocks,
          headers: blockchain.headers,
          initialBlockDownload: blockchain.initialblockdownload,
        },
        expectedFullBytes,
        pruning: {
          enabled: blockchain.pruned,
          automatic: blockchain.automatic_pruning ?? false,
          targetBytes: blockchain.prune_target_size ?? null,
          pruneHeight: blockchain.pruned ? (blockchain.pruneheight ?? null) : null,
          pruneTime,
        },
        indexes,
        wallets: local?.wallets ?? null,
        locations: await this.locations(local),
        warnings: storageWarnings({
          volume: local?.volume ?? null,
          pruned: blockchain.pruned,
          initialBlockDownload: blockchain.initialblockdownload,
          chainBytes: blockchain.size_on_disk + (sizes.get('chainstate') ?? 0),
          expectedFullBytes,
          indexes,
          breakdown: local?.breakdown ?? null,
          configured,
        }),
      };
    } catch (error) {
      if (error instanceof AppFailure) throw error;
      throw new AppFailure(describeNodeError(profile, error));
    }
  }

  /**
   * Switches indexes on or off and changes pruning in bitcoin.conf, then restarts the node so
   * that the change takes effect. Leaving pruning restarts it with `-reindex`, which downloads
   * the chain again.
   */
  async configure(nodeId: string, change: StorageChange, confirmed: boolean): Promise<ConfigureStorageResult> {
    const { profile } = this.manageable(nodeId);
    if (!confirmed) {
      throw this.failure(profile, {
        code: 'storage.confirmation-required',
        message: 'Changing indexes or pruning restarts the node and can delete data, so it needs your confirmation.',
      });
    }
    return this.withNode(profile, () => this.configureNow(nodeId, profile, change));
  }

  private async configureNow(
    nodeId: string,
    profile: NodeProfile,
    change: StorageChange,
  ): Promise<ConfigureStorageResult> {
    const client = this.options.nodes.rpc(nodeId);
    const document = await this.options.config.get(nodeId);
    if (!document.editable) {
      throw this.failure(profile, {
        code: 'config.read-only',
        message: document.readOnlyReason ?? 'This configuration cannot be changed from BTCortex.',
      });
    }

    let text = document.text;
    for (const [id, on] of Object.entries(change.indexes ?? {})) {
      text = setOption(text, id, on ? ['1'] : undefined, profile.network);
    }
    if (change.pruning) {
      text = setOption(
        text,
        'prune',
        change.pruning.mode === 'off' ? undefined : [String(change.pruning.targetMiB)],
        profile.network,
      );
    }
    const after = configuredStorage(text, profile.network);
    const conflicting = NEEDS_EVERY_BLOCK.filter((id) => after.indexes[id]);
    if (after.pruneMiB > 0 && conflicting.length > 0) {
      throw this.failure(profile, {
        code: 'storage.incompatible',
        message:
          'The transaction index and the spent-output index need every block, so Bitcoin Core refuses to start with them and pruning together. Switch them off to prune.',
        details: { indexes: conflicting },
      });
    }
    if (after.servesFilters && !after.indexes.blockfilterindex) {
      throw this.failure(profile, {
        code: 'storage.incompatible',
        message:
          'This node serves block filters to its peers (peerblockfilters), which needs the block filter index. Switch that off in the configuration first.',
      });
    }

    const blockchain = await client.getBlockchainInfo();
    // A pruned node becomes a full node again only by downloading every block again.
    const reindexing = blockchain.pruned && after.pruneMiB === 0;
    if (reindexing) await this.ensureRoomForFullChain(nodeId, profile, blockchain.size_on_disk);

    const saved = await this.options.config.save(nodeId, {
      text,
      revision: document.revision,
      // Confirmed above: pruning deletes block files, and leaving it rebuilds everything.
      acceptedRisks: ['prune'],
    });
    const restarting = saved.changedKeys.length > 0;
    if (restarting) await this.options.nodes.restart(nodeId, { oneShotArguments: reindexing ? ['-reindex'] : [] });
    this.measurements.delete(nodeId);
    this.options.logger.info('Changed storage settings', {
      nodeId,
      changedKeys: saved.changedKeys,
      restarting,
      reindexing,
    });
    return { changedKeys: saved.changedKeys, backup: saved.backup, restarting, reindexing };
  }

  /** Bitcoin Core's own consistency check of the latest blocks; read-only, and quick at the default depth. */
  async verify(nodeId: string): Promise<ChainVerification> {
    const { profile } = this.options.nodes.get(nodeId);
    const started = this.options.now?.() ?? Date.now();
    try {
      const valid = await this.options.nodes
        .rpc(nodeId)
        .call<boolean>('verifychain', [VERIFY_LEVEL, VERIFY_BLOCKS], { timeoutMs: VERIFY_TIMEOUT_MS });
      const durationMs = (this.options.now?.() ?? Date.now()) - started;
      return { valid, checkLevel: VERIFY_LEVEL, blocks: VERIFY_BLOCKS, durationMs };
    } catch (error) {
      throw new AppFailure(describeNodeError(profile, error));
    }
  }

  /** Restarts the node with a one-shot rebuild flag; nothing is written to bitcoin.conf. */
  async reindex(nodeId: string, scope: ReindexScope): Promise<void> {
    const { profile } = this.manageable(nodeId);
    await this.withNode(profile, async () => {
      if (scope === 'chainstate' && (await this.prunedNow(nodeId, profile))) {
        throw this.failure(profile, {
          code: 'storage.reindex-not-possible',
          message:
            'A pruned node no longer has the blocks needed to rebuild the chainstate. Only a full rebuild, which downloads the chain again, is possible.',
        });
      }
      await this.options.nodes.restart(nodeId, {
        oneShotArguments: [scope === 'chainstate' ? '-reindex-chainstate' : '-reindex'],
      });
    });
    this.options.logger.info('Rebuilding the node’s databases', { nodeId, scope });
  }

  /** Deletes the folder of an index that is switched off, both in the running node and in bitcoin.conf. */
  async removeIndexFiles(nodeId: string, part: StoragePartId): Promise<number> {
    const { profile } = this.manageable(nodeId);
    if (!isIndexPart(part)) {
      throw this.failure(profile, {
        code: 'storage.not-an-index',
        message: 'Only the files of an index can be deleted here.',
      });
    }
    const dataDirectory = localDataDirectory(profile);
    if (!dataDirectory) {
      throw this.failure(profile, {
        code: 'storage.not-local',
        message: 'This node’s files are not on this computer.',
      });
    }
    const folders = indexFoldersOf(profile);
    const relative = folders[part];
    if (relative === undefined) {
      throw this.failure(profile, {
        code: 'storage.not-an-index',
        message: 'This node keeps no such index folder.',
      });
    }
    // The folder 30.0 and later leave behind exists only for such nodes, which never open it.
    const index = INDEXES.find((candidate) => candidate.id === part);
    if (index) {
      const [indexInfo, configured] = await this.withNode(profile, () =>
        Promise.all([this.options.nodes.rpc(nodeId).getIndexInfo(), this.configured(profile)]),
      );
      if (indexInfo[index.name] !== undefined || configured?.indexes[index.id] === true) {
        throw this.failure(profile, {
          code: 'storage.index-in-use',
          message: 'This index is switched on, so its files are in use. Switch it off first.',
        });
      }
    }
    const folder = join(dataDirectory, NETWORK_PARAMETERS[profile.network].subdirectory, relative);
    const bytes = await (this.options.folderSize ?? folderSize)(folder);
    await rm(folder, { recursive: true, force: true });
    this.measurements.delete(nodeId);
    this.options.logger.info('Deleted the files of an unused index', { nodeId, part, bytes });
    return bytes;
  }

  private async withNode<T>(profile: NodeProfile, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof AppFailure) throw error;
      throw new AppFailure(describeNodeError(profile, error));
    }
  }

  private manageable(nodeId: string) {
    const node = this.options.nodes.get(nodeId);
    if (node.profile.execution !== 'managed') {
      throw this.failure(node.profile, {
        code: 'storage.not-managed',
        message: 'BTCortex changes the storage of nodes it set up only. Existing installations stay as they are.',
      });
    }
    return node;
  }

  private failure(
    profile: NodeProfile,
    error: Pick<AppError, 'code' | 'message'> & { details?: Record<string, unknown> },
  ): AppFailure {
    return new AppFailure({
      ...error,
      component: nodeComponent(profile),
      dataRisk: 'none',
      recoveryActions: [],
    });
  }

  private async prunedNow(nodeId: string, profile: NodeProfile): Promise<boolean> {
    const node = this.options.nodes.get(nodeId);
    if (node.status.state === 'running') return (await this.options.nodes.rpc(nodeId).getBlockchainInfo()).pruned;
    // Stopped: what the configuration asks for is what the next start uses.
    return ((await this.configured(profile))?.pruneMiB ?? 0) > 0;
  }

  private async ensureRoomForFullChain(nodeId: string, profile: NodeProfile, blockFilesBytes: number): Promise<void> {
    const full = this.expectedFullBytes(profile.network);
    const local = await this.local(nodeId, profile);
    if (full === null || !local) return;
    // The pruned block files are replaced, so only the difference is needed.
    const needed = full - blockFilesBytes;
    if (needed > local.volume.freeBytes) {
      throw this.failure(profile, {
        code: 'storage.not-enough-space',
        message: `A full node needs about ${String(Math.ceil(needed / GIB))} GiB more, but only ${String(Math.floor(local.volume.freeBytes / GIB))} GiB is free on this disk.`,
        details: { neededBytes: needed, freeBytes: local.volume.freeBytes },
      });
    }
  }

  private expectedFullBytes(network: BitcoinNetwork): number | null {
    if (network === 'regtest') return null;
    const estimate = CHAIN_SIZE_ESTIMATES[network];
    return estimate.blocksBytes + estimate.chainstateBytes;
  }

  private async configured(profile: NodeProfile): Promise<ConfiguredStorage | null> {
    const dataDirectory = localDataDirectory(profile);
    if (!dataDirectory) return null;
    try {
      return configuredStorage(await readFile(configFilePath(dataDirectory), 'utf8'), profile.network);
    } catch (error) {
      // No bitcoin.conf means Bitcoin Core's defaults: no optional index, no pruning.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return configuredStorage('', profile.network);
      return null;
    }
  }

  private local(nodeId: string, profile: NodeProfile): Promise<LocalMeasurements> | undefined {
    const dataDirectory = localDataDirectory(profile);
    if (!dataDirectory) return undefined;
    const networkDirectory = join(dataDirectory, NETWORK_PARAMETERS[profile.network].subdirectory);
    if (!existsSync(networkDirectory)) return undefined;
    const now = this.options.now?.() ?? Date.now();
    const cached = this.measurements.get(nodeId);
    if (cached && now - cached.at < MEASUREMENT_REUSE_MS) return cached.value;
    const value = this.measure(networkDirectory, indexFoldersOf(profile));
    this.measurements.set(nodeId, { at: now, value });
    // A failed measurement is not kept: the next request tries again.
    value.catch(() => this.measurements.delete(nodeId));
    return value;
  }

  private async measure(
    networkDirectory: string,
    indexFolders: Partial<Record<IndexPartId, string>>,
  ): Promise<LocalMeasurements> {
    const size = this.options.folderSize ?? folderSize;
    const walletsDirectory = join(networkDirectory, 'wallets');
    const [volume, blocks, chainstate, indexSizes, other, fees, wallets] = await Promise.all([
      (this.options.measureVolume ?? measureVolume)(networkDirectory),
      size(join(networkDirectory, 'blocks')),
      size(join(networkDirectory, 'chainstate')),
      Promise.all(
        Object.entries(indexFolders).map(async ([id, folder]) => ({
          id: id as StoragePartId,
          bytes: await size(join(networkDirectory, folder)),
        })),
      ),
      topLevelFilesSize(networkDirectory),
      size(join(networkDirectory, 'fees')),
      this.wallets(walletsDirectory, size),
    ]);
    return {
      networkDirectory,
      volume,
      breakdown: [
        { id: 'blocks', bytes: blocks },
        { id: 'chainstate', bytes: chainstate },
        ...indexSizes,
        { id: 'wallets', bytes: wallets.bytes },
        // Peers, banned addresses, the saved mempool, fee estimates and logs.
        { id: 'other', bytes: other + fees },
      ],
      wallets,
    };
  }

  /** Wallets are folders holding a `wallet.dat`; the default wallet may be a `wallet.dat` in the folder itself. */
  private async wallets(
    directory: string,
    size: (path: string) => Promise<number>,
  ): Promise<{ count: number; bytes: number }> {
    let names: string[];
    try {
      names = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && existsSync(join(directory, entry.name, 'wallet.dat')))
        .map((entry) => entry.name);
    } catch {
      return { count: 0, bytes: 0 };
    }
    const root = existsSync(join(directory, 'wallet.dat')) ? 1 : 0;
    return { count: names.length + root, bytes: await size(directory) };
  }

  private async locations(local: LocalMeasurements | undefined): Promise<StorageLocation[]> {
    const size = this.options.folderSize ?? folderSize;
    const locations: StorageLocation[] = [];
    if (local) {
      locations.push({
        id: 'bitcoin-core',
        path: local.networkDirectory,
        bytes: local.breakdown.reduce((sum, part) => sum + part.bytes, 0),
      });
    }
    // Data directories of the nodes BTCortex manages are counted with those nodes, not here.
    const root = this.options.appDataDirectory;
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const folders = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name !== 'nodes')
        .map((entry) => size(join(root, entry.name))),
    );
    locations.push({
      id: 'btcortex',
      path: root,
      bytes: folders.reduce((sum, bytes) => sum + bytes, 0) + (await topLevelFilesSize(root)),
    });
    const sparrow = sparrowHome(this.options.env ?? process.env);
    if (existsSync(sparrow)) locations.push({ id: 'sparrow', path: sparrow, bytes: await size(sparrow) });
    return locations;
  }
}
