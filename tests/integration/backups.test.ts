import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import type { Job, NodeProfile } from '@btcortex/contracts';
import { configFilePath } from '@btcortex/integration-bitcoin-core';
import { BackupService } from '../../apps/orchestrator/src/backups/backup-service';
import { JobManager } from '../../apps/orchestrator/src/jobs/job-manager';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { NodeConfigService } from '../../apps/orchestrator/src/nodes/config-service';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { SettingsStore } from '../../apps/orchestrator/src/persistence/settings';
import { ensureAppDirectories, resolveAppPaths } from '../../apps/orchestrator/src/platform/paths';
import { SetupService } from '../../apps/orchestrator/src/setup/setup-service';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import { findTestBitcoind, removeTestRoot, shutDownNodeManager, TEST_ENV_RUNTIMES } from './support/regtest-node';

// The backup centre against a real regtest node BTCortex manages: Bitcoin
// Core copies the wallets itself (backupwallet), an encrypted backup is
// written and verified, and a changed bitcoin.conf and a wallet are restored
// (restorewallet). Nothing reaches a real network.

const bitcoind = findTestBitcoind();
const version = bitcoind?.match(/runtimes[\\/]([^\\/]+)[\\/]/)?.[1];
const PASSPHRASE = 'correct horse battery staple';

async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Condition not met in time; last value: ${JSON.stringify(value)}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
}

describe.skipIf(!bitcoind || !version)('The backup centre with a real managed node', () => {
  let root: string;
  let destination: string;
  let database: DatabaseSync;
  let nodes: NodeManager;
  let jobs: JobManager;
  let config: NodeConfigService;
  let backups: BackupService;
  let profile: NodeProfile;
  let rpc: BitcoinRpcClient;
  const secrets = new Map<string, { purpose: string; value: string }>();

  const finished = (jobId: string) =>
    until<Job>(
      () => jobs.get(jobId),
      (job) => job.state === 'succeeded' || job.state === 'failed',
    );

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-backups-'));
    destination = mkdtempSync(join(tmpdir(), 'btcortex-backup-destination-'));
    const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: root });
    ensureAppDirectories(paths);
    const logger = new StructuredLogger([new MemorySink(5000)], 'debug');
    database = openDatabase({ file: paths.database, migrations, logger });
    const repository = new NodeRepository(database);
    const vault = new SecretVault(
      database,
      createShellCaller(() => Promise.reject(new Error('The vault is not needed for cookie authentication.'))),
    );
    nodes = new NodeManager({
      repository,
      vault,
      runtimesDirectory: TEST_ENV_RUNTIMES,
      publish: () => undefined,
      logger,
    });
    jobs = new JobManager({ database, publish: () => undefined, logger });
    config = new NodeConfigService({ nodes, logger });
    const fetchLatest: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ tag_name: `v${version ?? ''}`, prerelease: false, draft: false })));
    const setup = new SetupService({
      paths,
      repository,
      nodes,
      jobs,
      logger,
      runtimesDirectory: TEST_ENV_RUNTIMES,
      fetch: fetchLatest,
    });
    const setupJob = await finished(setup.start('Backed-up node', 'regtest', 'general'));
    expect(setupJob.error).toBeUndefined();
    profile = nodes.get(setupJob.result?.nodeId ?? '').profile;
    await until(
      () => nodes.get(profile.id).status.state,
      (state) => state === 'running',
    );
    rpc = nodes.rpc(profile.id);
    await rpc.call('createwallet', ['alice']);
    await rpc.call('createwallet', ['bob']);
    const address = await rpc.call<string>('getnewaddress', [], { wallet: 'alice' });
    await rpc.call('generatetoaddress', [101, address]);

    secrets.set('secret-1', { purpose: 'RPC password for Home server', value: 'hunter2' });
    backups = new BackupService({
      settings: new SettingsStore(database),
      vault: {
        store: (purpose, value) => {
          const id = `secret-${String(secrets.size + 1)}`;
          secrets.set(id, { purpose, value });
          return Promise.resolve(id);
        },
        reveal: (id) => Promise.resolve(secrets.get(id)?.value ?? ''),
        remove: (id) => secrets.delete(id),
        list: () => [...secrets].map(([id, secret]) => ({ id, purpose: secret.purpose, createdAt: '', updatedAt: '' })),
      },
      nodes,
      config,
      profiles: () => repository.list(),
      lightning: { list: () => [], channelBackup: () => Promise.reject(new Error('unused')) },
      jobs,
      paths,
      logger,
      version: '0.1.0',
    });
  }, 300_000);

  afterAll(async () => {
    // Whatever failed in the set-up, nothing is left running or behind.
    (backups as BackupService | undefined)?.shutdown();
    if ((nodes as NodeManager | undefined) !== undefined) await shutDownNodeManager(nodes);
    (database as DatabaseSync | undefined)?.close();
    removeTestRoot(root);
    removeTestRoot(destination);
  }, 120_000);

  it('lists what it can back up, by kind, and what it leaves out', async () => {
    await expect(backups.configure({ destination: join(root, 'backups') })).rejects.toMatchObject({
      error: { code: 'backups.destination-inside-data' },
    });
    await backups.configure({ destination, retention: 2 });
    const overview = await backups.overview();
    expect(overview.items.map((item) => [item.id, item.kind, item.available, item.secret])).toEqual([
      ['btcortex.settings', 'configuration', true, false],
      [`node.${profile.id}.config`, 'configuration', true, false],
      [`node.${profile.id}.wallet.alice`, 'wallet', true, true],
      [`node.${profile.id}.descriptors.alice`, 'descriptors', true, false],
      [`node.${profile.id}.wallet.bob`, 'wallet', true, true],
      [`node.${profile.id}.descriptors.bob`, 'descriptors', true, false],
      ['btcortex.credentials', 'credentials', true, true],
    ]);
    expect(overview.notBackedUp.map((item) => item.kind)).toEqual(['blockchain', 'index', 'seed', 'electrum-wallets']);
    expect(overview.settings).toMatchObject({ destination, retention: 2, passphraseStored: false });
  });

  it('leaves wallets and credentials out of a backup without a passphrase', async () => {
    // An Electrum server reachable through Tor: its onion address lets anyone use it.
    const onionAddress = 'a'.repeat(56);
    new SettingsStore(database).set('electrum', {
      servers: [
        { nodeId: profile.id, enabled: true, onion: { enabled: true, serviceId: onionAddress, keySecretId: 'k1' } },
      ],
    });
    const items = (await backups.overview()).items.map((item) => item.id);
    const job = await finished(backups.create(items));
    expect(job.error).toBeUndefined();
    const { settings, backups: found } = await backups.overview();
    expect(settings.lastRun).toMatchObject({ outcome: 'succeeded', trigger: 'manual' });
    expect(settings.lastRun?.skipped.map((item) => item.id).sort()).toEqual(
      [`node.${profile.id}.wallet.alice`, `node.${profile.id}.wallet.bob`, 'btcortex.credentials'].sort(),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ encrypted: false });
    expect(found[0]?.items.map((item) => item.kind).sort()).toEqual(
      ['configuration', 'configuration', 'descriptors', 'descriptors'].sort(),
    );
    // The descriptors are public: no private key in them.
    const folder = found[0]?.path ?? '';
    const descriptorsFolder = readdirSync(join(folder, 'items')).find((name) => name.includes('descriptors.alice'));
    const descriptors = readFileSync(join(folder, 'items', descriptorsFolder ?? '', 'descriptors.json'), 'utf8');
    expect(descriptors).toContain('wpkh(');
    expect(descriptors).not.toMatch(/tprv/);
    // Without a passphrase the onion address is left out, and the file says so.
    const settingsFolder = readdirSync(join(folder, 'items')).find((name) => name.includes('btcortex.settings'));
    const exported = readFileSync(join(folder, 'items', settingsFolder ?? '', 'btcortex-settings.json'), 'utf8');
    expect(exported).toContain('"keySecretId": "k1"');
    expect(exported).not.toContain(onionAddress);
    expect(exported).toContain('onion addresses of the Electrum servers are left out');
  });

  it('writes an encrypted backup with Bitcoin Core’s own wallet copies, and checks it', async () => {
    const items = (await backups.overview()).items.map((item) => item.id);
    const job = await finished(backups.create(items, PASSPHRASE));
    expect(job.error).toBeUndefined();
    const { settings, backups: found } = await backups.overview();
    expect(settings.lastRun?.skipped).toEqual([]);
    expect(found[0]).toMatchObject({ encrypted: true });
    expect(found[0]?.items).toHaveLength(7);
    const path = found[0]?.path ?? '';
    expect(await backups.verify(path)).toMatchObject({ ok: true, decrypted: false });
    expect(await backups.verify(path, PASSPHRASE)).toMatchObject({ ok: true, decrypted: true, checkedFiles: 7 });
    await expect(backups.verify(path, 'not the passphrase')).rejects.toMatchObject({
      error: { code: 'backups.wrong-passphrase' },
    });
    // Retention: two backups kept.
    expect(found).toHaveLength(2);
  });

  it('restores a changed bitcoin.conf and a wallet, under a new name when the name is taken', async () => {
    const { backups: found } = await backups.overview();
    const path = found[0]?.path ?? '';
    const preview = await backups.preview(path);
    const actions = Object.fromEntries(preview.items.map((item) => [item.id, item.action]));
    expect(actions).toMatchObject({
      [`node.${profile.id}.config`]: 'restore',
      [`node.${profile.id}.wallet.alice`]: 'restore',
      [`node.${profile.id}.descriptors.alice`]: 'manual',
      'btcortex.settings': 'manual',
      'btcortex.credentials': 'manual',
    });

    const file = configFilePath(profile.dataDirectory ?? '');
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, `${original}\n# changed after the backup\nmaxconnections=12\n`);
    const balance = await rpc.call<number>('getbalance', [], { wallet: 'alice' });

    const job = await finished(
      backups.restore(path, [`node.${profile.id}.config`, `node.${profile.id}.wallet.alice`], PASSPHRASE),
    );
    expect(job.error).toBeUndefined();
    const outcome = (await backups.overview()).lastRestore;
    expect(outcome?.results.map((result) => result.outcome)).toEqual(['restored', 'restored']);
    expect(readFileSync(file, 'utf8')).toBe(original);
    const restoredName = `alice-restored-${new Date().toISOString().slice(0, 10)}`;
    expect(outcome?.results[1]?.message).toContain(restoredName);
    const wallets = await rpc.call<string[]>('listwallets');
    expect(wallets).toContain(restoredName);
    expect(await rpc.call<number>('getbalance', [], { wallet: restoredName })).toBe(balance);
    // Loaded at every start: Bitcoin Core lists it in the node's settings.json.
    const settings = JSON.parse(
      readFileSync(join(profile.dataDirectory ?? '', 'regtest', 'settings.json'), 'utf8'),
    ) as { wallet?: string[] };
    expect(settings.wallet).toContain(restoredName);
  });

  it('restores risky settings of bitcoin.conf only once the user confirms them, and commands never from a plain backup', async () => {
    const file = configFilePath(profile.dataDirectory ?? '');
    const current = readFileSync(file, 'utf8');
    const configItem = `node.${profile.id}.config`;
    const backUpWith = async (extra: string, passphrase?: string) => {
      // The file as it was when backed up; put back as it is now right after.
      writeFileSync(file, `${current}\n${extra}\n`);
      const job = await finished(backups.create([configItem], passphrase));
      writeFileSync(file, current);
      expect(job.error).toBeUndefined();
      return (await backups.overview()).backups[0]?.path ?? '';
    };
    const restoreOutcome = async (path: string, passphrase?: string, accepted?: string[]) => {
      await finished(backups.restore(path, [configItem], passphrase, accepted));
      return (await backups.overview()).lastRestore?.results[0];
    };

    // A command from an unencrypted backup is refused outright.
    const plain = await backUpWith('[regtest]\nblocknotify=cmd /c echo %s');
    expect(await restoreOutcome(plain)).toMatchObject({
      outcome: 'failed',
      message: expect.stringContaining('run commands (blocknotify)') as string,
    });
    expect(readFileSync(file, 'utf8')).toBe(current);

    // Pruning needs the user's confirmation: listed first, restored once confirmed.
    const encrypted = await backUpWith('[regtest]\nprune=1000', PASSPHRASE);
    expect(await restoreOutcome(encrypted, PASSPHRASE)).toMatchObject({
      outcome: 'failed',
      settingsToConfirm: ['prune'],
    });
    expect(readFileSync(file, 'utf8')).toBe(current);
    expect(await restoreOutcome(encrypted, PASSPHRASE, ['prune'])).toMatchObject({ outcome: 'restored' });
    expect(readFileSync(file, 'utf8')).toContain('prune=1000');
    writeFileSync(file, current);
  });
});
