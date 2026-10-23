import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitcoinRpcClient, cookieCredentials } from '@btcortex/bitcoin-rpc';
import type { Job, NodeProfile } from '@btcortex/contracts';
import { configFilePath } from '@btcortex/integration-bitcoin-core';
import { listInstalledKnots, versionCheckArguments } from '@btcortex/integration-bitcoin-knots';
import { JobManager } from '../../apps/orchestrator/src/jobs/job-manager';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { ensureAppDirectories, resolveAppPaths } from '../../apps/orchestrator/src/platform/paths';
import { SetupService } from '../../apps/orchestrator/src/setup/setup-service';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import { removeTestRoot, shutDownNodeManager, TEST_ENV_RUNTIMES } from './support/regtest-node';

// A Bitcoin Knots node BTCortex sets up, end to end, on regtest: the verified
// runtime installed by scripts/dev/install-bitcoin-knots.ts, the set-up
// refusing without the user's agreement to Knots' chain, and the node started
// from Knots' own runtime folder and recognised as Knots by what it reports.

const KNOTS_RUNTIMES = resolve(import.meta.dirname, '..', '..', '.test-env', 'bitcoin-knots', 'runtimes');
const runtime = (await listInstalledKnots(KNOTS_RUNTIMES))[0];
const execFileAsync = promisify(execFile);

/** The roaming application data folder, where Bitcoin Core and Knots keep their default data directory. */
function homeAppData(): string {
  return process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
}

async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Condition not met in time; last value: ${JSON.stringify(value)}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
}

describe.skipIf(!runtime)('A Bitcoin Knots node set up by BTCortex (real Knots on regtest)', () => {
  let root: string;
  let database: DatabaseSync;
  let nodes: NodeManager;
  let jobs: JobManager;
  let setup: SetupService;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-knots-'));
    const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: root });
    ensureAppDirectories(paths);
    const logger = new StructuredLogger([new MemorySink(5000)], 'debug');
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
      knotsRuntimesDirectory: KNOTS_RUNTIMES,
      publish: () => undefined,
      logger,
    });
    jobs = new JobManager({ database, publish: () => undefined, logger });
    // GitHub's answer for the latest Knots release; the runtime itself is already installed and verified.
    const fetchLatest: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: `v${runtime?.version ?? ''}` })));
    setup = new SetupService({
      paths,
      repository,
      nodes,
      jobs,
      logger,
      runtimesDirectory: TEST_ENV_RUNTIMES,
      knotsRuntimesDirectory: KNOTS_RUNTIMES,
      fetch: fetchLatest,
    });
  });

  afterAll(async () => {
    await shutDownNodeManager(nodes);
    database.close();
    removeTestRoot(root);
  }, 60_000);

  it('checks the version of the extracted bitcoind without writing to any data directory', async () => {
    // bitcoind writes settings.json into its data directory even for -version; the default one is the user's.
    const scratch = mkdtempSync(join(tmpdir(), 'btcortex-knots-version-test-'));
    const before = statSync(join(homeAppData(), 'Bitcoin'), { throwIfNoEntry: false })?.mtimeMs;
    try {
      const { stdout } = await execFileAsync(runtime?.bitcoind ?? '', versionCheckArguments(scratch), {
        windowsHide: true,
      });
      expect(stdout).toContain(`Bitcoin Knots daemon version v${runtime?.version ?? ''}`);
      expect(readdirSync(scratch)).toEqual([]);
      expect(statSync(join(homeAppData(), 'Bitcoin'), { throwIfNoEntry: false })?.mtimeMs).toBe(before);
    } finally {
      removeTestRoot(scratch);
    }
  });

  it('plans Knots with the agreement its chain needs, and without an Electrum server', async () => {
    expect(await setup.plan('regtest', 'general', 'bitcoin-knots')).toMatchObject({
      implementation: 'bitcoin-knots',
      differentChain: true,
      version: runtime?.version,
      feasible: true,
    });
    const withElectrum = await setup.plan('regtest', 'electrum-backend', 'bitcoin-knots');
    expect(withElectrum.feasible).toBe(false);
    expect(withElectrum.blockers.join(' ')).toMatch(/Electrum servers for Bitcoin Core nodes only/);
    // Bitcoin Core is planned as before.
    expect(await setup.plan('regtest', 'general')).toMatchObject({
      implementation: 'bitcoin-core',
      differentChain: false,
    });
  }, 60_000);

  it('refuses to set up Knots without the user’s agreement', () => {
    expect(() => setup.start('Knots', 'regtest', 'general', { implementation: 'bitcoin-knots' })).toThrow(
      /follows a chain Bitcoin Core rejects/,
    );
    expect(() =>
      setup.start('Knots', 'regtest', 'electrum-backend', {
        implementation: 'bitcoin-knots',
        acceptDifferentChain: true,
      }),
    ).toThrow(/Electrum servers for Bitcoin Core nodes only/);
  });

  it('sets up a Knots node from its own runtime, marks its data as Knots and recognises it as Knots', async () => {
    const jobId = setup.start('Knots regtest', 'regtest', 'general', {
      implementation: 'bitcoin-knots',
      acceptDifferentChain: true,
    });
    const job = await until<Job>(
      () => jobs.get(jobId),
      (candidate) => candidate.state === 'succeeded' || candidate.state === 'failed',
      180_000,
    );
    expect(job.error).toBeUndefined();
    expect(job.kind).toBe('bitcoin-knots.setup');
    const profile: NodeProfile = nodes.get(job.result?.nodeId ?? '').profile;
    expect(profile).toMatchObject({ implementation: 'bitcoin-knots', runtimeVersion: runtime?.version });
    await until(
      () => nodes.get(profile.id).status.state,
      (state) => state === 'running',
    );

    const client = new BitcoinRpcClient({
      endpoint: profile.rpcEndpoint,
      credentials: cookieCredentials(join(profile.dataDirectory ?? '', 'regtest', '.cookie')),
    });
    const info = await client.getNetworkInfo();
    expect(info.subversion).toMatch(/\/Satoshi:[\d.]+\/Knots:\d{8}\//);
    expect(nodes.get(profile.id).status.snapshot?.network.subversion).toMatch(/Knots/);
    const text = readFileSync(configFilePath(profile.dataDirectory ?? ''), 'utf8');
    expect(text).toContain('Never start Bitcoin Core on this directory.');
    expect(text).toMatch(/^chain=regtest$/m);
  }, 240_000);
});
