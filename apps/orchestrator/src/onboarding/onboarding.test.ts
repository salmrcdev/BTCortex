import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DetectionReport, EnvironmentCheck } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { openDatabase } from '../persistence/database';
import { migrations } from '../persistence/migrations';
import { SettingsStore } from '../persistence/settings';
import { inspectEnvironment, RELEASE_SERVERS } from './environment';
import type { EnvironmentProbes, WindowsFacts } from './environment';
import { OnboardingService } from './onboarding-service';

const GB = 1000 ** 3;
const GIB = 1024 ** 3;
const logger = new StructuredLogger([new MemorySink()], 'debug');
const NOW = new Date('2026-10-23T09:00:00.000Z');

function probes(world: {
  release?: string;
  freeBytes?: number;
  volumeBytes?: number;
  memoryBytes?: number;
  bitcoinCore?: DetectionReport;
  connectable?: number;
  paths?: string[];
  windows?: Partial<WindowsFacts>;
  unreachable?: string[];
  wsl?: 'available' | 'not-installed' | 'unknown';
}): EnvironmentProbes & { inspections: () => number } {
  let inspections = 0;
  return {
    dataDirectory: 'C:\\Users\\Ada\\AppData\\Local\\BTCortex\\nodes',
    btcortexRoot: 'C:\\Users\\Ada\\AppData\\Local\\BTCortex',
    osRelease: () => world.release ?? '10.0.26100',
    architecture: () => 'x64',
    processor: () => 'Test CPU',
    hardware: () => {
      inspections += 1;
      return Promise.resolve({
        totalMemoryBytes: world.memoryBytes ?? 16 * GIB,
        availableMemoryBytes: 8 * GIB,
        freeDiskBytes: world.freeBytes ?? 3000 * GB,
        volumeBytes: world.volumeBytes ?? 4000 * GB,
        logicalProcessors: 8,
        volumePath: 'C:\\',
      });
    },
    bitcoinCore: () => Promise.resolve(world.bitcoinCore ?? { dataDirectories: [], installations: [] }),
    connectableNodes: () => Promise.resolve(world.connectable ?? 0),
    exists: (path) => (world.paths ?? []).includes(path),
    env: {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\Ada',
    },
    wsl: () => Promise.resolve(world.wsl ?? 'not-installed'),
    windows: () =>
      Promise.resolve({ listeners: [], proxy: null, metered: false, docker: 'not-installed', ...world.windows }),
    reachable: (url) => Promise.resolve(!(world.unreachable ?? []).includes(url)),
    inspections: () => inspections,
  };
}

const check = (checks: readonly EnvironmentCheck[], id: string) => checks.find((entry) => entry.id === id);

describe('first-run checks', () => {
  it('finds a computer ready for a private wallet set-up', async () => {
    const report = await inspectEnvironment(probes({}), NOW);
    expect(check(report.checks, 'system.windows')).toMatchObject({
      state: 'ok',
      title: 'Windows 11 24H2 (build 26100)',
    });
    expect(check(report.checks, 'storage.space')).toMatchObject({ state: 'ok', title: '3 TB free on C:\\' });
    expect(check(report.checks, 'software.none')?.state).toBe('ok');
    expect(check(report.checks, 'virtualisation')).toMatchObject({
      state: 'ok',
      title: 'WSL2 not installed; Docker not installed',
    });
    expect(check(report.checks, 'ports')?.state).toBe('ok');
    expect(check(report.checks, 'network.releases')?.state).toBe('ok');
    expect(check(report.checks, 'network.proxy')).toBeUndefined();
    expect(report.software).toEqual([]);
    expect(report.recommendation.profileId).toBe('private-wallet');
  });

  it('reports what is already there and what stands in the way', async () => {
    const report = await inspectEnvironment(
      probes({
        release: '10.0.19045',
        freeBytes: 120 * GB,
        volumeBytes: 256 * GB,
        memoryBytes: 3 * GIB,
        connectable: 1,
        bitcoinCore: {
          dataDirectories: [
            {
              path: 'C:\\Users\\Ada\\AppData\\Roaming\\Bitcoin',
              source: 'roaming-app-data',
              hasConfigFile: true,
              networksWithChainData: ['mainnet'],
              walletFiles: 1,
              nodeRunning: true,
            },
          ],
          installations: [
            { path: 'C:\\Program Files\\Bitcoin', product: 'Bitcoin Core', version: '29.0', source: 'registry' },
          ],
        },
        paths: ['C:\\Program Files\\Electrum', 'C:\\Users\\Ada\\AppData\\Roaming\\Sparrow'],
        windows: {
          listeners: [
            { port: 8332, pid: 4242, owner: 'bitcoind', path: 'C:\\Program Files\\Bitcoin\\daemon\\bitcoind.exe' },
            {
              port: 9050,
              pid: 77,
              owner: 'tor',
              path: 'C:\\Users\\Ada\\AppData\\Local\\BTCortex\\installations\\tor\\15.0.26\\tor\\tor.exe',
            },
          ],
          proxy: 'proxy.example:3128',
          metered: true,
        },
        unreachable: [RELEASE_SERVERS[1] ?? ''],
      }),
      NOW,
    );
    expect(check(report.checks, 'system.windows')).toMatchObject({
      state: 'warning',
      title: 'Windows 10 22H2 (build 19045)',
    });
    expect(check(report.checks, 'system.windows')?.detail).toMatch(/Extended Security Updates/);
    expect(check(report.checks, 'system.hardware')?.state).toBe('warning');
    expect(check(report.checks, 'storage.space')).toMatchObject({ state: 'info' });
    expect(check(report.checks, 'storage.space')?.detail).toMatch(/keep only recent blocks/);
    expect(report.software.map((entry) => entry.name)).toEqual(['Bitcoin Core 29.0', 'Sparrow Wallet', 'Electrum']);
    expect(check(report.checks, 'software.found')?.detail).toMatch(/connect to the node already here/);
    expect(check(report.checks, 'ports')).toMatchObject({
      state: 'info',
      title: '1 of the usual ports is used by other programs',
      detail:
        '8332 (Bitcoin Core RPC (mainnet)) by bitcoind (process 4242); 9050 (Tor SOCKS proxy) by BTCortex’s tor (process 77). BTCortex picks free ports for what it sets up, so this blocks nothing.',
    });
    expect(check(report.checks, 'network.releases')).toMatchObject({
      state: 'warning',
      title: 'github.com does not answer',
    });
    expect(check(report.checks, 'network.proxy')?.detail).toMatch(/proxy\.example:3128/);
    expect(check(report.checks, 'network.metered')?.state).toBe('warning');
    expect(report.connectableNodes).toBe(1);
    expect(report.recommendation.profileId).toBe('basic-node');
  });

  it('says plainly when the disk cannot hold even a pruned node or nothing can be downloaded', async () => {
    const report = await inspectEnvironment(
      probes({ freeBytes: 5 * GB, release: '10.0.17134', unreachable: [...RELEASE_SERVERS] }),
      NOW,
    );
    expect(check(report.checks, 'system.windows')?.state).toBe('problem');
    expect(check(report.checks, 'storage.space')?.state).toBe('problem');
    expect(check(report.checks, 'network.releases')).toMatchObject({
      state: 'problem',
      title: 'No release server answers',
    });
  });
});

describe('first-run guide', () => {
  let root: string;
  let database: DatabaseSync;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-onboarding-'));
    database = openDatabase({ file: join(root, 'test.db'), migrations, logger });
  });

  afterEach(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('opens by itself only until it is finished or something is set up', () => {
    let infrastructure = false;
    const service = new OnboardingService({
      settings: new SettingsStore(database),
      probes: probes({}),
      hasInfrastructure: () => infrastructure,
      logger,
      now: () => NOW,
    });
    expect(service.state()).toEqual({ completedAt: null, mode: null, suggested: true });
    infrastructure = true;
    expect(service.state().suggested).toBe(false);
    infrastructure = false;
    expect(service.complete('beginner')).toEqual({
      completedAt: '2026-10-23T09:00:00.000Z',
      mode: 'beginner',
      suggested: false,
    });
  });

  it('keeps the report for a few minutes unless asked to check again', async () => {
    const world = probes({});
    let now = NOW;
    const service = new OnboardingService({
      settings: new SettingsStore(database),
      probes: world,
      hasInfrastructure: () => false,
      logger,
      now: () => now,
    });
    await service.environment(false);
    await service.environment(false);
    expect(world.inspections()).toBe(1);
    await service.environment(true);
    expect(world.inspections()).toBe(2);
    now = new Date(NOW.getTime() + 6 * 60 * 1000);
    await service.environment(false);
    expect(world.inspections()).toBe(3);
  });
});
