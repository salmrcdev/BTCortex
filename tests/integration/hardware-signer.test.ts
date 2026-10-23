import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitcoinRpcClient, cookieCredentials } from '@btcortex/bitcoin-rpc';
import type { Job, NodeProfile } from '@btcortex/contracts';
import { configFilePath } from '@btcortex/integration-bitcoin-core';
import type { HwiRuntime } from '@btcortex/integration-hwi';
import { JobManager } from '../../apps/orchestrator/src/jobs/job-manager';
import { MemorySink, StructuredLogger } from '../../apps/orchestrator/src/logging/logger';
import { NodeConfigService } from '../../apps/orchestrator/src/nodes/config-service';
import { NodeManager } from '../../apps/orchestrator/src/nodes/node-manager';
import { NodeRepository } from '../../apps/orchestrator/src/nodes/repository';
import { SignerService } from '../../apps/orchestrator/src/nodes/signer-service';
import { openDatabase } from '../../apps/orchestrator/src/persistence/database';
import { migrations } from '../../apps/orchestrator/src/persistence/migrations';
import { ensureAppDirectories, resolveAppPaths } from '../../apps/orchestrator/src/platform/paths';
import { SetupService } from '../../apps/orchestrator/src/setup/setup-service';
import { createShellCaller, SecretVault } from '../../apps/orchestrator/src/vault/vault';
import { findTestBitcoind, removeTestRoot, shutDownNodeManager, TEST_ENV_RUNTIMES } from './support/regtest-node';

// A hardware wallet on a node BTCortex manages, end to end, through Bitcoin
// Core's external signer support: the signer setting, a watch-only wallet
// from the device's public descriptors, an address shown on the device, and
// a transaction built for review, signed by the device only when asked, and
// broadcast. A simulated device (support/mock-signer.mjs) answers the way HWI
// does and signs with a regtest wallet that holds the keys. BTCortex's folder
// has a space in its path, as many Windows user names do.

const bitcoind = findTestBitcoind();
const version = bitcoind?.match(/runtimes[\\/]([^\\/]+)[\\/]/)?.[1];
const SATS = 100_000_000;

async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Condition not met in time; last value: ${JSON.stringify(value)}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
}

describe.skipIf(!bitcoind || !version)('A hardware wallet on a managed node (real bitcoind, simulated device)', () => {
  let root: string;
  let database: DatabaseSync;
  let nodes: NodeManager;
  let signers: SignerService;
  let profile: NodeProfile;
  let client: BitcoinRpcClient;
  let mockSettings: string;
  let fingerprint: string;
  const calls = () =>
    readFileSync(join(root, 'signer-calls.log'), 'utf8')
      .trim()
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { command: string; args: string[] });

  const restarted = async () => {
    await until(
      () => nodes.get(profile.id).status.state,
      (state) => state !== 'running',
      30_000,
    );
    await until(
      () => nodes.get(profile.id).status.state,
      (state) => state === 'running' || state === 'failed',
      120_000,
    );
    expect(nodes.get(profile.id).status.error).toBeUndefined();
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'btcortex signer '));
    const paths = resolveAppPaths({ BTCORTEX_DATA_DIR: join(root, 'BTCortex data') });
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
      publish: () => undefined,
      logger,
    });
    const jobs = new JobManager({ database, publish: () => undefined, logger });
    const config = new NodeConfigService({ nodes, logger });

    // The simulated device stands where BTCortex keeps HWI.
    const hwiDirectory = join(paths.installations, 'hwi');
    const signerFolder = join(hwiDirectory, '3.2.0');
    mkdirSync(signerFolder, { recursive: true });
    const script = resolve(import.meta.dirname, 'support', 'mock-signer.mjs');
    writeFileSync(join(signerFolder, 'hwi.cmd'), `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    const runtime = {
      version: '3.2.0',
      directory: signerFolder,
      executable: join(signerFolder, 'hwi.cmd'),
    } as HwiRuntime;
    signers = new SignerService({
      nodes,
      config,
      hardware: { hwi: () => Promise.resolve(runtime) },
      hwiDirectory,
      logger,
    });

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
    const jobId = setup.start('Regtest node with a hardware wallet', 'regtest', 'wallet-backend');
    const job = await until<Job>(
      () => jobs.get(jobId),
      (candidate) => candidate.state === 'succeeded' || candidate.state === 'failed',
    );
    expect(job.error).toBeUndefined();
    profile = nodes.get(job.result?.nodeId ?? '').profile;
    await until(
      () => nodes.get(profile.id).status.state,
      (state) => state === 'running',
    );
    const cookieFile = join(profile.dataDirectory ?? '', 'regtest', '.cookie');
    client = new BitcoinRpcClient({ endpoint: profile.rpcEndpoint, credentials: cookieCredentials(cookieFile) });

    // The "device": a wallet that holds the keys, on the same node.
    // Loaded again when the node restarts with the signer setting.
    await client.call('createwallet', { wallet_name: 'device', load_on_startup: true });
    // Someone else, to pay.
    await client.call('createwallet', { wallet_name: 'payee', load_on_startup: true });
    const listed = await client.call<{ descriptors: { desc: string; active: boolean; internal?: boolean }[] }>(
      'listdescriptors',
      [],
      { wallet: 'device' },
    );
    const active = listed.descriptors.filter((descriptor) => descriptor.active);
    fingerprint = /\[([0-9a-f]{8})\//.exec(active[0]?.desc ?? '')?.[1] ?? '';
    mockSettings = join(root, 'signer.json');
    writeFileSync(
      mockSettings,
      JSON.stringify({
        rpcUrl: profile.rpcEndpoint,
        cookieFile,
        wallet: 'device',
        fingerprint,
        model: 'trezor_safe 5',
        receive: active.filter((descriptor) => descriptor.internal !== true).map((descriptor) => descriptor.desc),
        internal: active.filter((descriptor) => descriptor.internal === true).map((descriptor) => descriptor.desc),
        log: join(root, 'signer-calls.log'),
      }),
    );
    writeFileSync(join(root, 'signer-calls.log'), '');
    // bitcoind passes its environment on to the signer it runs.
    process.env['BTCORTEX_MOCK_SIGNER'] = mockSettings;
  }, 240_000);

  afterAll(async () => {
    await shutDownNodeManager(nodes);
    database.close();
    removeTestRoot(root);
  }, 60_000);

  it('sets the node up to reach hardware wallets through HWI, with the path quoted', async () => {
    expect(await signers.status(profile.id)).toMatchObject({ manageable: true, configured: false, signers: null });
    expect(await signers.enable(profile.id)).toEqual({ restarting: true });
    await restarted();
    const text = readFileSync(configFilePath(profile.dataDirectory ?? ''), 'utf8');
    expect(text).toContain(`signer="${join(root, 'BTCortex data', 'installations', 'hwi', '3.2.0', 'hwi.cmd')}"`);
    expect(await signers.status(profile.id)).toMatchObject({
      configured: true,
      restartRequired: false,
      signers: [{ fingerprint, name: 'trezor_safe 5' }],
      wallets: [],
    });
  }, 240_000);

  it('creates a watch-only wallet from the device’s public descriptors', async () => {
    expect(await signers.createWallet(profile.id, 'Trezor')).toEqual({ wallet: 'Trezor' });
    const status = await signers.status(profile.id);
    expect(status.wallets).toEqual([{ name: 'Trezor', fingerprint, balanceSats: 0, pendingSats: 0, immatureSats: 0 }]);
    const detail = await signers.detail(profile.id, 'Trezor');
    expect(detail.addressTypes).toEqual(expect.arrayContaining(['bech32', 'bech32m', 'p2sh-segwit', 'legacy']));
    // A wallet with keys is not a hardware-wallet wallet and is not offered.
    await expect(signers.detail(profile.id, 'device')).rejects.toThrow(/not a hardware-wallet wallet/);
    expect(calls().map((call) => call.command)).toContain('getdescriptors');
  }, 240_000);

  it('shows a receiving address on the device, and refuses one the device does not echo back', async () => {
    const address = await signers.newAddress(profile.id, 'Trezor', 'bech32');
    expect(address).toMatch(/^bcrt1q/);
    await signers.displayAddress(profile.id, 'Trezor', address);
    expect(calls().at(-1)?.command).toBe('displayaddress');

    const settings = JSON.parse(readFileSync(mockSettings, 'utf8')) as Record<string, unknown>;
    writeFileSync(mockSettings, JSON.stringify({ ...settings, echo: 'bcrt1qsomethingelse0000000000000000000000000' }));
    await expect(signers.displayAddress(profile.id, 'Trezor', address)).rejects.toThrow(/different address/);
    writeFileSync(mockSettings, JSON.stringify(settings));
  }, 240_000);

  it('builds a transaction for review, has the device sign it only when asked, then broadcasts it', async () => {
    const funding = await signers.newAddress(profile.id, 'Trezor', 'bech32m');
    await client.call('generatetoaddress', [101, funding]);
    const funded = await until(
      () => signers.detail(profile.id, 'Trezor'),
      (detail) => detail.balanceSats === 50 * SATS,
    );
    expect(funded.transactions.length).toBeGreaterThan(0);

    const destination = await client.call<string>('getnewaddress', [], { wallet: 'payee' });
    const signsBefore = calls().filter((call) => call.command === 'signtx').length;
    const review = await signers.createPsbt(profile.id, 'Trezor', [{ address: destination, amountSats: SATS }], 2);
    // analyzepsbt names the updater for Taproot inputs even when only signatures are missing.
    expect(['signer', 'updater']).toContain(review.next);
    expect(review.complete).toBe(false);
    expect(review.outputs).toEqual(
      expect.arrayContaining([
        { address: destination, amountSats: SATS, ownedByWallet: false },
        expect.objectContaining({ ownedByWallet: true }),
      ]),
    );
    expect(review.feeSats).toBeGreaterThan(0);
    expect(review.feeRateSatPerVb).toBeCloseTo(2, 0);
    // Building and reviewing never reaches the device.
    expect(calls().filter((call) => call.command === 'signtx')).toHaveLength(signsBefore);

    const signed = await signers.signPsbt(profile.id, 'Trezor', review.psbt);
    expect(calls().filter((call) => call.command === 'signtx')).toHaveLength(signsBefore + 1);
    expect(signed.review.complete).toBe(true);
    expect(signed.hex).toMatch(/^[0-9a-f]+$/);

    // A PSBT that already carries every signature, as it comes back from an air-gapped device.
    expect(await signers.finalizePsbt(profile.id, signed.review.psbt)).toEqual({ complete: true, hex: signed.hex });
    expect(await signers.finalizePsbt(profile.id, review.psbt)).toEqual({ complete: false, hex: null });

    const { txid } = await signers.broadcast(profile.id, signed.hex ?? '');
    expect(await client.call<string[]>('getrawmempool')).toContain(txid);
  }, 240_000);

  it('reads and writes PSBT files as devices with microSD slots exchange them', async () => {
    const review = await signers.createPsbt(
      profile.id,
      'Trezor',
      [{ address: await client.call<string>('getnewaddress', [], { wallet: 'payee' }), amountSats: SATS / 10 }],
      1,
    );
    const binary = join(root, 'unsigned.psbt');
    await signers.writePsbtFile(binary, review.psbt);
    expect(readFileSync(binary).subarray(0, 5).toString('hex')).toBe('70736274ff');
    expect(await signers.readPsbtFile(binary)).toBe(review.psbt);
    const text = join(root, 'unsigned.txt');
    await signers.writePsbtFile(text, review.psbt);
    expect(await signers.readPsbtFile(text)).toBe(review.psbt);
    await expect(signers.writePsbtFile(join(root, 'unsigned.exe'), review.psbt)).rejects.toThrow(/\.psbt or \.txt/);
    writeFileSync(join(root, 'notes.txt'), 'not a psbt');
    await expect(signers.readPsbtFile(join(root, 'notes.txt'))).rejects.toThrow(/does not contain a PSBT/);
  }, 240_000);
});
