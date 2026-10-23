import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job, NodeProfile, NodeWithStatus } from '@btcortex/contracts';
import { VERIFICATION_RECORD_FILE } from '@btcortex/installation-manager';
import { JobManager } from '../jobs/job-manager';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { openDatabase } from '../persistence/database';
import { migrations } from '../persistence/migrations';
import { ensureAppDirectories, resolveAppPaths } from '../platform/paths';
import { coreTargetFor, SparrowService } from './sparrow-service';

const VERSION = '2.5.5';
const NO_CONSENT = { replaceExistingServer: false, resetStartupNetwork: false };
const logger = new StructuredLogger([new MemorySink()], 'debug');

const profile: NodeProfile = {
  id: 'node-1',
  name: 'Home node',
  implementation: 'bitcoin-core',
  network: 'mainnet',
  execution: 'managed',
  runtimeVersion: '31.1',
  dataDirectory: 'C:\\BTCortex\\nodes\\mainnet-1',
  rpcEndpoint: 'http://127.0.0.1:8332',
  authentication: { kind: 'cookie', cookieFile: 'C:\\BTCortex\\nodes\\mainnet-1\\.cookie' },
  keepRunningOnExit: false,
  startWithBtcortex: false,
  createdAt: '2026-10-21T08:00:00.000Z',
  updatedAt: '2026-10-21T08:00:00.000Z',
};

let root: string;
let appData: string;
let database: DatabaseSync;
let running: boolean;
let launches: { executable: string; network: string }[];
let service: SparrowService;
let jobs: JobManager;
let electrumReady: boolean;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'btcortex-sparrow-service-'));
  appData = join(root, 'AppData', 'Roaming');
  const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: join(root, 'BTCortex') });
  ensureAppDirectories(paths);
  // A Sparrow BTCortex verified earlier, so no download happens.
  const installed = join(paths.installations, 'sparrow', VERSION);
  mkdirSync(join(installed, 'Sparrow'), { recursive: true });
  writeFileSync(join(installed, 'Sparrow', 'Sparrow.exe'), 'not a real executable');
  writeFileSync(join(installed, VERIFICATION_RECORD_FILE), JSON.stringify({ verifiedAt: '2026-10-21T09:00:00.000Z' }));

  database = openDatabase({ file: paths.database, migrations, logger });
  jobs = new JobManager({ database, publish: () => undefined, logger });
  running = false;
  electrumReady = true;
  launches = [];
  const node: NodeWithStatus = {
    profile,
    status: { nodeId: profile.id, state: 'running', checkedAt: '2026-10-21T10:00:00.000Z' },
  };
  service = new SparrowService({
    paths,
    nodes: { get: () => node },
    jobs,
    logger,
    env: { APPDATA: appData },
    fetch: () => Promise.resolve(new Response(JSON.stringify({ tag_name: VERSION, prerelease: false, draft: false }))),
    isRunning: () => Promise.resolve(running),
    launch: (executable, network) => launches.push({ executable, network }),
    electrumUrl: (nodeId) => (electrumReady && nodeId === profile.id ? 'tcp://127.0.0.1:50001' : undefined),
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

const configPath = () => join(appData, 'Sparrow', 'config');

describe('SparrowService', () => {
  it('points Sparrow at the node with cookie authentication and opens it', async () => {
    const job = await finished(service.connect(profile.id, NO_CONSENT));
    expect(job.error).toBeUndefined();
    expect(JSON.parse(readFileSync(configPath(), 'utf8'))).toEqual({
      mode: 'ONLINE',
      serverType: 'BITCOIN_CORE',
      coreServer: 'http://127.0.0.1:8332',
      coreAuthType: 'COOKIE',
      coreDataDir: 'C:\\BTCortex\\nodes\\mainnet-1',
      useLegacyCoreWallet: false,
    });
    expect(launches).toEqual([{ executable: expect.stringContaining('Sparrow.exe') as string, network: 'mainnet' }]);
    const status = await service.status(profile.id);
    expect(status).toMatchObject({ installed: { version: VERSION }, connection: { usesThisNode: true } });
  });

  it('points Sparrow at the node’s Electrum server instead, once it has one', async () => {
    mkdirSync(join(appData, 'Sparrow'), { recursive: true });
    writeFileSync(
      configPath(),
      JSON.stringify({
        serverType: 'ELECTRUM_SERVER',
        electrumServer: 'ssl://home:50002',
        electrumServerCert: 'C:\\home.crt',
      }),
    );
    // A server the user chose is replaced only with consent, and its certificate goes with it.
    const refused = await finished(service.connect(profile.id, NO_CONSENT, 'electrum'));
    expect(refused.error?.code).toBe('sparrow.other-server');
    const job = await finished(service.connect(profile.id, { ...NO_CONSENT, replaceExistingServer: true }, 'electrum'));
    expect(job.error).toBeUndefined();
    expect(JSON.parse(readFileSync(configPath(), 'utf8'))).toEqual({
      serverType: 'ELECTRUM_SERVER',
      electrumServer: 'tcp://127.0.0.1:50001|BTCortex',
      mode: 'ONLINE',
    });
    expect(await service.status(profile.id, 'electrum')).toMatchObject({ connection: { usesThisNode: true } });
    // Seen from the node's RPC interface, Sparrow now uses another server.
    expect((await service.status(profile.id)).connection.usesThisNode).toBe(false);

    electrumReady = false;
    expect((await service.status(profile.id, 'electrum')).unsupportedReason).toMatch(/no Electrum server yet/);
  });

  it('never replaces a server the user chose without consent, and backs up when it does', async () => {
    mkdirSync(join(appData, 'Sparrow'), { recursive: true });
    writeFileSync(
      configPath(),
      JSON.stringify({ serverType: 'ELECTRUM_SERVER', electrumServer: 'ssl://home:50002', theme: 'DARK' }),
    );

    const refused = await finished(service.connect(profile.id, NO_CONSENT));
    expect(refused.error?.code).toBe('sparrow.other-server');
    expect(JSON.parse(readFileSync(configPath(), 'utf8'))).toMatchObject({ serverType: 'ELECTRUM_SERVER' });
    expect(launches).toEqual([]);

    const replaced = await finished(service.connect(profile.id, { ...NO_CONSENT, replaceExistingServer: true }));
    expect(replaced.state).toBe('succeeded');
    expect(JSON.parse(readFileSync(configPath(), 'utf8'))).toMatchObject({ serverType: 'BITCOIN_CORE', theme: 'DARK' });
    expect(readdirSync(join(appData, 'Sparrow')).some((name) => name.endsWith('.bak'))).toBe(true);
  });

  it('refuses while Sparrow is open', async () => {
    running = true;
    const job = await finished(service.connect(profile.id, NO_CONSENT));
    expect(job.error?.code).toBe('sparrow.running');
    expect(existsSync(configPath())).toBe(false);
  });

  it('sets a fixed start-up network aside only with consent', async () => {
    const home = join(appData, 'Sparrow');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'network-testnet4'), '');
    expect((await service.status(profile.id)).connection).toEqual({
      usesThisNode: false,
      fixedStartupNetworks: ['testnet4'],
    });

    const refused = await finished(service.connect(profile.id, NO_CONSENT));
    expect(refused.error?.code).toBe('sparrow.network-marker');
    expect(existsSync(join(home, 'network-testnet4'))).toBe(true);
    expect(existsSync(configPath())).toBe(false);
    await expect(service.open(profile.id)).rejects.toMatchObject({ error: { code: 'sparrow.network-marker' } });
    expect(launches).toEqual([]);

    const accepted = await finished(service.connect(profile.id, { ...NO_CONSENT, resetStartupNetwork: true }));
    expect(accepted.state).toBe('succeeded');
    expect(existsSync(join(home, 'network-testnet4'))).toBe(false);
    expect(readdirSync(home).some((name) => name.startsWith('network-testnet4.btcortex-'))).toBe(true);
    expect(launches).toHaveLength(1);
    expect((await service.status(profile.id)).connection).toEqual({ usesThisNode: true });
  });
});

describe('coreTargetFor', () => {
  it('derives the root data directory of an external node from its cookie', () => {
    const external: NodeProfile = {
      ...profile,
      execution: 'external',
      network: 'testnet4',
      dataDirectory: null,
      authentication: { kind: 'cookie', cookieFile: 'D:\\Bitcoin\\testnet4\\.cookie' },
    };
    expect(coreTargetFor(external)).toEqual({ rpcEndpoint: profile.rpcEndpoint, dataDirectory: 'D:\\Bitcoin' });
  });

  it('declines nodes that would need a plain-text password in Sparrow', () => {
    const passwordNode: NodeProfile = {
      ...profile,
      authentication: { kind: 'password', username: 'alice', secretId: 's' },
    };
    expect(coreTargetFor(passwordNode)).toHaveProperty('unsupported');
  });
});
