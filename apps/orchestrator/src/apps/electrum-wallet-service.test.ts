import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ElectrumConnection, Job, NodeProfile, NodeWithStatus } from '@btcortex/contracts';
import type { ElectrumRuntime, InstalledElectrum } from '@btcortex/integration-electrum-wallet';
import { JobManager } from '../jobs/job-manager';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { openDatabase } from '../persistence/database';
import { migrations } from '../persistence/migrations';
import { ensureAppDirectories, resolveAppPaths } from '../platform/paths';
import { ElectrumWalletService } from './electrum-wallet-service';

const logger = new StructuredLogger([new MemorySink()], 'debug');

const profile: NodeProfile = {
  id: 'node-1',
  name: 'Home node',
  implementation: 'bitcoin-core',
  network: 'testnet4',
  execution: 'managed',
  runtimeVersion: '31.1',
  dataDirectory: 'C:\\BTCortex\\nodes\\testnet4-1',
  rpcEndpoint: 'http://127.0.0.1:48332',
  authentication: { kind: 'cookie', cookieFile: 'C:\\BTCortex\\nodes\\testnet4-1\\testnet4\\.cookie' },
  keepRunningOnExit: false,
  startWithBtcortex: false,
  createdAt: '2026-10-23T08:00:00.000Z',
  updatedAt: '2026-10-23T08:00:00.000Z',
};
const node: NodeWithStatus = {
  profile,
  status: { nodeId: profile.id, state: 'running', checkedAt: '2026-10-23T09:00:00.000Z' },
};
const connection: ElectrumConnection = {
  host: '127.0.0.1',
  port: 40001,
  protocol: 'tcp',
  server: '127.0.0.1:40001:t',
  url: 'tcp://127.0.0.1:40001',
};

let root: string;
let database: DatabaseSync;
let jobs: JobManager;
let application: InstalledElectrum | undefined;
let server: { connection: ElectrumConnection; ready: boolean } | undefined;
let running: boolean;
let launches: { executable: string; args: readonly string[] }[];
let installs: string[];
let service: ElectrumWalletService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'btcortex-electrum-wallet-'));
  const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: root });
  ensureAppDirectories(paths);
  database = openDatabase({ file: paths.database, migrations, logger });
  jobs = new JobManager({ database, publish: () => undefined, logger });
  application = undefined;
  server = { connection, ready: true };
  running = false;
  launches = [];
  installs = [];
  service = new ElectrumWalletService({
    paths,
    nodes: { get: () => node },
    jobs,
    logger,
    server: () => server,
    latestVersion: () => Promise.resolve('4.8.2'),
    findApplication: () => Promise.resolve(application),
    isRunning: () => Promise.resolve(running),
    launch: (executable, args) => launches.push({ executable, args }),
    // Another Electrum's wallets, which BTCortex's copy must not open.
    electrumDataFolder: () => root,
    install: (version) => {
      installs.push(version);
      return Promise.resolve({
        version,
        directory: join(root, 'electrum', version),
        executable: join(root, 'electrum', version, `electrum-${version}.exe`),
      } as ElectrumRuntime);
    },
  });
});

afterEach(() => {
  database.close();
  rmSync(root, { recursive: true, force: true });
});

async function finished(jobId: string): Promise<Job> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = jobs.get(jobId);
    if (job.state === 'succeeded' || job.state === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The job did not finish.');
}

describe('ElectrumWalletService', () => {
  it('uses the Electrum installed on this computer as it is, and says when it is outdated', async () => {
    application = {
      version: '4.7.2',
      directory: 'C:\\Program Files\\Electrum',
      executable: 'C:\\Program Files\\Electrum\\electrum-4.7.2.exe',
    };
    expect(await service.status(profile.id)).toMatchObject({
      opens: 'application',
      application: { version: '4.7.2' },
      latest: '4.8.2',
      applicationOutdated: true,
      server: '127.0.0.1:40001:t',
    });
    const job = await finished(service.open(profile.id));
    expect(job.error).toBeUndefined();
    expect(installs).toEqual([]);
    expect(launches).toEqual([
      {
        executable: 'C:\\Program Files\\Electrum\\electrum-4.7.2.exe',
        args: ['--testnet4', '--oneserver', '--server', '127.0.0.1:40001:t'],
      },
    ]);
  });

  it('installs a verified Electrum when none is on this computer, then opens it in a wallets folder of its own', async () => {
    expect(await service.status(profile.id)).toMatchObject({
      opens: 'install',
      ownWalletsFolder: join(root, 'electrum-wallets'),
      otherElectrumWallets: true,
    });
    const job = await finished(service.open(profile.id));
    expect(job.error).toBeUndefined();
    expect(installs).toEqual(['4.8.2']);
    expect(launches[0]).toEqual({
      executable: join(root, 'electrum', '4.8.2', 'electrum-4.8.2.exe'),
      args: ['--testnet4', '--dir', join(root, 'electrum-wallets'), '--oneserver', '--server', '127.0.0.1:40001:t'],
    });
  });

  it('waits for the server to be ready, and for Electrum to be closed', async () => {
    server = { connection, ready: false };
    expect((await service.status(profile.id)).unavailableReason).toMatch(/not ready for wallets yet/);
    expect((await finished(service.open(profile.id))).error?.code).toBe('electrum-wallet.unavailable');
    server = { connection, ready: true };
    running = true;
    expect((await finished(service.open(profile.id))).error?.code).toBe('electrum-wallet.running');
    server = undefined;
    expect((await service.status(profile.id)).unavailableReason).toMatch(/no Electrum server yet/);
    expect(launches).toEqual([]);
  });

  it('never installs a release that needs a newer Electrum protocol than Fulcrum offers', async () => {
    service = new ElectrumWalletService({
      paths: resolveAppPaths({ BTCORTEX_DATA_DIR: root }),
      nodes: { get: () => node },
      jobs,
      logger,
      server: () => server,
      latestVersion: () => Promise.resolve('4.9.0'),
      findApplication: () => Promise.resolve(undefined),
      isRunning: () => Promise.resolve(false),
      launch: (executable, args) => launches.push({ executable, args }),
    });
    expect((await finished(service.open(profile.id))).error?.code).toBe('electrum-wallet.incompatible');
    expect(launches).toEqual([]);
  });
});
