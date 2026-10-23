import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job, NodeProfile, NodeWithStatus } from '@btcortex/contracts';
import { sha256Hex, VERIFICATION_RECORD_FILE } from '@btcortex/installation-manager';
import type { VerificationRecord } from '@btcortex/installation-manager';
import { electrumReleaseFiles } from '@btcortex/integration-electrum-wallet';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { InstallationService } from './installation-service';

const logger = new StructuredLogger([new MemorySink()], 'debug');

function record(version: string, files: VerificationRecord['files'], authenticode = 2): VerificationRecord {
  return {
    label: `Example ${version}`,
    version,
    archive: { url: 'https://example.org/a.zip', sha256: '00', bytes: 1 },
    manifest: { url: 'https://example.org/SHA256SUMS', sha256: '00' },
    signatures: {
      results: [],
      validSigners: [
        { signer: 'a', fingerprint: 'A' },
        { signer: 'b', fingerprint: 'B' },
        { signer: 'c', fingerprint: 'C' },
        { signer: 'd', fingerprint: 'D' },
      ],
      signerCount: 4,
      threshold: 3,
      meetsThreshold: true,
    },
    authenticode: Array.from({ length: authenticode }, (_, index) => ({
      file: `tool${String(index)}.exe`,
      status: 'Valid',
      signer: 'Bitcoin Core Code Signing LLC',
    })),
    trustAnchors: 'test',
    verifiedAt: '2026-10-23T10:00:00.000Z',
    ...(files ? { files } : {}),
  };
}

describe('InstallationService', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-installations-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function core(version: string, withHashes: boolean) {
    const directory = join(root, 'bitcoin-core', version);
    mkdirSync(join(directory, `bitcoin-${version}`, 'bin'), { recursive: true });
    for (const name of ['bitcoind.exe', 'bitcoin-cli.exe']) {
      writeFileSync(join(directory, `bitcoin-${version}`, 'bin', name), name);
    }
    const files = withHashes
      ? ['bitcoind.exe', 'bitcoin-cli.exe'].map((name) => ({
          path: `bitcoin-${version}/bin/${name}`,
          sha256: sha256Hex(Buffer.from(name)),
          bytes: name.length,
        }))
      : undefined;
    writeFileSync(join(directory, VERIFICATION_RECORD_FILE), JSON.stringify(record(version, files)));
    return directory;
  }

  function sparrow(version: string) {
    const directory = join(root, 'sparrow', version);
    mkdirSync(join(directory, 'Sparrow'), { recursive: true });
    writeFileSync(join(directory, 'Sparrow', 'Sparrow.exe'), 'sparrow');
    writeFileSync(join(directory, VERIFICATION_RECORD_FILE), JSON.stringify(record(version, undefined, 0)));
  }

  function setUp(
    options: {
      sparrowRunning?: boolean;
      latest?: string;
      state?: NodeWithStatus['status']['state'];
      knots?: boolean;
      electrumLatest?: string;
    } = {},
  ) {
    let profile = {
      id: 'node-1',
      name: 'Main node',
      implementation: options.knots ? 'bitcoin-knots' : 'bitcoin-core',
      execution: 'managed',
      runtimeVersion: options.knots ? '29.4.2.knots20260508' : '30.2',
    } as NodeProfile;
    const restarts: string[] = [];
    const jobs: { kind: Job['kind']; work: Promise<unknown> }[] = [];
    const installs: string[] = [];
    const service = new InstallationService({
      runtimesDirectory: join(root, 'bitcoin-core'),
      sparrowDirectory: join(root, 'sparrow'),
      torDirectory: join(root, 'tor'),
      hwiDirectory: join(root, 'hwi'),
      electrumDirectory: join(root, 'electrum'),
      downloadsDirectory: join(root, 'downloads'),
      nodes: {
        list: () => [{ profile, status: { nodeId: 'node-1', state: options.state ?? 'running', checkedAt: '' } }],
        get: () => ({ profile, status: { nodeId: 'node-1', state: options.state ?? 'running', checkedAt: '' } }),
        restart: (nodeId) => {
          restarts.push(nodeId);
          return Promise.resolve();
        },
        updateProfile: (next) => {
          profile = next;
        },
      },
      repository: {
        setRuntimeVersion: (_id, version) => ({ ...profile, runtimeVersion: version }),
      },
      jobs: {
        run: (kind, _title, work) => {
          jobs.push({ kind, work: work(() => undefined) });
          return { id: `job-${String(jobs.length)}` } as Job;
        },
      },
      sparrowRunning: () => Promise.resolve(options.sparrowRunning ?? false),
      torRunningVersion: () => null,
      logger,
      latest: {
        'bitcoin-core': () => (options.latest ? Promise.resolve(options.latest) : Promise.reject(new Error('offline'))),
        sparrow: () => Promise.resolve('2.5.5'),
        tor: () => Promise.resolve('15.0.26'),
        hwi: () => Promise.resolve('3.2.0'),
        electrum: () => Promise.resolve(options.electrumLatest ?? '4.8.2'),
      },
      install: {
        'bitcoin-core': (version) => {
          installs.push(version);
          core(version, true);
          return Promise.resolve();
        },
      },
    });
    return { service, restarts, jobs, installs, profile: () => profile };
  }

  it('lists what was verified for each installed version and which nodes use it', async () => {
    core('31.1', true);
    core('30.2', false);
    sparrow('2.5.5');
    const { service } = setUp({ sparrowRunning: true });
    const list = await service.list();
    expect(list.map((item) => `${item.product} ${item.version}`)).toEqual([
      'bitcoin-core 31.1',
      'bitcoin-core 30.2',
      'sparrow 2.5.5',
    ]);
    expect(list[0]).toMatchObject({
      signatures: { valid: 4, required: 3 },
      codeSigning: 'verified',
      integrityRecorded: true,
      usedBy: [],
      running: false,
    });
    expect(list[1]).toMatchObject({ integrityRecorded: false, usedBy: [{ id: 'node-1', name: 'Main node' }] });
    expect(list[2]).toMatchObject({ codeSigning: 'none', running: true });
  });

  it('checks files against their recorded hashes', async () => {
    const directory = core('31.1', true);
    const { service } = setUp();
    expect(await service.verify('bitcoin-core', '31.1')).toEqual({
      product: 'bitcoin-core',
      version: '31.1',
      recorded: true,
      checked: 2,
      missing: [],
      changed: [],
    });
    writeFileSync(join(directory, 'bitcoin-31.1', 'bin', 'bitcoind.exe'), 'replaced');
    expect((await service.verify('bitcoin-core', '31.1')).changed).toEqual(['bitcoin-31.1/bin/bitcoind.exe']);
    await expect(service.verify('bitcoin-core', '29.0')).rejects.toMatchObject({
      error: { code: 'installations.not-found' },
    });
  });

  it('reports newer releases, and says so when the server cannot be reached', async () => {
    core('30.2', false);
    const online = await setUp({ latest: '31.1' }).service.checkUpdates();
    expect(online.find((update) => update.product === 'bitcoin-core')).toMatchObject({
      installed: '30.2',
      latest: '31.1',
      updateAvailable: true,
    });
    // Sparrow is not installed, so there is nothing to update.
    expect(online.find((update) => update.product === 'sparrow')).toMatchObject({
      installed: null,
      updateAvailable: false,
    });
    const offline = await setUp().service.checkUpdates();
    expect(offline.find((update) => update.product === 'bitcoin-core')).toMatchObject({
      latest: null,
      updateAvailable: false,
      error: expect.stringContaining('could not be reached') as string,
    });
  });

  it('does not offer an Electrum newer than BTCortex’s Electrum servers support, and says why', async () => {
    const directory = join(root, 'electrum', '4.8.1');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, electrumReleaseFiles('4.8.1').executableName), 'electrum');
    writeFileSync(join(directory, VERIFICATION_RECORD_FILE), JSON.stringify(record('4.8.1', undefined, 0)));
    const updates = await setUp({ electrumLatest: '4.9.0' }).service.checkUpdates();
    expect(updates.find((update) => update.product === 'electrum')).toMatchObject({
      installed: '4.8.1',
      latest: '4.9.0',
      updateAvailable: false,
      held: expect.stringContaining('newer Electrum protocol') as string,
    });
    const compatible = await setUp({ electrumLatest: '4.8.2' }).service.checkUpdates();
    expect(compatible.find((update) => update.product === 'electrum')).toMatchObject({ updateAvailable: true });
    expect(compatible.find((update) => update.product === 'electrum')?.held).toBeUndefined();
  });

  it('installs an update next to the current version, as a background job', async () => {
    core('30.2', false);
    const { service, jobs, installs } = setUp({ latest: '31.1' });
    expect(service.update('bitcoin-core')).toBe('job-1');
    await jobs[0]?.work;
    expect(jobs[0]?.kind).toBe('software.update');
    expect(installs).toEqual(['31.1']);
    expect(existsSync(join(root, 'bitcoin-core', '30.2'))).toBe(true);
    expect((await service.list()).map((item) => item.version)).toEqual(['31.1', '30.2']);
  });

  it('removes only versions nothing uses or runs', async () => {
    core('31.1', true);
    core('30.2', false);
    sparrow('2.5.5');
    const { service } = setUp({ sparrowRunning: true });
    await expect(service.remove('bitcoin-core', '30.2')).rejects.toMatchObject({
      error: { code: 'installations.in-use' },
    });
    await expect(service.remove('sparrow', '2.5.5')).rejects.toMatchObject({
      error: { code: 'installations.running' },
    });
    expect(await service.remove('bitcoin-core', '31.1')).toBeGreaterThan(0);
    expect(existsSync(join(root, 'bitcoin-core', '31.1'))).toBe(false);
  });

  it('moves a node to a newer version and restarts it, but never back to an older one', async () => {
    core('31.1', true);
    core('30.2', false);
    core('29.0', false);
    const { service, restarts, profile } = setUp();
    await expect(service.useRuntime('node-1', '29.0')).rejects.toMatchObject({
      error: { code: 'installations.downgrade' },
    });
    expect(await service.useRuntime('node-1', '31.1')).toBe(true);
    expect(profile().runtimeVersion).toBe('31.1');
    expect(restarts).toEqual(['node-1']);
    // Already there: nothing to do.
    expect(await service.useRuntime('node-1', '31.1')).toBe(false);
  });

  it('never moves a node between Bitcoin Core and Bitcoin Knots, which follow different chains', async () => {
    core('31.1', true);
    const core31 = setUp();
    await expect(core31.service.useRuntime('node-1', '29.4.2.knots20260508')).rejects.toMatchObject({
      error: { code: 'installations.other-software' },
    });
    const knots = setUp({ knots: true });
    await expect(knots.service.useRuntime('node-1', '31.1')).rejects.toMatchObject({
      error: { code: 'installations.other-software' },
    });
    expect(knots.profile().runtimeVersion).toBe('29.4.2.knots20260508');
    expect(knots.restarts).toEqual([]);
  });
});
