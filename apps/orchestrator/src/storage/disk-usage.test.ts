import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ElectrumOverview, Job, MetricHistory, NodeWithStatus } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { resolveAppPaths } from '../platform/paths';
import type { AppPaths } from '../platform/paths';
import { DiskUsageService, growthPerDay } from './disk-usage-service';
import { virtualDiskCandidates } from './virtual-disks';
import type { VirtualDiskFile } from './virtual-disks';

const GB = 1e9;
const NOW = new Date('2026-10-23T12:00:00.000Z');
const logger = new StructuredLogger([new MemorySink()], 'debug');

let root: string;
let paths: AppPaths;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'btcortex-storage-'));
  paths = resolveAppPaths({ BTCORTEX_DATA_DIR: root });
  for (const folder of [paths.downloads, paths.temporary, paths.logs, paths.exports, paths.installations]) {
    mkdirSync(folder, { recursive: true });
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A file with a given age by the service's clock, so that "older than an hour" can be tested at any time of day. */
function file(path: string, bytes: number, minutesAgo: number): void {
  writeFileSync(path, Buffer.alloc(bytes));
  const time = new Date(NOW.getTime() - minutesAgo * 60_000);
  utimesSync(path, time, time);
}

function setUp(
  world: { jobs?: Job[]; nodeSize?: { daysAgo: number; bytes: number }[]; virtualDisks?: VirtualDiskFile[] } = {},
) {
  const nodeDirectory = join(root, 'nodes', 'mainnet-1');
  mkdirSync(join(nodeDirectory, 'blocks'), { recursive: true });
  file(join(nodeDirectory, 'blocks', 'blk00000.dat'), 4096, 10);
  const node = {
    profile: { id: 'n1', name: 'Main node', execution: 'managed', network: 'mainnet', dataDirectory: nodeDirectory },
    status: { nodeId: 'n1', state: 'running', checkedAt: NOW.toISOString() },
  } as unknown as NodeWithStatus;
  const service = new DiskUsageService({
    paths,
    nodes: () => [node],
    electrum: () =>
      Promise.resolve({
        installed: null,
        servers: [
          { nodeId: 'n1', nodeName: 'Main node', dataDirectory: join(root, 'electrum', 'n1'), indexBytes: 200 * GB },
        ],
      } as unknown as ElectrumOverview),
    backups: () => ({
      destination: null,
      retention: 10,
      schedule: { everyHours: 0, encrypted: false },
      passphraseStored: false,
      lastRun: null,
    }),
    jobs: () => world.jobs ?? [],
    history: (series): MetricHistory => ({
      series,
      resolution: 'hour',
      points: (world.nodeSize ?? []).map((point) => ({
        at: new Date(NOW.getTime() - point.daysAgo * 24 * 60 * 60 * 1000).toISOString(),
        value: point.bytes,
      })),
    }),
    folderSize: (path) => Promise.resolve(existsSync(path) ? 4096 : 0),
    measureVolume: (path) =>
      Promise.resolve({
        root: parse(path).root,
        totalBytes: 1000 * GB,
        freeBytes: 100 * GB,
        kind: 'ssd',
        bus: null,
        model: null,
      }),
    virtualDisks: () => Promise.resolve(world.virtualDisks ?? []),
    logger,
    now: () => NOW,
  });
  return { service, nodeDirectory };
}

describe('storage across BTCortex', () => {
  it('lists every folder with its owner and offers to remove only BTCortex’s old leftovers', async () => {
    file(join(paths.downloads, 'bitcoin-31.1-win64.zip.partial'), 5000, 120);
    file(join(paths.downloads, 'tor-expert-bundle.tar.gz.partial'), 7000, 5);
    file(join(paths.temporary, 'wallet-backup-1.dat'), 3000, 180);
    const { service, nodeDirectory } = setUp();
    const usage = await service.overview(false);
    const folder = (id: string) => usage.folders.find((entry) => entry.id === id);
    expect(folder('node:n1')).toMatchObject({
      owner: 'node',
      ownerName: 'Main node',
      path: nodeDirectory,
      readOnly: false,
      cleanup: null,
    });
    expect(folder('electrum:n1')).toMatchObject({ owner: 'electrum', bytes: 200 * GB, route: '/electrum' });
    // The download from five minutes ago may still be resumed, so only the older one counts.
    expect(folder('downloads')?.cleanup).toEqual({ kind: 'interrupted-downloads', bytes: 5000, files: 1 });
    expect(folder('temporary')?.cleanup).toEqual({ kind: 'temporary-files', bytes: 3000, files: 1 });
    expect(folder('exports')?.cleanup).toBeNull();
    expect(usage.volumes[0]).toMatchObject({ totalBytes: 1000 * GB, freeBytes: 100 * GB, kind: 'ssd' });
    expect(usage.cleanupBlockedBy).toBeNull();

    expect(await service.clean('interrupted-downloads')).toEqual({
      kind: 'interrupted-downloads',
      files: 1,
      freedBytes: 5000,
    });
    expect(existsSync(join(paths.downloads, 'bitcoin-31.1-win64.zip.partial'))).toBe(false);
    expect(existsSync(join(paths.downloads, 'tor-expert-bundle.tar.gz.partial'))).toBe(true);
    // The node's files are never touched.
    expect(existsSync(join(nodeDirectory, 'blocks', 'blk00000.dat'))).toBe(true);
  });

  it('lists the wallets of the Electrum BTCortex installed, which are never cleaned up', async () => {
    const { service } = setUp();
    expect((await service.overview(false)).folders.some((entry) => entry.id === 'electrum-wallets')).toBe(false);
    mkdirSync(join(paths.root, 'electrum-wallets', 'regtest', 'wallets'), { recursive: true });
    file(join(paths.root, 'electrum-wallets', 'regtest', 'wallets', 'default_wallet'), 4000, 60);
    expect((await service.overview(true)).folders.find((entry) => entry.id === 'electrum-wallets')).toMatchObject({
      owner: 'electrum-wallets',
      path: join(paths.root, 'electrum-wallets'),
      route: '/wallets',
      readOnly: false,
      cleanup: null,
    });
  });

  it('refuses to clean up while a job could be using the files', async () => {
    file(join(paths.temporary, 'wallet-restore-1.dat'), 3000, 180);
    const world: { jobs: Job[] } = { jobs: [{ id: 'j1', title: 'Back up now', state: 'running' } as Job] };
    const { service } = setUp(world);
    expect((await service.overview(false)).cleanupBlockedBy).toMatch(/Back up now is running/);
    await expect(service.clean('temporary-files')).rejects.toMatchObject({ error: { code: 'storage.busy' } });
    expect(existsSync(join(paths.temporary, 'wallet-restore-1.dat'))).toBe(true);
    // The measurement is reused, but whether a job is running never is.
    world.jobs = [];
    expect((await service.overview(false)).cleanupBlockedBy).toBeNull();
  });

  it('forecasts when a node’s disk fills up from the measured growth of its block files', async () => {
    const { service } = setUp({
      nodeSize: [
        { daysAgo: 3, bytes: 700 * GB },
        { daysAgo: 2, bytes: 701 * GB },
        { daysAgo: 1, bytes: 702 * GB },
        { daysAgo: 0, bytes: 703 * GB },
      ],
    });
    const [forecast] = (await service.overview(false)).forecasts;
    expect(forecast).toMatchObject({ nodeId: 'n1', name: 'Main node', measuredDays: 3 });
    expect(forecast?.growthBytesPerDay).toBeCloseTo(GB, -3);
    expect(forecast?.daysUntilFull).toBeCloseTo(100, 3);
  });

  it('does not extrapolate less than a day of measurements', async () => {
    const { service } = setUp({
      nodeSize: [
        { daysAgo: 0.5, bytes: 10 },
        { daysAgo: 0, bytes: 20 },
      ],
    });
    expect((await service.overview(false)).forecasts).toEqual([]);
    expect(growthPerDay([])).toEqual({ perDay: 0, days: 0 });
  });

  it('shows the WSL2 and Docker Desktop disks it found as read-only, with nothing to clean up', async () => {
    const { service } = setUp({
      virtualDisks: [
        { name: 'docker-desktop data', owner: 'docker', path: 'D:\\Docker\\disk\\docker_data.vhdx', bytes: 60 * GB },
        { name: 'Ubuntu', owner: 'wsl', path: 'C:\\WSL\\Ubuntu\\ext4.vhdx', bytes: 8 * GB },
      ],
    });
    const usage = await service.overview(false);
    expect(usage.folders.find((folder) => folder.owner === 'docker')).toMatchObject({
      ownerName: 'Docker Desktop (docker-desktop data)',
      bytes: 60 * GB,
      readOnly: true,
      route: null,
      cleanup: null,
    });
    expect(usage.folders.find((folder) => folder.owner === 'wsl')).toMatchObject({
      ownerName: 'WSL2: Ubuntu',
      readOnly: true,
    });
  });
});

describe('virtual disks of other programs', () => {
  it('looks where WSL registered each distribution and where Docker Desktop keeps its data disk', () => {
    const candidates = virtualDiskCandidates(
      [
        {
          name: 'Ubuntu',
          basePath: '\\\\?\\C:\\Users\\Ann\\AppData\\Local\\Packages\\Ubuntu\\LocalState',
          diskFile: null,
        },
        { name: 'docker-desktop', basePath: 'D:\\Docker\\DockerDesktopWSL\\main', diskFile: 'ext4.vhdx' },
        { name: 'docker-desktop-data', basePath: 'C:\\Users\\Ann\\AppData\\Local\\Docker\\wsl\\data', diskFile: null },
      ],
      'C:\\Users\\Ann\\AppData\\Local',
    );
    expect(candidates).toEqual([
      {
        name: 'Ubuntu',
        owner: 'wsl',
        path: join('C:\\Users\\Ann\\AppData\\Local\\Packages\\Ubuntu\\LocalState', 'ext4.vhdx'),
      },
      { name: 'docker-desktop', owner: 'docker', path: join('D:\\Docker\\DockerDesktopWSL\\main', 'ext4.vhdx') },
      {
        name: 'docker-desktop data',
        owner: 'docker',
        path: join('D:\\Docker\\DockerDesktopWSL', 'disk', 'docker_data.vhdx'),
      },
      {
        name: 'docker-desktop-data',
        owner: 'docker',
        path: join('C:\\Users\\Ann\\AppData\\Local\\Docker\\wsl\\data', 'ext4.vhdx'),
      },
      {
        name: 'docker-desktop data',
        owner: 'docker',
        path: join('C:\\Users\\Ann\\AppData\\Local', 'Docker', 'wsl', 'disk', 'docker_data.vhdx'),
      },
    ]);
  });

  it('lists a disk once when Docker Desktop is in its usual place', () => {
    const candidates = virtualDiskCandidates(
      [{ name: 'docker-desktop', basePath: 'C:\\Users\\Ann\\AppData\\Local\\Docker\\wsl\\main', diskFile: null }],
      'C:\\Users\\Ann\\AppData\\Local',
    );
    expect(candidates.map((candidate) => candidate.name)).toEqual(['docker-desktop', 'docker-desktop data']);
  });
});
