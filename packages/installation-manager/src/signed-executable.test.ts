import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as openpgp from 'openpgp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkInstalledFiles, InstallationRejectedError, readVerificationRecord } from './archive-installer';
import type { TrustedKey } from './openpgp';
import { installSignedExecutable } from './signed-executable';

// A standalone executable verified by detached OpenPGP signatures and its
// Windows code signature before it is kept. A copy of Windows' own
// whoami.exe stands in for it, because it carries a valid Authenticode
// signature; it is never run.

const BASE = 'https://download.example.org/4.8.2/';
const NAME = 'wallet-4.8.2.exe';
const SIGNED_EXECUTABLE = 'C:\\Windows\\System32\\whoami.exe';
const onWindows = process.platform === 'win32' && existsSync(SIGNED_EXECUTABLE);

let keys: TrustedKey[];
let first: openpgp.PrivateKey;
let second: openpgp.PrivateKey;
let stranger: openpgp.PrivateKey;

beforeAll(async () => {
  const generate = (name: string) =>
    openpgp.generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name }], format: 'object' });
  const [one, two, other] = await Promise.all([generate('First'), generate('Second'), generate('Stranger')]);
  first = one.privateKey;
  second = two.privateKey;
  stranger = other.privateKey;
  keys = [one, two].map((pair, index) => ({
    name: index === 0 ? 'First' : 'Second',
    fingerprints: [pair.publicKey.getFingerprint().toUpperCase()],
    armored: pair.publicKey.armor(),
  }));
});

describe.skipIf(!onWindows)('installSignedExecutable', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-signed-executable-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Serves the executable and its signatures, several armoured blocks in one file as Electrum publishes them. */
  async function release(executable: Uint8Array, signers: openpgp.PrivateKey[]) {
    const blocks: string[] = [];
    for (const signer of signers) {
      const signature: string = await openpgp.sign({
        message: await openpgp.createMessage({ binary: executable }),
        signingKeys: signer,
        detached: true,
        format: 'armored',
      });
      blocks.push(signature);
    }
    const served: Record<string, Uint8Array> = {
      [`${BASE}${NAME}`]: executable,
      [`${BASE}${NAME}.asc`]: new TextEncoder().encode(blocks.join('\n')),
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

  const install = (fakeFetch: typeof fetch, expectedSigners = ['Microsoft Windows']) =>
    installSignedExecutable({
      label: 'Wallet 4.8.2',
      version: '4.8.2',
      executableUrl: `${BASE}${NAME}`,
      executableName: NAME,
      signatureUrl: `${BASE}${NAME}.asc`,
      keys,
      threshold: 1,
      trustAnchors: 'test keys',
      expectedSigners,
      destination: join(root, 'apps', '4.8.2'),
      downloadsDirectory: join(root, 'downloads'),
      fetch: fakeFetch,
    });

  it('keeps the executable in its own folder, with a record that can be checked again', async () => {
    const result = await install(await release(readFileSync(SIGNED_EXECUTABLE), [stranger, first, second]));
    expect(result.executable).toBe(join(root, 'apps', '4.8.2', NAME));
    expect(readFileSync(result.executable)).toEqual(readFileSync(SIGNED_EXECUTABLE));
    // An unknown signer among them changes nothing; both pinned signers count.
    expect(result.verification.signatures.validSigners.map((signer) => signer.signer)).toEqual(['First', 'Second']);
    expect(result.verification.authenticode[0]).toMatchObject({ status: 'Valid' });
    const record = await readVerificationRecord(result.directory);
    expect(record?.files?.map((file) => file.path)).toEqual([NAME]);
    expect(record && (await checkInstalledFiles(result.directory, record))).toMatchObject({ missing: [], changed: [] });
    expect(readdirSync(join(root, 'downloads'))).toEqual([]);
  });

  it('keeps nothing signed only by unknown keys', async () => {
    await expect(install(await release(readFileSync(SIGNED_EXECUTABLE), [stranger]))).rejects.toThrow(
      /trusted signatures/,
    );
    expect(existsSync(join(root, 'apps', '4.8.2'))).toBe(false);
    expect(existsSync(join(root, 'downloads', NAME))).toBe(false);
  });

  it('keeps nothing without the expected publisher’s Windows signature', async () => {
    await expect(install(await release(new TextEncoder().encode('MZ unsigned'), [first]))).rejects.toThrow(
      /does not carry a valid Windows signature/,
    );
    await expect(
      install(await release(readFileSync(SIGNED_EXECUTABLE), [first]), ['Electrum Technologies GmbH']),
    ).rejects.toBeInstanceOf(InstallationRejectedError);
    expect(existsSync(join(root, 'apps', '4.8.2'))).toBe(false);
  });
});
