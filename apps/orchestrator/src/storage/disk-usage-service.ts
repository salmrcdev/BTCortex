import { existsSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { AppFailure, nodeSeries } from '@btcortex/contracts';
import type {
  BackupSettings,
  CleanupKind,
  CleanupResult,
  DiskUsage,
  ElectrumOverview,
  Job,
  ManagedFolder,
  MetricHistory,
  MetricSeries,
  NodeWithStatus,
  StorageForecast,
  Volume,
} from '@btcortex/contracts';
import type { Logger } from '../logging/logger';
import { localDataDirectory } from '../nodes/local-files';
import type { AppPaths } from '../platform/paths';
import type { VirtualDiskFile } from './virtual-disks';
import { electrumWalletsFolder } from '../platform/paths';

// Storage across everything BTCortex keeps (specification section 27). Each
// folder is listed with the service that owns it; only BTCortex's own
// leftovers — interrupted downloads and temporary files, older than an hour
// and while no job runs — can be removed here, and only by the user.
// Blockchain, index, wallet, backup and export files are never removed from
// this page, whatever their names. The virtual disks of WSL2 and Docker
// Desktop, which BTCortex does not use, are listed read-only. Growth comes
// from the monitoring's samples of each node's block files.

const REUSE_MS = 10 * 60 * 1000;
/** A leftover is at least this old, so a download or a backup that just started is never touched. */
const LEFTOVER_AGE_MS = 60 * 60 * 1000;
const FORECAST_HOURS = 30 * 24;
/** Fewer days than this and the pace is not worth extrapolating. */
const MIN_FORECAST_DAYS = 1;
/** Below this, the block files are treated as not growing. */
const MIN_GROWTH_BYTES_PER_DAY = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DiskUsageServiceOptions {
  paths: AppPaths;
  nodes: () => NodeWithStatus[];
  electrum: () => Promise<ElectrumOverview>;
  backups: () => BackupSettings;
  jobs: () => Job[];
  history: (series: MetricSeries, hours: number, now: Date) => MetricHistory;
  folderSize: (path: string) => Promise<number>;
  measureVolume: (path: string) => Promise<Volume>;
  /** WSL2 and Docker Desktop disks on this PC, which BTCortex does not use. */
  virtualDisks?: () => Promise<VirtualDiskFile[]>;
  logger: Logger;
  now?: () => Date;
}

interface Leftovers {
  files: string[];
  bytes: number;
}

/** Bytes per day from a least-squares line through the samples, and the days they span. */
export function growthPerDay(points: readonly { at: string; value: number }[]): { perDay: number; days: number } {
  if (points.length < 2) return { perDay: 0, days: 0 };
  const xs = points.map((point) => Date.parse(point.at) / DAY_MS);
  const ys = points.map((point) => point.value);
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = (xs[index] ?? 0) - meanX;
    numerator += dx * ((ys[index] ?? 0) - meanY);
    denominator += dx * dx;
  }
  const days = Math.max(...xs) - Math.min(...xs);
  return { perDay: denominator === 0 ? 0 : numerator / denominator, days };
}

type Measurement = Omit<DiskUsage, 'cleanupBlockedBy'>;

export class DiskUsageService {
  private cached: { at: number; value: Promise<Measurement> } | undefined;

  constructor(private readonly options: DiskUsageServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  async overview(refresh: boolean): Promise<DiskUsage> {
    const now = this.now().getTime();
    let cached = this.cached;
    if (refresh || !cached || now - cached.at >= REUSE_MS) {
      const value = this.measure();
      cached = { at: now, value };
      this.cached = cached;
      value.catch(() => {
        if (this.cached?.value === value) this.cached = undefined;
      });
    }
    // Jobs start and finish far more often than folders change size, so this is never reused.
    return { ...(await cached.value), cleanupBlockedBy: this.blockedBy() };
  }

  /** Why the leftovers may be in use, if a job is running that could be writing them. */
  private blockedBy(): string | null {
    const running = this.options.jobs().filter((job) => job.state === 'running' || job.state === 'queued');
    return running.length === 0
      ? null
      : `${running[0]?.title ?? 'A job'} is running and may be using these files; try again when it has finished.`;
  }

  private async leftovers(folder: string): Promise<Leftovers> {
    let entries: Dirent[];
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return { files: [], bytes: 0 };
    }
    const cutoff = this.now().getTime() - LEFTOVER_AGE_MS;
    const found: Leftovers = { files: [], bytes: 0 };
    for (const entry of entries) {
      // Only files directly in BTCortex's own folder: nothing below it, nothing it does not own.
      if (!entry.isFile()) continue;
      const path = join(folder, entry.name);
      const info = await stat(path).catch(() => undefined);
      if (!info || info.mtime.getTime() > cutoff) continue;
      found.files.push(path);
      found.bytes += info.size;
    }
    return found;
  }

  private folderOf(kind: CleanupKind): string {
    return kind === 'interrupted-downloads' ? this.options.paths.downloads : this.options.paths.temporary;
  }

  private async databaseSize(): Promise<number> {
    const sizes = await Promise.all(
      ['', '-wal', '-shm'].map((suffix) =>
        stat(`${this.options.paths.database}${suffix}`).then(
          (info) => info.size,
          () => 0,
        ),
      ),
    );
    return sizes.reduce((sum, size) => sum + size, 0);
  }

  private async measure(): Promise<Measurement> {
    const { paths } = this.options;
    const now = this.now();
    const measured = async (path: string) => this.options.folderSize(path).catch(() => null);
    const [downloads, temporary] = await Promise.all([
      this.leftovers(paths.downloads),
      this.leftovers(paths.temporary),
    ]);

    const folders: ManagedFolder[] = [
      {
        id: 'database',
        path: paths.database,
        owner: 'btcortex',
        ownerName: 'BTCortex',
        route: '/settings',
        bytes: await this.databaseSize(),
        readOnly: false,
        cleanup: null,
      },
      {
        id: 'software',
        path: paths.installations,
        owner: 'software',
        ownerName: 'Installed software',
        route: '/software',
        bytes: await measured(paths.installations),
        readOnly: false,
        cleanup: null,
      },
      {
        id: 'logs',
        path: paths.logs,
        owner: 'logs',
        ownerName: 'Logs',
        route: '/logs',
        bytes: await measured(paths.logs),
        readOnly: false,
        cleanup: null,
      },
      {
        id: 'downloads',
        path: paths.downloads,
        owner: 'downloads',
        ownerName: 'Downloads',
        route: null,
        bytes: await measured(paths.downloads),
        readOnly: false,
        cleanup:
          downloads.files.length > 0
            ? { kind: 'interrupted-downloads', bytes: downloads.bytes, files: downloads.files.length }
            : null,
      },
      {
        id: 'temporary',
        path: paths.temporary,
        owner: 'temporary',
        ownerName: 'Temporary files',
        route: null,
        bytes: await measured(paths.temporary),
        readOnly: false,
        cleanup:
          temporary.files.length > 0
            ? { kind: 'temporary-files', bytes: temporary.bytes, files: temporary.files.length }
            : null,
      },
      {
        id: 'exports',
        path: paths.exports,
        owner: 'exports',
        ownerName: 'Exports',
        route: '/logs',
        bytes: await measured(paths.exports),
        readOnly: false,
        cleanup: null,
      },
      {
        id: 'tor',
        path: join(paths.root, 'tor'),
        owner: 'tor',
        ownerName: 'Tor',
        route: '/tor',
        bytes: await measured(join(paths.root, 'tor')),
        readOnly: false,
        cleanup: null,
      },
      {
        id: 'lightning',
        path: join(paths.root, 'backups', 'lightning'),
        owner: 'lightning',
        ownerName: 'Lightning channel backups',
        route: '/lightning',
        bytes: await measured(join(paths.root, 'backups', 'lightning')),
        readOnly: false,
        cleanup: null,
      },
    ];
    // Wallets someone made in the Electrum BTCortex installed: shown so that they are not forgotten.
    const electrumWallets = electrumWalletsFolder(paths);
    if (existsSync(electrumWallets)) {
      folders.push({
        id: 'electrum-wallets',
        path: electrumWallets,
        owner: 'electrum-wallets',
        ownerName: 'Electrum wallets',
        route: '/wallets',
        bytes: await measured(electrumWallets),
        readOnly: false,
        cleanup: null,
      });
    }

    for (const { profile } of this.options.nodes()) {
      const directory = localDataDirectory(profile);
      if (directory === undefined) continue;
      const managed = profile.execution === 'managed';
      folders.push({
        id: `node:${profile.id}`,
        path: directory,
        owner: managed ? 'node' : 'external-node',
        ownerName: profile.name,
        route: `/nodes/${profile.id}/storage`,
        bytes: await measured(directory),
        readOnly: !managed,
        cleanup: null,
      });
    }

    const electrum = await this.options.electrum().catch((): ElectrumOverview => ({ installed: null, servers: [] }));
    for (const server of electrum.servers) {
      if (server.dataDirectory === null) continue;
      folders.push({
        id: `electrum:${server.nodeId}`,
        path: server.dataDirectory,
        owner: 'electrum',
        ownerName: `Electrum server of ${server.nodeName}`,
        route: '/electrum',
        bytes: server.indexBytes ?? (await measured(server.dataDirectory)),
        readOnly: false,
        cleanup: null,
      });
    }

    const destination = (() => {
      try {
        return this.options.backups().destination;
      } catch {
        return null;
      }
    })();
    if (destination !== null) {
      folders.push({
        id: 'backups',
        path: destination,
        owner: 'backups',
        ownerName: 'Backups',
        route: '/backups',
        bytes: await measured(destination),
        readOnly: false,
        cleanup: null,
      });
    }

    const virtualDisks = await (this.options.virtualDisks?.() ?? Promise.resolve([])).catch(
      (): VirtualDiskFile[] => [],
    );
    for (const disk of virtualDisks) {
      folders.push({
        id: `${disk.owner}:${disk.name}`,
        path: disk.path,
        owner: disk.owner,
        ownerName: disk.owner === 'docker' ? `Docker Desktop (${disk.name})` : `WSL2: ${disk.name}`,
        route: null,
        bytes: disk.bytes,
        readOnly: true,
        cleanup: null,
      });
    }

    // Volumes, each measured once, with the folders on them.
    const byRoot = new Map<string, string[]>();
    for (const folder of folders) {
      const root = parse(folder.path).root.toUpperCase();
      byRoot.set(root, [...(byRoot.get(root) ?? []), folder.id]);
    }
    const volumes = (
      await Promise.all(
        [...byRoot].map(async ([root, ids]) => {
          const first = folders.find((folder) => folder.id === ids[0]);
          const volume = first ? await this.options.measureVolume(first.path).catch(() => undefined) : undefined;
          return volume
            ? [{ root, totalBytes: volume.totalBytes, freeBytes: volume.freeBytes, kind: volume.kind, folders: ids }]
            : [];
        }),
      )
    ).flat();

    const forecasts: StorageForecast[] = [];
    for (const { profile } of this.options.nodes()) {
      const directory = localDataDirectory(profile);
      if (directory === undefined) continue;
      const { perDay, days } = growthPerDay(
        this.options.history(nodeSeries('node.size', profile.id), FORECAST_HOURS, now).points,
      );
      if (days < MIN_FORECAST_DAYS) continue;
      const root = parse(directory).root.toUpperCase();
      const volume = volumes.find((entry) => entry.root === root);
      if (!volume) continue;
      const growing = perDay >= MIN_GROWTH_BYTES_PER_DAY;
      forecasts.push({
        nodeId: profile.id,
        name: profile.name,
        volume: root,
        growthBytesPerDay: Math.max(0, perDay),
        daysUntilFull: growing ? volume.freeBytes / perDay : null,
        measuredDays: days,
      });
    }

    return { measuredAt: now.toISOString(), volumes, folders, forecasts };
  }

  /** Removes BTCortex's own leftovers of one kind; refused while a job could be using them. */
  async clean(kind: CleanupKind): Promise<CleanupResult> {
    const blocked = this.blockedBy();
    if (blocked !== null) {
      throw new AppFailure({
        code: 'storage.busy',
        message: blocked,
        component: 'Storage',
        dataRisk: 'none',
        recoveryActions: [{ id: 'retry', label: 'Try again later' }],
      });
    }
    const found = await this.leftovers(this.folderOf(kind));
    let files = 0;
    let freedBytes = 0;
    for (const path of found.files) {
      const info = await stat(path).catch(() => undefined);
      if (!info) continue;
      try {
        await unlink(path);
        files += 1;
        freedBytes += info.size;
      } catch (error) {
        this.options.logger.warn('A leftover file could not be removed', { kind, error });
      }
    }
    this.cached = undefined;
    this.options.logger.info('Cleaned up leftovers', { kind, files, freedBytes });
    return { kind, files, freedBytes };
  }
}
