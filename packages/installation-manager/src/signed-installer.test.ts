import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as openpgp from 'openpgp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InstallationRejectedError } from './archive-installer';
import type { TrustedKey } from './openpgp';
import { installSignedInstaller, readInstallerRecord } from './signed-installer';

// A vendor installer verified by a detached OpenPGP signature and its Windows
// code signature before it runs. A copy of Windows' own whoami.exe stands in
// for the installer, because it carries a valid Authenticode signature; it is
// never actually run.

const BASE = 'https://releases.example.org/2.0/';
const NAME = 'Vendor-App-2.0-win-x64.exe';
const SIGNED_EXECUTABLE = 'C:\\Windows\\System32\\whoami.exe';
const onWindows = process.platform === 'win32' && existsSync(SIGNED_EXECUTABLE);

let key: TrustedKey;
let privateKey: openpgp.PrivateKey;
let otherKey: openpgp.PrivateKey;

beforeAll(async () => {
  const generate = () =>
    openpgp.generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'Vendor' }], format: 'object' });
  const vendor = await generate();
  privateKey = vendor.privateKey;
  otherKey = (await generate()).privateKey;
  key = {
    name: 'Vendor',
    fingerprints: [vendor.publicKey.getFingerprint().toUpperCase()],
    armored: vendor.publicKey.armor(),
  };
});

describe.skipIf(!onWindows)('installSignedInstaller', () => {
  let root: string;
  let ran: { path: string; args: readonly string[] }[];
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-signed-installer-'));
    ran = [];
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function release(installer: Uint8Array, signer: openpgp.PrivateKey) {
    const signature: string = await openpgp.sign({
      message: await openpgp.createMessage({ binary: installer }),
      signingKeys: signer,
      detached: true,
      format: 'armored',
    });
    const served: Record<string, Uint8Array> = {
      [`${BASE}${NAME}`]: installer,
      [`${BASE}${NAME}.asc`]: new TextEncoder().encode(signature),
    };
    return ((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = served[url];
      return Promise.resolve(
        body
          ? new Response(body, { status: 200, headers: { 'content-length': String(body.length) } })
          : new Response('not found', { status: 404 }),
      );
    }) as typeof fetch;
  }

  const install = (fakeFetch: typeof fetch, expectedSigners = ['Microsoft Windows'], exitCode = 0) =>
    installSignedInstaller({
      label: 'Vendor App 2.0',
      version: '2.0',
      installerUrl: `${BASE}${NAME}`,
      installerName: NAME,
      signatureUrl: `${BASE}${NAME}.asc`,
      keys: [key],
      threshold: 1,
      trustAnchors: 'test vendor key',
      expectedSigners,
      silentArguments: ['/S', '/currentuser'],
      installedExecutable: join(root, 'Programs', 'Vendor App', 'Vendor App.exe'),
      recordFile: join(root, 'records', 'vendor-app.json'),
      downloadsDirectory: join(root, 'downloads'),
      fetch: fakeFetch,
      runInstaller: (path, args) => {
        ran.push({ path, args });
        mkdirSync(join(root, 'Programs', 'Vendor App'), { recursive: true });
        writeFileSync(join(root, 'Programs', 'Vendor App', 'Vendor App.exe'), 'installed');
        return Promise.resolve(exitCode);
      },
    });

  it('runs the installer silently for this user only after both signatures check out, then records them', async () => {
    const record = await install(await release(readFileSync(SIGNED_EXECUTABLE), privateKey));
    expect(ran).toHaveLength(1);
    expect(ran[0]?.args).toEqual(['/S', '/currentuser']);
    expect(record.signatures.meetsThreshold).toBe(true);
    expect(record.authenticode).toMatchObject({ status: 'Valid' });
    expect((await readInstallerRecord(join(root, 'records', 'vendor-app.json')))?.version).toBe('2.0');
    // The installer is deleted once it has run.
    expect(existsSync(join(root, 'downloads', NAME))).toBe(false);
  });

  it('never runs an installer signed with another OpenPGP key', async () => {
    await expect(install(await release(readFileSync(SIGNED_EXECUTABLE), otherKey))).rejects.toThrow(
      /not valid for the pinned/,
    );
    expect(ran).toEqual([]);
    expect(existsSync(join(root, 'downloads', NAME))).toBe(false);
  });

  it('never runs an installer without the expected publisher’s Windows signature', async () => {
    // Correctly signed with OpenPGP, but not code-signed at all.
    await expect(install(await release(new TextEncoder().encode('MZ unsigned'), privateKey))).rejects.toThrow(
      /does not carry a valid Windows signature/,
    );
    // Code-signed, but by someone else.
    await expect(
      install(await release(readFileSync(SIGNED_EXECUTABLE), privateKey), ['SatoshiLabs, s.r.o.']),
    ).rejects.toBeInstanceOf(InstallationRejectedError);
    expect(ran).toEqual([]);
  });

  it('reports an installer that fails', async () => {
    await expect(
      install(await release(readFileSync(SIGNED_EXECUTABLE), privateKey), ['Microsoft Windows'], 2),
    ).rejects.toThrow(/stopped with exit code 2/);
    expect(await readInstallerRecord(join(root, 'records', 'vendor-app.json'))).toBeUndefined();
  });
});
