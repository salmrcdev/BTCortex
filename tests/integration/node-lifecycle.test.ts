import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitcoinConfig, effectiveScalar, resolveEffective, validateConfig } from '@btcortex/bitcoin-config';
import { BitcoinRpcClient, cookieCredentials } from '@btcortex/bitcoin-rpc';
import type { Job, NodeLifecycleState, NodeProfile, OrchestratorEvent } from '@btcortex/contracts';
import { configFilePath, readRunningPid, waitForExit } from '@btcortex/integration-bitcoin-core';
import { JobManager } from '../../apps/orchestrator/src/jobs/job-manager';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { NodeConfigService } from '../../apps/orchestrator/src/nodes/config-service';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { PeerService } from '../../apps/orchestrator/src/nodes/peer-service';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { ensureAppDirectories, resolveAppPaths } from '../../apps/orchestrator/src/platform/paths';
import { SetupService } from '../../apps/orchestrator/src/setup/setup-service';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import { findTestBitcoind, removeTestRoot, shutDownNodeManager, TEST_ENV_RUNTIMES } from './support/regtest-node';

// The orchestrator's node layer end to end against a real regtest bitcoind:
// plan → set-up job → configuration → start → monitoring → stop → restart.

const bitcoind = findTestBitcoind();
const version = bitcoind?.match(/runtimes[\\/]([^\\/]+)[\\/]/)?.[1];

async function until<T>(read: () => T, accept: (value: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Condition not met in time; last value: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe.skipIf(!bitcoind || !version)('Node lifecycle through the orchestrator (real bitcoind on regtest)', () => {
  const events: OrchestratorEvent[] = [];
  let root: string;
  let database: DatabaseSync;
  let nodes: NodeManager;
  let jobs: JobManager;
  let setup: SetupService;
  let repository: NodeRepository;
  let profile: NodeProfile;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-lifecycle-'));
    const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: root });
    ensureAppDirectories(paths);
    const logger = new StructuredLogger([new MemorySink()], 'debug');
    database = openDatabase({ file: paths.database, migrations, logger });
    const publish = (event: OrchestratorEvent) => events.push(event);
    const vault = new SecretVault(
      database,
      createShellCaller(() => Promise.reject(new Error('The vault is not needed for cookie authentication.'))),
    );
    repository = new NodeRepository(database);
    nodes = new NodeManager({ repository, vault, runtimesDirectory: TEST_ENV_RUNTIMES, publish, logger });
    jobs = new JobManager({ database, publish, logger });
    // Only the GitHub "latest release" lookup is answered locally; the runtime is already verified on disk.
    const fetchLatest: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: `v${version ?? ''}`, prerelease: false, draft: false })));
    setup = new SetupService({
      paths,
      repository,
      nodes,
      jobs,
      logger,
      runtimesDirectory: TEST_ENV_RUNTIMES,
      fetch: fetchLatest,
    });
  });

  afterAll(async () => {
    await shutDownNodeManager(nodes);
    database.close();
    removeTestRoot(root);
  });

  it('proposes a feasible plan without changing anything', async () => {
    const plan = await setup.plan('regtest', 'general');
    expect(plan.feasible).toBe(true);
    expect(plan.version).toBe(version);
    expect(plan.pruned).toBe(false);
    expect(plan.settings.map((setting) => setting.key)).toEqual(
      expect.arrayContaining(['server', 'dbcache', 'listen']),
    );
    expect(repository.list()).toEqual([]);
  });

  it('runs the set-up job to a running, monitored node', async () => {
    const jobId = setup.start('Regtest test node', 'regtest', 'general');
    const job = await until<Job>(
      () => jobs.get(jobId),
      (candidate) => candidate.state === 'succeeded' || candidate.state === 'failed',
    );
    expect(job.error).toBeUndefined();
    expect(job.state).toBe('succeeded');
    const nodeId = job.result?.nodeId ?? '';
    profile = nodes.get(nodeId).profile;
    expect(profile).toMatchObject({ execution: 'managed', network: 'regtest', runtimeVersion: version });

    const status = await until(
      () => nodes.get(nodeId).status,
      (candidate) => candidate.state === 'running',
    );
    expect(status.snapshot?.blockchain.chain).toBe('regtest');
    expect(events.some((event) => event.type === 'job.updated' && event.payload.progress.stage === 'starting')).toBe(
      true,
    );
  });

  it('writes a valid managed configuration that pins the chain', () => {
    const text = readFileSync(configFilePath(profile.dataDirectory ?? ''), 'utf8');
    expect(text).toMatch(/^# Managed by BTCortex/);
    expect(text).toContain('chain=regtest');
    const errors = validateConfig(BitcoinConfig.parse(text), {
      network: 'regtest',
      windows: true,
      managed: true,
    }).filter((diagnostic) => diagnostic.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('reports new blocks through the monitor', async () => {
    const client = new BitcoinRpcClient({
      endpoint: profile.rpcEndpoint,
      credentials: cookieCredentials(profile.authentication.kind === 'cookie' ? profile.authentication.cookieFile : ''),
    });
    const { descriptor } = await client.call<{ descriptor: string }>('getdescriptorinfo', ['raw(51)']);
    await client.call('generatetodescriptor', [5, descriptor]);
    const status = await until(
      () => nodes.get(profile.id).status,
      (candidate) => candidate.snapshot?.blockchain.blocks === 5,
      40_000,
    );
    expect(status.snapshot?.blockchain.initialBlockDownload).toBe(false);
    expect(
      await new PeerService({ nodes, logger: new StructuredLogger([new MemorySink()], 'debug') }).peers(profile.id),
    ).toEqual([]);
  });

  it('refuses to use a profile whose network does not match the node', async () => {
    const timestamp = new Date().toISOString();
    const mismatched: NodeProfile = {
      ...profile,
      id: 'mismatch',
      name: 'Wrong network',
      network: 'signet',
      execution: 'external',
      dataDirectory: null,
      runtimeVersion: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    nodes.track(mismatched);
    const status = await until(
      () => nodes.get('mismatch').status,
      (candidate) => candidate.state === 'failed',
    );
    expect(status.error?.code).toBe('nodes.network-mismatch');
    nodes.untrack('mismatch');
  });

  it('stops gracefully, then starts again', async () => {
    const pid = readRunningPid(profile.dataDirectory ?? '', 'regtest');
    await nodes.stop(profile.id);
    const stopped = await until(
      () => nodes.get(profile.id).status.state,
      (state: NodeLifecycleState) => state === 'stopped',
    );
    expect(stopped).toBe('stopped');
    if (pid) expect(await waitForExit(pid, { timeoutMs: 30_000 })).toBe(true);

    await nodes.start(profile.id);
    const running = await until(
      () => nodes.get(profile.id).status,
      (candidate) => candidate.state === 'running',
    );
    // The chain survived the restart.
    expect(running.snapshot?.blockchain.blocks).toBe(5);
  });

  it('applies a saved configuration change when the node restarts', async () => {
    const config = new NodeConfigService({ nodes, logger: new StructuredLogger([new MemorySink()], 'debug') });
    const before = await config.get(profile.id);
    expect(before).toMatchObject({ editable: true, restartRequired: false });

    const edited = BitcoinConfig.parse(before.text);
    edited.set('maxmempool', '120', { scope: null });
    const saved = await config.save(profile.id, {
      text: edited.toString(),
      revision: before.revision,
      acceptedRisks: [],
    });
    expect(saved).toMatchObject({ changedKeys: ['maxmempool'], restartRequired: true });
    expect((await config.get(profile.id)).restartRequired).toBe(true);

    const oldPid = readRunningPid(profile.dataDirectory ?? '', 'regtest');
    await nodes.restart(profile.id);
    await until(
      () => ({
        state: nodes.get(profile.id).status.state,
        pid: readRunningPid(profile.dataDirectory ?? '', 'regtest'),
      }),
      (current) => current.state === 'running' && current.pid !== undefined && current.pid !== oldPid,
      120_000,
    );
    const client = new BitcoinRpcClient({
      endpoint: profile.rpcEndpoint,
      credentials: cookieCredentials(profile.authentication.kind === 'cookie' ? profile.authentication.cookieFile : ''),
    });
    const mempool = await client.call<{ maxmempool: number }>('getmempoolinfo');
    expect(mempool.maxmempool).toBe(120_000_000);
    expect((await config.get(profile.id)).restartRequired).toBe(false);
  });

  it('keeps a restart asked for while the node is already stopping', async () => {
    const oldPid = readRunningPid(profile.dataDirectory ?? '', 'regtest');
    await nodes.stop(profile.id);
    // A second request during the shutdown must neither fail nor undo the first.
    await nodes.stop(profile.id);
    await nodes.restart(profile.id);
    await until(
      () => ({
        state: nodes.get(profile.id).status.state,
        pid: readRunningPid(profile.dataDirectory ?? '', 'regtest'),
      }),
      (current) => current.state === 'running' && current.pid !== undefined && current.pid !== oldPid,
      120_000,
    );
  });

  it('gives a second node of the same network ports of its own, even while the first is stopped', async () => {
    await nodes.stop(profile.id);
    await until(
      () => nodes.get(profile.id).status.state,
      (state: NodeLifecycleState) => state === 'stopped',
    );
    const jobId = setup.start('Second regtest node', 'regtest', 'general');
    const job = await until<Job>(
      () => jobs.get(jobId),
      (candidate) => candidate.state === 'succeeded' || candidate.state === 'failed',
    );
    expect(job.error).toBeUndefined();
    const second = nodes.get(job.result?.nodeId ?? '').profile;
    const firstEffective = resolveEffective(
      BitcoinConfig.parse(readFileSync(configFilePath(profile.dataDirectory ?? ''), 'utf8')),
      'regtest',
    );
    const secondEffective = resolveEffective(
      BitcoinConfig.parse(readFileSync(configFilePath(second.dataDirectory ?? ''), 'utf8')),
      'regtest',
    );
    // The first node's ports were free while it was stopped, yet the second node did not take them.
    expect(new URL(second.rpcEndpoint).port).not.toBe(new URL(profile.rpcEndpoint).port);
    expect(effectiveScalar(secondEffective, 'port')).toBeDefined();
    expect(effectiveScalar(secondEffective, 'port')).not.toBe(effectiveScalar(firstEffective, 'port'));

    await nodes.stop(second.id);
    await until(
      () => nodes.get(second.id).status.state,
      (state: NodeLifecycleState) => state === 'stopped',
    );
    nodes.untrack(second.id);
    repository.remove(second.id);
    await nodes.start(profile.id);
    await until(
      () => nodes.get(profile.id).status.state,
      (state: NodeLifecycleState) => state === 'running',
    );
  });

  it('starts a node whose stale pid file names another program', async () => {
    const pid = readRunningPid(profile.dataDirectory ?? '', 'regtest');
    await nodes.stop(profile.id);
    await until(
      () => nodes.get(profile.id).status.state,
      (state: NodeLifecycleState) => state === 'stopped',
    );
    if (pid) await waitForExit(pid, { timeoutMs: 30_000 });
    // As after a crash, when Windows has given the old number to another process (here, this test).
    writeFileSync(join(profile.dataDirectory ?? '', 'regtest', 'bitcoind.pid'), String(process.pid));
    await nodes.start(profile.id);
    const running = await until(
      () => nodes.get(profile.id).status,
      (candidate) => candidate.state === 'running',
    );
    expect(running.snapshot?.blockchain.chain).toBe('regtest');
    expect(readRunningPid(profile.dataDirectory ?? '', 'regtest')).not.toBe(process.pid);
  });

  it('starts the nodes chosen to start with BTCortex and stops only those that should stop', async () => {
    // A node BTCortex set up starts with it and stops when it quits, until chosen otherwise.
    expect(repository.get(profile.id)).toMatchObject({ startWithBtcortex: true, keepRunningOnExit: false });
    const pid = readRunningPid(profile.dataDirectory ?? '', 'regtest');
    await nodes.shutdown();
    if (pid) expect(await waitForExit(pid, { timeoutMs: 30_000 })).toBe(true);

    // BTCortex starts again: a new manager over the same profiles starts the node.
    const logger = new StructuredLogger([new MemorySink()], 'debug');
    const vault = new SecretVault(
      database,
      createShellCaller(() => Promise.reject(new Error('The vault is not needed for cookie authentication.'))),
    );
    const again = new NodeManager({
      repository,
      vault,
      runtimesDirectory: TEST_ENV_RUNTIMES,
      publish: () => undefined,
      logger,
    });
    nodes = again;
    again.initialise();
    await again.startChosenNodes();
    await until(
      () => again.get(profile.id).status.state,
      (state: NodeLifecycleState) => state === 'running',
      120_000,
    );

    // Chosen to keep running: quitting BTCortex leaves it running.
    expect(again.configureLifecycle(profile.id, { keepRunningOnExit: true })).toMatchObject({
      keepRunningOnExit: true,
      startWithBtcortex: true,
    });
    expect(repository.get(profile.id)?.keepRunningOnExit).toBe(true);
    const running = readRunningPid(profile.dataDirectory ?? '', 'regtest');
    await again.shutdown();
    expect(running).toBeDefined();
    if (running) expect(await waitForExit(running, { timeoutMs: 5_000 })).toBe(false);
  });
});
