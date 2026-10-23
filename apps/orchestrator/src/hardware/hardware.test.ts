import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppFailure } from '@btcortex/contracts';
import type { Job } from '@btcortex/contracts';
import { VERIFICATION_RECORD_FILE } from '@btcortex/installation-manager';
import { HwiError } from '@btcortex/integration-hwi';
import type { HwiDevice } from '@btcortex/integration-hwi';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { configuredSigner, psbtFromFile, signerSetting } from '../nodes/signer-service';
import { HardwareService } from './hardware-service';

const logger = new StructuredLogger([new MemorySink()], 'debug');

describe('HardwareService', () => {
  let root: string;
  let jobs: { kind: Job['kind']; work: Promise<unknown> }[];
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-hardware-'));
    jobs = [];
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const installHwiRecord = () => {
    const directory = join(root, 'hwi', '3.2.0');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'hwi.exe'), 'MZ');
    writeFileSync(
      join(directory, VERIFICATION_RECORD_FILE),
      JSON.stringify({ label: 'HWI 3.2.0', version: '3.2.0', verifiedAt: '2026-10-23T02:00:00.000Z' }),
    );
  };

  const service = (devices: HwiDevice[] | Error = []) =>
    new HardwareService({
      hwiDirectory: join(root, 'hwi'),
      downloadsDirectory: join(root, 'downloads'),
      suiteRecordFile: join(root, 'trezor-suite.json'),
      jobs: {
        run: (kind, _title, work) => {
          jobs.push({ kind, work: work(() => undefined) });
          return { id: `job-${String(jobs.length)}` } as Job;
        },
      },
      logger,
      env: { LOCALAPPDATA: join(root, 'local'), ProgramFiles: join(root, 'programs') },
      listDevices: () =>
        Promise.resolve([
          {
            id: '1209:53c1:A',
            vendor: 'trezor',
            model: null,
            mode: 'firmware',
            confidence: 'certain',
            vendorId: '1209',
            productId: '53c1',
            windowsName: 'TREZOR',
            driver: { ok: true, problemCode: null },
          },
        ]),
      client: () => ({
        enumerate: () => (devices instanceof Error ? Promise.reject(devices) : Promise.resolve(devices)),
      }),
      latestHwi: () => Promise.resolve('3.2.0'),
      installHwi: () => {
        installHwiRecord();
        return Promise.resolve();
      },
    });

  it('reports attached devices, HWI and Trezor’s software', async () => {
    const overview = await service().overview();
    expect(overview.devices).toHaveLength(1);
    expect(overview.hwi).toBeNull();
    expect(overview.trezorSuite).toMatchObject({ installed: null, holdsDevice: false });
    expect(overview.trezorBridge.present).toBe(false);
  });

  it('asks for HWI before talking to devices, and installs it as a job', async () => {
    const hardware = service();
    await expect(hardware.identify('mainnet')).rejects.toMatchObject({ error: { code: 'hardware.hwi-missing' } });
    expect(hardware.installHwi()).toBe('job-1');
    await jobs[0]?.work;
    expect(jobs[0]?.kind).toBe('hwi.install');
    expect((await hardware.overview()).hwi).toEqual({ version: '3.2.0', verifiedAt: '2026-10-23T02:00:00.000Z' });
  });

  it('identifies devices through HWI, keeping a locked device’s state', async () => {
    installHwiRecord();
    const identified = await service([
      {
        type: 'trezor',
        model: 'trezor_safe 5',
        path: 'webusb:1',
        fingerprint: 'd34db33f',
        needsPinSent: false,
        needsPassphraseSent: true,
      },
      { type: 'trezor', model: 'trezor_t', path: 'webusb:2', needsPinSent: true, needsPassphraseSent: false },
    ]).identify('regtest');
    expect(identified).toEqual([
      { type: 'trezor', model: 'trezor_safe 5', fingerprint: 'd34db33f', locked: false, needsPassphrase: true },
      { type: 'trezor', model: 'trezor_t', locked: true, needsPassphrase: false },
    ]);
  });

  it('explains HWI’s failures in the user’s terms', async () => {
    installHwiRecord();
    const failure = await service(new HwiError(-3, 'Could not open client'))
      .identify('mainnet')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppFailure);
    expect((failure as AppFailure).error).toMatchObject({
      code: 'hardware.hwi-3',
      message: 'The hardware wallet could not be reached.',
    });
  });

  it('refuses to open Trezor Suite before it is installed', async () => {
    await expect(service().openTrezorSuite()).rejects.toMatchObject({ error: { code: 'hardware.suite-missing' } });
  });
});

describe('signer settings and PSBT files', () => {
  it('quotes the signer path and reads it back', () => {
    const path = 'C:\\Users\\John Smith\\AppData\\Local\\BTCortex\\installations\\hwi\\3.2.0\\hwi.exe';
    expect(signerSetting(path)).toBe(`"${path}"`);
    expect(configuredSigner(`signer=${signerSetting(path)}\n`, 'mainnet')).toBe(path);
    expect(configuredSigner('[regtest]\nsigner=C:\\hwi\\hwi.exe\n', 'regtest')).toBe('C:\\hwi\\hwi.exe');
    expect(configuredSigner('server=1\n', 'mainnet')).toBeUndefined();
  });

  it('reads a PSBT in binary, base64 or hex, and nothing else', () => {
    const binary = Buffer.concat([Buffer.from('70736274ff', 'hex'), Buffer.from([1, 0, 2])]);
    const base64 = binary.toString('base64');
    expect(psbtFromFile(binary)).toBe(base64);
    expect(psbtFromFile(Buffer.from(`${base64}\n`))).toBe(base64);
    expect(psbtFromFile(Buffer.from(binary.toString('hex')))).toBe(base64);
    expect(() => psbtFromFile(Buffer.from('hello'))).toThrow(/does not contain a PSBT/);
  });
});
