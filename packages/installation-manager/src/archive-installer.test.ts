import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as openpgp from 'openpgp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  checkInstalledFiles,
  installVerifiedArchive,
  InstallationRejectedError,
  readVerificationRecord,
} from './archive-installer';
import { sha256Hex } from './download';
import type { TrustedKey } from './openpgp';
import { buildTarGz } from './testing/tar-builder';
import { buildZip } from './testing/zip-builder';

// The whole verified installation, against an in-memory release server: a
// signed checksum manifest, a ZIP, and nothing reached over the network.

const BASE = 'https://releases.example.org/1.0/';
let key: TrustedKey;
let privateKey: openpgp.PrivateKey;

beforeAll(async () => {
  const generated = await openpgp.generateKey({
    type: 'ecc',
    curve: 'ed25519Legacy',
    userIDs: [{ name: 'Release signer', email: 'signer@example.org' }],
    format: 'object',
  });
  privateKey = generated.privateKey;
  key = {
    name: 'Release signer',
    fingerprints: [generated.publicKey.getFingerprint().toUpperCase()],
    armored: generated.publicKey.armor(),
  };
});

async function release(files: Record<string, string>) {
  const archive = buildZip(Object.entries(files).map(([name, data]) => ({ name, data })));
  const manifest = new TextEncoder().encode(`${sha256Hex(archive)}  example-1.0-win64.zip\n`);
  const signature: string = await openpgp.sign({
    message: await openpgp.createMessage({ binary: manifest }),
    signingKeys: privateKey,
    detached: true,
    format: 'armored',
  });
  const served: Record<string, Uint8Array> = {
    [`${BASE}SHA256SUMS`]: manifest,
    [`${BASE}SHA256SUMS.asc`]: new TextEncoder().encode(signature),
    [`${BASE}example-1.0-win64.zip`]: archive,
  };
  const fakeFetch = ((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = served[url];
    return Promise.resolve(
      body
        ? new Response(body, { status: 200, headers: { 'content-length': String(body.length) } })
        : new Response('not found', { status: 404 }),
    );
  }) as typeof fetch;
  return { fakeFetch };
}

describe('installVerifiedArchive', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-install-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const install = (fakeFetch: typeof fetch, requiredFiles = ['bin/tool.exe']) =>
    installVerifiedArchive({
      source: {
        label: 'Example 1.0',
        version: '1.0',
        manifestUrl: `${BASE}SHA256SUMS`,
        signatureUrl: `${BASE}SHA256SUMS.asc`,
        archiveUrl: `${BASE}example-1.0-win64.zip`,
        archiveName: 'example-1.0-win64.zip',
        expectedRoot: 'example-1.0',
        requiredFiles,
      },
      keys: [key],
      threshold: 1,
      trustAnchors: 'test signer',
      destination: join(root, 'installed', '1.0'),
      downloadsDirectory: root,
      maxExtractedBytes: 1024 * 1024,
      fetch: fakeFetch,
    });

  it('installs a signed release and records every file, so it can be checked later', async () => {
    const { fakeFetch } = await release({ 'example-1.0/bin/tool.exe': 'binary', 'example-1.0/README.txt': 'notes' });
    const { directory, verification } = await install(fakeFetch);
    expect(verification.signatures.meetsThreshold).toBe(true);
    expect(verification.files).toEqual([
      { path: 'example-1.0/bin/tool.exe', sha256: sha256Hex(Buffer.from('binary')), bytes: 6 },
      { path: 'example-1.0/README.txt', sha256: sha256Hex(Buffer.from('notes')), bytes: 5 },
    ]);
    const stored = await readVerificationRecord(directory);
    expect(stored?.files).toHaveLength(2);
    expect(await checkInstalledFiles(directory, verification)).toMatchObject({
      recorded: true,
      changed: [],
      missing: [],
    });

    writeFileSync(join(directory, 'example-1.0', 'bin', 'tool.exe'), 'patched');
    expect((await checkInstalledFiles(directory, verification)).changed).toEqual(['example-1.0/bin/tool.exe']);
    // The downloaded archive is gone once the release is installed.
    expect(() => readFileSync(join(root, 'example-1.0-win64.zip'))).toThrow();
  });

  it('refuses a release without the files it must contain, leaving nothing behind', async () => {
    const { fakeFetch } = await release({ 'example-1.0/README.txt': 'notes' });
    await expect(install(fakeFetch)).rejects.toBeInstanceOf(InstallationRejectedError);
    expect(await readVerificationRecord(join(root, 'installed', '1.0'))).toBeUndefined();
    expect(existsSync(join(root, 'installed', '1.0.partial'))).toBe(false);
  });

  it('removes the half-extracted folder whatever fails after extraction', async () => {
    const { fakeFetch } = await release({ 'example-1.0/bin/tool.exe': 'binary' });
    const failing = installVerifiedArchive({
      source: {
        label: 'Example 1.0',
        version: '1.0',
        manifestUrl: `${BASE}SHA256SUMS`,
        signatureUrl: `${BASE}SHA256SUMS.asc`,
        archiveUrl: `${BASE}example-1.0-win64.zip`,
        archiveName: 'example-1.0-win64.zip',
        expectedRoot: 'example-1.0',
        requiredFiles: ['bin/tool.exe'],
      },
      keys: [key],
      threshold: 1,
      trustAnchors: 'test signer',
      destination: join(root, 'installed', '1.0'),
      downloadsDirectory: root,
      maxExtractedBytes: 1024 * 1024,
      fetch: fakeFetch,
      // A failure that is not a rejection, after the files are out.
      now: () => {
        throw new Error('the clock failed');
      },
    });
    await expect(failing).rejects.toThrow('the clock failed');
    expect(existsSync(join(root, 'installed', '1.0.partial'))).toBe(false);
  });

  it('installs a release once when two requests for it come together', async () => {
    const { fakeFetch } = await release({ 'example-1.0/bin/tool.exe': 'binary' });
    let archiveRequests = 0;
    const counting = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('.zip')) archiveRequests += 1;
      return fakeFetch(input, init);
    }) as typeof fetch;
    const [first, second] = await Promise.all([install(counting), install(counting)]);
    expect(archiveRequests).toBe(1);
    expect(second.verification.verifiedAt).toBe(first.verification.verifiedAt);
    expect(await checkInstalledFiles(first.directory, first.verification)).toMatchObject({ changed: [], missing: [] });
  });

  it('collects binary signatures from one file per signer and needs the threshold of distinct signers', async () => {
    const second = await openpgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      userIDs: [{ name: 'Second signer', email: 'second@example.org' }],
      format: 'object',
    });
    const secondKey: TrustedKey = {
      name: 'Second signer',
      fingerprints: [second.publicKey.getFingerprint().toUpperCase()],
      armored: second.publicKey.armor(),
    };
    const archive = buildZip([{ name: 'example-1.0/bin/tool.exe', data: 'binary' }]);
    const manifest = new TextEncoder().encode(`${sha256Hex(archive)}  example-1.0-win64.zip`);
    const signBinary = async (signingKey: openpgp.PrivateKey): Promise<Uint8Array> => {
      const signature: Uint8Array = await openpgp.sign({
        message: await openpgp.createMessage({ binary: manifest }),
        signingKeys: signingKey,
        detached: true,
        format: 'binary',
      });
      return signature;
    };
    const served: Record<string, Uint8Array> = {
      [`${BASE}manifest-1.0.txt`]: manifest,
      [`${BASE}manifest-first-1.0.sig`]: await signBinary(privateKey),
      [`${BASE}manifest-second-1.0.sig`]: await signBinary(second.privateKey),
      [`${BASE}example-1.0-win64.zip`]: archive,
    };
    const fakeFetch = ((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = served[url];
      return Promise.resolve(body ? new Response(body, { status: 200 }) : new Response('not found', { status: 404 }));
    }) as typeof fetch;
    const installWith = (signatureUrls: string[], threshold: number, requiredSigners: string[] = []) =>
      installVerifiedArchive({
        source: {
          label: 'Example 1.0',
          version: '1.0',
          manifestUrl: `${BASE}manifest-1.0.txt`,
          signatureUrls,
          archiveUrl: `${BASE}example-1.0-win64.zip`,
          archiveName: 'example-1.0-win64.zip',
          expectedRoot: 'example-1.0',
          requiredFiles: ['bin/tool.exe'],
        },
        keys: [key, secondKey],
        threshold,
        requiredSigners,
        trustAnchors: 'test signers',
        destination: join(root, 'installed', '1.0'),
        downloadsDirectory: root,
        maxExtractedBytes: 1024 * 1024,
        fetch: fakeFetch,
      });

    const first = `${BASE}manifest-first-1.0.sig`;
    await expect(installWith([first], 2)).rejects.toThrow(/Only 1 trusted signers/);
    // Enough signers, but not the one every release must have.
    await expect(installWith([first], 1, ['Second signer'])).rejects.toThrow(/no valid signature from Second signer/);
    const { verification } = await installWith([first, `${BASE}manifest-second-1.0.sig`], 2);
    expect(verification.signatures.validSigners.map((signer) => signer.signer).sort()).toEqual([
      'Release signer',
      'Second signer',
    ]);
  });
});

describe('installVerifiedArchive with a signed tar.gz, the way the Tor Project publishes the Expert Bundle', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-install-tar-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const NAME = 'bundle-windows-x86_64-2.0.tar.gz';

  async function signedRelease(signArchiveWith: openpgp.PrivateKey) {
    const archive = buildTarGz([
      { name: 'tor/tor.exe', data: 'MZ tor' },
      { name: 'data/geoip', data: 'geo' },
    ]);
    const manifest = new TextEncoder().encode(`${sha256Hex(archive)}  ${NAME}\n`);
    const sign = async (data: Uint8Array, signingKey: openpgp.PrivateKey) => {
      const armored: string = await openpgp.sign({
        message: await openpgp.createMessage({ binary: data }),
        signingKeys: signingKey,
        detached: true,
        format: 'armored',
      });
      return new TextEncoder().encode(armored);
    };
    const served: Record<string, Uint8Array> = {
      [`${BASE}sha256sums-signed-build.txt`]: manifest,
      [`${BASE}sha256sums-signed-build.txt.asc`]: await sign(manifest, privateKey),
      [`${BASE}${NAME}`]: archive,
      [`${BASE}${NAME}.asc`]: await sign(archive, signArchiveWith),
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

  const install = (fakeFetch: typeof fetch, acceptanceCheck?: (directory: string) => Promise<void>) =>
    installVerifiedArchive({
      source: {
        label: 'Bundle 2.0',
        version: '2.0',
        manifestUrl: `${BASE}sha256sums-signed-build.txt`,
        signatureUrl: `${BASE}sha256sums-signed-build.txt.asc`,
        archiveUrl: `${BASE}${NAME}`,
        archiveSignatureUrl: `${BASE}${NAME}.asc`,
        archiveName: NAME,
        format: 'tar.gz',
        expectedRoot: ['data', 'docs', 'tor'],
        requiredFiles: ['tor/tor.exe', 'data/geoip'],
      },
      keys: [key],
      threshold: 1,
      trustAnchors: 'test signer',
      destination: join(root, 'installed', '2.0'),
      downloadsDirectory: root,
      maxExtractedBytes: 1024 * 1024,
      fetch: fakeFetch,
      ...(acceptanceCheck ? { acceptanceCheck } : {}),
    });

  it('checks the signature on the archive as well as the signed checksums, and runs the acceptance check before activating', async () => {
    const checked: string[] = [];
    const { directory, verification, extractedFiles } = await install(await signedRelease(privateKey), (staged) => {
      checked.push(readFileSync(join(staged, 'tor', 'tor.exe'), 'utf8'));
      return Promise.resolve();
    });
    expect(extractedFiles).toEqual(['tor/tor.exe', 'data/geoip']);
    expect(verification.archiveSignatures?.meetsThreshold).toBe(true);
    expect(checked).toEqual(['MZ tor']);
    expect(readFileSync(join(directory, 'data', 'geoip'), 'utf8')).toBe('geo');
  });

  it('refuses an archive signed by any other key, even when the checksum matches', async () => {
    const stranger = await openpgp.generateKey({
      type: 'ecc',
      curve: 'ed25519Legacy',
      userIDs: [{ name: 'Someone else' }],
      format: 'object',
    });
    await expect(install(await signedRelease(stranger.privateKey))).rejects.toThrow(/not valid for the pinned/);
    expect(await readVerificationRecord(join(root, 'installed', '2.0'))).toBeUndefined();
    expect(() => readFileSync(join(root, NAME))).toThrow();
  });

  it('activates nothing when the acceptance check fails', async () => {
    await expect(
      install(await signedRelease(privateKey), () => Promise.reject(new Error('tor.exe did not start'))),
    ).rejects.toThrow(/failed its check after extraction: tor.exe did not start/);
    expect(await readVerificationRecord(join(root, 'installed', '2.0'))).toBeUndefined();
    expect(() => readFileSync(join(root, 'installed', '2.0.partial', 'tor', 'tor.exe'))).toThrow();
  });
});

describe('installVerifiedArchive with clear-signed checksums and an archive without a folder, the way HWI publishes them', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-install-flat-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const NAME = 'tool-1.0-windows-x86_64.zip';

  async function clearSignedRelease(innerHash: (actual: string) => string = (actual) => actual) {
    const archive = buildZip([
      { name: 'tool.exe', data: 'MZ tool' },
      { name: 'tool-qt.exe', data: 'MZ tool with a window' },
    ]);
    const text = [
      `${sha256Hex(archive)}  ${NAME}`,
      `${innerHash(sha256Hex(Buffer.from('MZ tool')))}  ${NAME}/tool.exe`,
      `${sha256Hex(Buffer.from('MZ tool with a window'))}  ${NAME}/tool-qt.exe`,
      '',
    ].join('\n');
    const signed: string = await openpgp.sign({
      message: await openpgp.createCleartextMessage({ text }),
      signingKeys: privateKey,
      format: 'armored',
    });
    const served: Record<string, Uint8Array> = {
      [`${BASE}SHA256SUMS.txt.asc`]: new TextEncoder().encode(signed),
      [`${BASE}${NAME}`]: archive,
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

  const install = (fakeFetch: typeof fetch) =>
    installVerifiedArchive({
      source: {
        label: 'Tool 1.0',
        version: '1.0',
        manifestUrl: `${BASE}SHA256SUMS.txt.asc`,
        manifestFormat: 'cleartext',
        archiveUrl: `${BASE}${NAME}`,
        archiveName: NAME,
        expectedRoot: ['tool.exe', 'tool-qt.exe'],
        requiredFiles: ['tool.exe'],
      },
      keys: [key],
      threshold: 1,
      trustAnchors: 'test signer',
      destination: join(root, 'installed', '1.0'),
      downloadsDirectory: root,
      maxExtractedBytes: 1024 * 1024,
      fetch: fakeFetch,
    });

  it('trusts only the signed text, and checks the files inside the archive against it as well', async () => {
    const { directory, verification } = await install(await clearSignedRelease());
    expect(verification.signatures.meetsThreshold).toBe(true);
    expect(verification.files?.map((file) => file.path)).toEqual(['tool.exe', 'tool-qt.exe']);
    expect(readFileSync(join(directory, 'tool.exe'), 'utf8')).toBe('MZ tool');
  });

  it('refuses an archive whose inner file does not match its signed checksum', async () => {
    await expect(install(await clearSignedRelease(() => 'f'.repeat(64)))).rejects.toThrow(
      /Files inside tool-1.0-windows-x86_64.zip do not match the signed checksums: tool.exe/,
    );
    expect(await readVerificationRecord(join(root, 'installed', '1.0'))).toBeUndefined();
  });

  it('refuses a clear-signed manifest whose text was changed after signing', async () => {
    const genuine = await clearSignedRelease();
    const tampered = (async (input: string | URL | Request) => {
      const response = await genuine(input);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith('.asc')) return response;
      const text = (await response.text()).replace(/^[0-9a-f]{64}(?= {2}tool-1)/m, '0'.repeat(64));
      return new Response(text, { status: 200 });
    }) as typeof fetch;
    await expect(install(tampered)).rejects.toBeInstanceOf(InstallationRejectedError);
  });
});
