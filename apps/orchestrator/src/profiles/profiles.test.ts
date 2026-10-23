import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppFailure } from '@btcortex/contracts';
import type {
  AppError,
  DeploymentChoices,
  ElectrumServerStatus,
  HardwareOverview,
  HardwareSummary,
  InstalledSoftware,
  Job,
  NodeWithStatus,
} from '@btcortex/contracts';
import { JobManager } from '../jobs/job-manager';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { openDatabase } from '../persistence/database';
import { migrations } from '../persistence/migrations';
import { SettingsStore } from '../persistence/settings';
import { ProfileService } from './profile-service';
import { ReleaseSizes } from './releases';
import type { InstallableComponent } from './releases';

const GB = 1_000_000_000;
const GIB = 1024 ** 3;
let root: string;
let database: DatabaseSync;
let jobs: JobManager;
const logger = new StructuredLogger([new MemorySink()], 'debug');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'btcortex-profiles-'));
  database = openDatabase({ file: join(root, 'test.db'), migrations, logger });
  jobs = new JobManager({ database, publish: () => undefined, logger });
});

afterEach(() => {
  database.close();
  rmSync(root, { recursive: true, force: true });
});

const describeError = (error: unknown): AppError =>
  error instanceof AppFailure
    ? error.error
    : { code: 'test.failed', message: String(error), component: 'Test', dataRisk: 'none', recoveryActions: [] };

function hardware(freeBytes: number): HardwareSummary {
  return {
    totalMemoryBytes: 16 * GIB,
    availableMemoryBytes: 12 * GIB,
    freeDiskBytes: freeBytes,
    volumeBytes: freeBytes * 2,
    logicalProcessors: 8,
    volumePath: 'D:\\',
  };
}

function existingNode(options: { managed?: boolean; network?: string; version?: number } = {}): NodeWithStatus {
  return {
    profile: {
      id: 'old-1',
      name: 'Old node',
      implementation: 'bitcoin-core',
      network: options.network ?? 'mainnet',
      execution: options.managed === false ? 'external' : 'managed',
      runtimeVersion: '31.1',
      dataDirectory: 'D:\\Bitcoin',
      authentication: { kind: 'cookie', cookieFile: 'D:\\Bitcoin\\.cookie' },
    },
    status: {
      nodeId: 'old-1',
      state: 'running',
      checkedAt: '2026-10-23T08:00:00.000Z',
      snapshot: { blockchain: { pruned: false }, network: { version: options.version ?? 310100 } },
    },
  } as unknown as NodeWithStatus;
}

interface Fakes {
  freeBytes: number;
  installed: InstalledSoftware['product'][];
  nodes: NodeWithStatus[];
  electrumState: ElectrumServerStatus['state'];
  sparrowError?: AppError;
  setupError?: AppError;
}

function setUp(fakes: Fakes) {
  const calls: unknown[][] = [];
  const job = (kind: Job['kind'], name: string, outcome: () => Job['result'] | undefined) =>
    jobs.run(
      kind,
      name,
      async (report) => {
        // Like a real job, it reports once it is under way.
        await new Promise((resolve) => setTimeout(resolve, 0));
        report({ stage: 'working', message: `${name} is working`, fraction: 0.5 });
        return outcome();
      },
      describeError,
    ).id;
  const service = new ProfileService({
    settings: new SettingsStore(database),
    jobs,
    logger,
    paths: { nodes: join(root, 'nodes') },
    nodes: { list: () => fakes.nodes },
    setup: {
      start: (name, network, usage, options) => {
        calls.push(['setup', name, network, usage, options]);
        return job('bitcoin-core.setup', 'Set up Bitcoin Core', () => {
          if (fakes.setupError) throw new AppFailure(fakes.setupError);
          return { nodeId: 'new-1' };
        });
      },
    },
    tor: {
      install: () => {
        calls.push(['tor.install']);
        return job('tor.install', 'Install tor', () => undefined);
      },
      ensureRunning: () => {
        calls.push(['tor.start']);
        return Promise.resolve();
      },
    },
    privacy: {
      configure: (nodeId, change) => {
        calls.push(['privacy', nodeId, change]);
        return Promise.resolve({ changedKeys: ['onlynet'], restarting: true });
      },
    },
    electrum: {
      status: () => ({ state: fakes.electrumState }) as ElectrumServerStatus,
      plan: (nodeId) =>
        Promise.resolve({
          nodeId,
          dataDirectory: 'D:\\Bitcoin-electrum',
          volume: null,
          indexBytesEstimate: 250 * GB,
          transactionIndexBytesEstimate: 80 * GB,
          nodeChanges: [],
          restartsNode: true,
          installsFulcrum: true,
          blockers: [],
          warnings: [{ code: 'transaction-index', message: 'Bitcoin Core first builds its transaction index.' }],
        }),
      setUpForNewNode: (nodeId) => {
        calls.push(['electrum', nodeId]);
        return job('electrum.setup', 'Set up an Electrum server', () => ({ nodeId }));
      },
    },
    sparrow: {
      connect: (nodeId, consent, via) => {
        calls.push(['sparrow', nodeId, consent, via]);
        return job('sparrow.connect', 'Connect Sparrow', () => {
          if (fakes.sparrowError) throw new AppFailure(fakes.sparrowError);
          return { nodeId };
        });
      },
    },
    hardware: {
      overview: () =>
        Promise.resolve({
          trezorSuite: { installed: null, running: false, holdsDevice: false },
        } as unknown as HardwareOverview),
      installHwi: () => {
        calls.push(['hwi']);
        return job('hwi.install', 'Install HWI', () => undefined);
      },
      installTrezorSuite: () => {
        calls.push(['trezor-suite']);
        return job('trezor-suite.install', 'Install Trezor Suite', () => undefined);
      },
    },
    installedSoftware: () =>
      Promise.resolve(
        fakes.installed.map(
          (product) => ({ product, version: product === 'bitcoin-core' ? '31.1' : '1.0' }) as InstalledSoftware,
        ),
      ),
    releases: {
      lookup: (component: InstallableComponent) =>
        Promise.resolve({ version: component === 'bitcoin-core' ? '31.1' : '2.0.0', bytes: 50_000_000 }),
    },
    describeHardware: () => Promise.resolve(hardware(fakes.freeBytes)),
    diskKind: () => Promise.resolve('ssd'),
    now: () => new Date('2026-10-23T08:00:00.000Z'),
  });
  return { service, calls };
}

const NEW_NODE = { kind: 'new', name: 'Home node' } as const;

function choices(overrides: Partial<DeploymentChoices>): DeploymentChoices {
  return { profileId: 'basic-node', network: 'mainnet', components: [], target: NEW_NODE, ...overrides };
}

describe('deployment plans', () => {
  it('works out what a private wallet set-up needs on a large disk', async () => {
    const { service } = setUp({
      freeBytes: 2000 * GB,
      installed: ['bitcoin-core'],
      nodes: [],
      electrumState: 'not-set-up',
    });
    const plan = await service.plan(choices({ profileId: 'private-wallet' }));
    expect(plan.feasible).toBe(true);
    expect(plan.steps.map((step) => [step.component, step.state])).toEqual([
      ['bitcoin-core', 'to-do'],
      ['electrum-server', 'to-do'],
      ['sparrow', 'to-do'],
      ['monitoring', 'built-in'],
      ['backups', 'later'],
    ]);
    // Bitcoin Core 31.1 is installed already, so only Fulcrum and Sparrow are downloaded.
    expect(plan.downloads.map((download) => [download.name, download.version, download.bytes])).toEqual([
      ['Fulcrum (Electrum server)', '2.0.0', 50_000_000],
      ['Sparrow', '2.0.0', 50_000_000],
    ]);
    expect(plan.storage.items.map((item) => item.label)).toEqual([
      'Blocks',
      'Chain state',
      'Bitcoin Core’s transaction index',
      'Electrum server index',
      'Programs, settings and logs',
    ]);
    expect(plan.memory.items.map((item) => item.label)).toEqual([
      'Bitcoin Core’s database cache (dbcache)',
      'Bitcoin Core’s mempool (maxmempool)',
      'Fulcrum’s database cache (db_mem)',
      'Windows, BTCortex and other programs (allowance)',
    ]);
    expect(plan.ports.map((port) => [port.port, port.reach])).toEqual([
      [8332, 'this-computer'],
      [8333, 'nobody'],
      [50001, 'this-computer'],
      [50100, 'this-computer'],
    ]);
    expect(plan.processors).toEqual({ logical: 8, recommended: 4 });
    expect(plan.privacy).toContain(
      'Wallets ask your own Electrum server about their addresses instead of public servers, which would learn them.',
    );
    expect(plan.needsDockerOrWsl2).toBe(false);
  });

  it('refuses an Electrum server when the whole chain does not fit, and offers a pruned basic node instead', async () => {
    const { service } = setUp({ freeBytes: 300 * GB, installed: [], nodes: [], electrumState: 'not-set-up' });
    const wallet = await service.plan(choices({ profileId: 'private-wallet' }));
    expect(wallet.feasible).toBe(false);
    expect(wallet.blockers.join(' ')).toMatch(/An Electrum server needs the complete Mainnet blockchain/);
    const basic = await service.plan(choices({ profileId: 'basic-node' }));
    expect(basic.feasible).toBe(true);
    expect(basic.storage.items[0]?.label).toBe('Recent blocks');
    expect(basic.warnings.join(' ')).toMatch(/Pruning keeps only recent blocks/);
    expect(basic.downloads.map((download) => download.name)).toEqual(['Bitcoin Core']);
  });

  it('builds on an existing node only where BTCortex may change it', async () => {
    const external = setUp({
      freeBytes: 2000 * GB,
      installed: [],
      nodes: [existingNode({ managed: false })],
      electrumState: 'not-set-up',
    });
    const privacy = await external.service.plan(
      choices({ profileId: 'privacy-node', target: { kind: 'existing', nodeId: 'old-1' } }),
    );
    expect(privacy.blockers).toContain(
      'BTCortex routes through Tor only nodes it set up; Old node was set up outside BTCortex.',
    );
    const elsewhere = await external.service.plan(
      choices({ profileId: 'explorer', network: 'signet', target: { kind: 'existing', nodeId: 'old-1' } }),
    );
    expect(elsewhere.blockers).toContain('Old node runs on Mainnet, not on Signet.');
    expect(elsewhere.steps[0]).toMatchObject({ component: 'bitcoin-core', state: 'already-done' });
    expect(elsewhere.storage.items.map((item) => item.label)).toEqual([
      'Electrum server index',
      'Bitcoin Core’s transaction index',
      'Programs, settings and logs',
    ]);
    expect(elsewhere.warnings).toContain('Bitcoin Core first builds its transaction index.');

    const gone = await external.service.plan(choices({ target: { kind: 'existing', nodeId: 'nope' } }));
    expect(gone.blockers).toContain('The chosen node is no longer in BTCortex.');
  });

  it('shows Tor’s ports and implications only when Tor is included', async () => {
    const { service } = setUp({ freeBytes: 2000 * GB, installed: [], nodes: [], electrumState: 'not-set-up' });
    const plain = await service.plan(choices({ profileId: 'basic-node' }));
    expect(plain.steps.some((step) => step.component === 'tor')).toBe(false);
    const withTor = await service.plan(
      choices({
        profileId: 'basic-node',
        components: ['tor'],
        tor: { mode: 'tor-only', onionService: true, privateBroadcast: true },
      }),
    );
    expect(withTor.steps.find((step) => step.component === 'tor')?.detail).toMatch(
      /Installs tor after checking its signature and starts it, then gives the node connections through Tor only, an onion service and private broadcasting/,
    );
    expect(withTor.ports.filter((port) => port.reach === 'tor').map((port) => port.port)).toEqual([8334]);
    expect(withTor.privacy[0]).toMatch(/connects only through Tor/);
  });

  it('marks the Lightning and merchant profiles as not deployable, saying why', async () => {
    const { service } = setUp({ freeBytes: 2000 * GB, installed: [], nodes: [], electrumState: 'not-set-up' });
    const overview = service.overview();
    expect(overview.profiles.map((profile) => `${profile.letter}:${String(profile.available)}`)).toEqual([
      'A:true',
      'B:true',
      'C:true',
      'D:true',
      'E:false',
      'F:false',
      'G:true',
      'H:true',
    ]);
    const merchant = await service.plan(choices({ profileId: 'merchant' }));
    expect(merchant.feasible).toBe(false);
    expect(merchant.needsDockerOrWsl2).toBe(true);
    expect(merchant.blockers[0]).toMatch(/BTCPay Server runs on Linux/);
  });
});

describe('deploying a profile', () => {
  it('sets up the node, then its Electrum server, then Sparrow, and records what needs the user', async () => {
    const { service, calls } = setUp({
      freeBytes: 2000 * GB,
      installed: [],
      nodes: [],
      electrumState: 'not-set-up',
      sparrowError: {
        code: 'sparrow.other-server',
        message: 'Sparrow uses a server you chose; agree to replace it on the node’s page.',
        component: 'Sparrow',
        dataRisk: 'none',
        recoveryActions: [],
      },
    });
    const { jobId, deploymentId } = await service.deploy(choices({ profileId: 'private-wallet', components: ['hwi'] }));
    const progress: string[] = [];
    const finished = await jobs.waitFor(jobId, (job) => progress.push(job.progress.message));
    expect(finished.state).toBe('succeeded');
    expect(finished.result).toEqual({ nodeId: 'new-1' });
    expect(calls).toEqual([
      ['setup', 'Home node', 'mainnet', 'electrum-backend', { electrumServerAfterwards: false }],
      ['electrum', 'new-1'],
      ['sparrow', 'new-1', { replaceExistingServer: false, resetStartupNetwork: false }, 'electrum'],
      ['hwi'],
    ]);
    expect(progress).toContain('Set up Home node: Set up Bitcoin Core is working');
    const record = service.overview().deployments[0];
    expect(record?.id).toBe(deploymentId);
    expect(record?.nodeId).toBe('new-1');
    expect(record?.finishedAt).toBe('2026-10-23T08:00:00.000Z');
    expect(record?.steps.map((step) => [step.component, step.state, step.route])).toEqual([
      ['bitcoin-core', 'done', '/nodes/new-1'],
      ['electrum-server', 'done', '/electrum'],
      ['sparrow', 'needs-attention', '/electrum'],
      ['hwi', 'done', '/hardware'],
      ['monitoring', 'done', '/monitoring'],
      ['backups', 'needs-attention', '/backups'],
    ]);
  });

  it('routes the node through Tor after installing tor, with the user’s choices', async () => {
    const { service, calls } = setUp({ freeBytes: 2000 * GB, installed: [], nodes: [], electrumState: 'not-set-up' });
    const tor = { mode: 'all-traffic', onionService: false, privateBroadcast: true } as const;
    const { jobId } = await service.deploy(choices({ profileId: 'privacy-node', tor }));
    expect((await jobs.waitFor(jobId)).state).toBe('succeeded');
    expect(calls.slice(1)).toEqual([['tor.install'], ['tor.start'], ['privacy', 'new-1', tor]]);
    expect(service.overview().deployments[0]?.steps.find((step) => step.component === 'tor')?.state).toBe('done');
  });

  it('stops when the node cannot be set up, and refuses a second deployment while one runs', async () => {
    const { service, calls } = setUp({
      freeBytes: 2000 * GB,
      installed: [],
      nodes: [],
      electrumState: 'not-set-up',
      setupError: {
        code: 'bitcoin-core.verification-failed',
        message: 'The download did not match its signatures.',
        component: 'Bitcoin Core set-up',
        dataRisk: 'none',
        recoveryActions: [],
      },
    });
    const { jobId } = await service.deploy(choices({ profileId: 'explorer' }));
    await expect(service.deploy(choices({ profileId: 'basic-node' }))).rejects.toThrow(/already running/);
    const finished = await jobs.waitFor(jobId);
    expect(finished.state).toBe('failed');
    expect(finished.error?.message).toBe('The download did not match its signatures.');
    expect(calls).toHaveLength(1);
    expect(service.overview().deployments[0]?.steps.map((step) => step.state)).toEqual([
      'failed',
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ]);
  });

  it('refuses a plan that cannot be carried out', async () => {
    const { service } = setUp({ freeBytes: 2000 * GB, installed: [], nodes: [], electrumState: 'not-set-up' });
    await expect(service.deploy(choices({ profileId: 'lightning' }))).rejects.toThrow(
      /does not install or run one yet/,
    );
  });

  it('marks a deployment left unfinished by a previous session as interrupted', () => {
    const settings = new SettingsStore(database);
    const failedJob = jobs.run('profile.deploy', 'Deploy', () => Promise.reject(new Error('closed')), describeError);
    settings.set('profiles', {
      deployments: [
        {
          id: 'd1',
          jobId: failedJob.id,
          profileId: 'basic-node',
          network: 'mainnet',
          nodeId: null,
          nodeName: 'Home node',
          startedAt: '2026-10-22T08:00:00.000Z',
          finishedAt: null,
          steps: [
            { component: 'bitcoin-core', title: 'Set up Home node', state: 'running', message: null, route: null },
          ],
        },
      ],
    });
    return jobs.waitFor(failedJob.id).then(() => {
      const { service } = setUp({ freeBytes: 2000 * GB, installed: [], nodes: [], electrumState: 'not-set-up' });
      service.initialise();
      expect(service.overview().deployments[0]).toMatchObject({
        finishedAt: '2026-10-23T08:00:00.000Z',
        steps: [{ state: 'failed', message: 'Interrupted when BTCortex closed. Deploy the profile again to finish.' }],
      });
    });
  });
});

describe('release sizes', () => {
  it('asks for the release and its archive’s size once an hour, and again after a failure', async () => {
    let clock = 0;
    let online = false;
    const requests: string[] = [];
    const fakeFetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      if (!online) return Promise.reject(new Error('offline'));
      if (url.includes('api.github.com')) {
        return Promise.resolve(new Response(JSON.stringify({ tag_name: '2.3.1', prerelease: false, draft: false })));
      }
      return Promise.resolve(new Response(null, { status: 200, headers: { 'content-length': '104857600' } }));
    }) as typeof fetch;
    const sizes = new ReleaseSizes(fakeFetch, () => clock);
    expect(await sizes.lookup('sparrow')).toEqual({ version: null, bytes: null });
    online = true;
    expect(await sizes.lookup('sparrow')).toEqual({ version: '2.3.1', bytes: 104_857_600 });
    expect(requests.at(-1)).toBe(
      'HEAD https://github.com/sparrowwallet/sparrow/releases/download/2.3.1/Sparrow-2.3.1.zip',
    );
    const asked = requests.length;
    clock += 30 * 60 * 1000;
    await sizes.lookup('sparrow');
    expect(requests).toHaveLength(asked);
    clock += 31 * 60 * 1000;
    await sizes.lookup('sparrow');
    expect(requests.length).toBeGreaterThan(asked);
  });
});

describe('waiting for a job', () => {
  it('passes the progress on and resolves once the job has finished', async () => {
    let finish: (() => void) | undefined;
    const job = jobs.run(
      'tor.install',
      'Install tor',
      async (report) => {
        report({ stage: 'downloading', message: 'Downloading', fraction: 0.4 });
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return undefined;
      },
      describeError,
    );
    const seen: string[] = [];
    const waiting = jobs.waitFor(job.id, (update) => seen.push(`${update.state}:${update.progress.message}`));
    await new Promise((resolve) => setTimeout(resolve, 10));
    finish?.();
    expect((await waiting).state).toBe('succeeded');
    expect(seen).toContain('succeeded:Downloading');
    // A finished job resolves at once.
    expect((await jobs.waitFor(job.id)).state).toBe('succeeded');
  });
});
