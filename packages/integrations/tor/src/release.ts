import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import * as openpgp from 'openpgp';
import { installVerifiedArchive, readVerificationRecord } from '@btcortex/installation-manager';
import type { InstallProgress, TrustedKey, VerificationRecord } from '@btcortex/installation-manager';
import { TOR_SIGNING_KEY } from './signing-key.generated';

// Verified installation of the Tor Expert Bundle, the Tor Project's standalone
// tor for Windows (docs/research/notes/privacy-networking.md §2.1–2.6). Both
// the signed checksum file and the archive's own signature must verify
// against the pinned Tor Browser Developers key. tor.exe is not code-signed,
// so Authenticode is recorded only, and the extracted tor must report its
// version before the installation is activated.

const execFileAsync = promisify(execFile);

const RELEASE_INFO = 'https://aus1.torproject.org/torbrowser/update_3/release/download-windows-x86_64.json';
/** dist.torproject.org keeps recent versions only; the archive keeps them all. */
const MIRRORS = [
  'https://dist.torproject.org/torbrowser/',
  'https://archive.torproject.org/tor-package-archive/torbrowser/',
] as const;
/** Stable releases only: alphas such as 16.0a14 do not match. */
const VERSION = /^\d+\.\d+(?:\.\d+)?$/;
/** 15.0.26 expands to about 74 MB. */
const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024;
const KEY_SOURCES = [
  {
    url: 'https://openpgpkey.torproject.org/.well-known/openpgpkey/torproject.org/hu/kounek7zrdx745qydx6p59t9mqjpuhdf',
    binary: true,
  },
  { url: `https://keys.openpgp.org/vks/v1/by-fingerprint/${TOR_SIGNING_KEY.fingerprint}`, binary: false },
] as const;

export const TOR_TRUSTED_KEYS: readonly TrustedKey[] = [
  { name: TOR_SIGNING_KEY.owner, armored: TOR_SIGNING_KEY.armored, fingerprints: [TOR_SIGNING_KEY.fingerprint] },
];

export function isTorBundleVersion(version: string): boolean {
  return VERSION.test(version);
}

/** Orders bundle versions numerically, newest first. */
export function compareTorVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function torReleaseFiles(version: string, mirror: string = MIRRORS[0]) {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a stable Tor Expert Bundle version.`);
  const base = `${mirror}${version}/`;
  const archiveName = `tor-expert-bundle-windows-x86_64-${version}.tar.gz`;
  return {
    manifest: `${base}sha256sums-signed-build.txt`,
    signature: `${base}sha256sums-signed-build.txt.asc`,
    archiveName,
    archive: `${base}${archiveName}`,
    archiveSignature: `${base}${archiveName}.asc`,
  };
}

/** The Expert Bundle version follows Tor Browser's stable release. */
export async function fetchLatestTorVersion(fetchImplementation: typeof fetch = fetch): Promise<string> {
  const response = await fetchImplementation(RELEASE_INFO);
  if (!response.ok) {
    throw new Error(`The Tor Project answered HTTP ${String(response.status)} when asked for the current release.`);
  }
  const body = (await response.json()) as { version?: unknown };
  const version = typeof body.version === 'string' ? body.version : '';
  if (!VERSION.test(version)) throw new Error(`The current Tor release "${version}" is not a stable version.`);
  return version;
}

/**
 * The pinned key with a fresh copy merged in: its new subkeys and signatures,
 * revocations included. A fresh copy kept beside the pinned one would not do,
 * because a subkey revoked only in the fresh copy would still verify through
 * the pinned one.
 */
export async function mergeFreshKey(pinnedArmored: string, fresh: openpgp.PublicKey): Promise<string> {
  const [pinned] = await openpgp.readKeys({ armoredKeys: pinnedArmored });
  return pinned ? (await pinned.update(fresh)).armor() : fresh.armor();
}

/**
 * The pinned key brought up to date from a fresh copy, because the Tor Project
 * rotates its signing subkeys. A copy is used only when its primary
 * fingerprint is the pinned one; when no source answers, the pinned copy
 * alone applies.
 */
export async function torTrustedKeys(fetchImplementation: typeof fetch = fetch): Promise<readonly TrustedKey[]> {
  for (const source of KEY_SOURCES) {
    try {
      const response = await fetchImplementation(source.url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) continue;
      const keys = source.binary
        ? await openpgp.readKeys({ binaryKeys: new Uint8Array(await response.arrayBuffer()) })
        : await openpgp.readKeys({ armoredKeys: await response.text() });
      const key = keys.find((candidate) => candidate.getFingerprint().toUpperCase() === TOR_SIGNING_KEY.fingerprint);
      if (key) {
        return [
          {
            name: TOR_SIGNING_KEY.owner,
            armored: await mergeFreshKey(TOR_SIGNING_KEY.armored, key),
            fingerprints: [TOR_SIGNING_KEY.fingerprint],
          },
        ];
      }
    } catch {
      // Try the next source; the pinned copy still applies.
    }
  }
  return TOR_TRUSTED_KEYS;
}

async function mirrorFor(version: string, fetchImplementation: typeof fetch): Promise<string> {
  for (const mirror of MIRRORS) {
    try {
      const response = await fetchImplementation(torReleaseFiles(version, mirror).manifest, {
        method: 'HEAD',
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return mirror;
    } catch {
      // Try the next mirror.
    }
  }
  return MIRRORS[0];
}

/** Runs `tor.exe --version` and returns tor's own version, for example `0.4.9.14`. */
export async function readTorVersion(executable: string): Promise<string> {
  const { stdout } = await execFileAsync(executable, ['--version'], {
    // The bundle root, as when tor runs for real.
    cwd: dirname(dirname(executable)),
    windowsHide: true,
    timeout: 30_000,
  });
  const match = /Tor version (\d+\.\d+\.\d+(?:\.\d+)?)/.exec(stdout);
  if (!match?.[1]) throw new Error(`tor.exe did not report its version (it printed "${stdout.slice(0, 120)}").`);
  return match[1];
}

export interface TorRuntime {
  /** The Expert Bundle version, which is also the folder name, for example `15.0.26`. */
  version: string;
  directory: string;
  executable: string;
  verification: VerificationRecord;
}

function runtimeAt(directory: string, version: string, verification: VerificationRecord): TorRuntime {
  return { version, directory, executable: join(directory, 'tor', 'tor.exe'), verification };
}

export async function findInstalledTor(runtimesDirectory: string, version: string): Promise<TorRuntime | undefined> {
  if (!VERSION.test(version)) return undefined;
  const directory = join(runtimesDirectory, version);
  const verification = await readVerificationRecord(directory);
  if (!verification) return undefined;
  const runtime = runtimeAt(directory, version, verification);
  const complete = [runtime.executable, join(directory, 'data', 'geoip'), join(directory, 'data', 'geoip6')].every(
    (path) => existsSync(path),
  );
  return complete ? runtime : undefined;
}

/** Verified installations, newest first. */
export async function listInstalledTor(runtimesDirectory: string): Promise<TorRuntime[]> {
  if (!existsSync(runtimesDirectory)) return [];
  const versions = (await readdir(runtimesDirectory)).filter((name) => VERSION.test(name)).sort(compareTorVersions);
  const runtimes: TorRuntime[] = [];
  for (const version of versions) {
    const runtime = await findInstalledTor(runtimesDirectory, version);
    if (runtime) runtimes.push(runtime);
  }
  return runtimes;
}

export interface InstallTorOptions {
  version: string;
  /** Parent of the versioned bundle folders. */
  runtimesDirectory: string;
  downloadsDirectory: string;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export async function installTor(options: InstallTorOptions): Promise<TorRuntime> {
  const existing = await findInstalledTor(options.runtimesDirectory, options.version);
  if (existing) return existing;
  const fetchImplementation = options.fetch ?? fetch;
  const files = torReleaseFiles(options.version, await mirrorFor(options.version, fetchImplementation));
  const keys = await torTrustedKeys(fetchImplementation);
  const destination = join(options.runtimesDirectory, options.version);
  const { verification } = await installVerifiedArchive({
    source: {
      label: `Tor Expert Bundle ${options.version}`,
      version: options.version,
      manifestUrl: files.manifest,
      signatureUrl: files.signature,
      archiveUrl: files.archive,
      archiveSignatureUrl: files.archiveSignature,
      archiveName: files.archiveName,
      format: 'tar.gz',
      expectedRoot: ['data', 'docs', 'tor'],
      requiredFiles: ['tor/tor.exe', 'data/geoip', 'data/geoip6'],
    },
    keys,
    threshold: 1,
    trustAnchors: `Tor Browser Developers signing key ${TOR_SIGNING_KEY.fingerprint} (pinned${keys === TOR_TRUSTED_KEYS ? '; no fresh copy could be fetched' : ', brought up to date from a fresh copy published by the Tor Project'})`,
    destination,
    downloadsDirectory: options.downloadsDirectory,
    maxExtractedBytes: MAX_EXTRACTED_BYTES,
    // tor.exe carries no Authenticode signature; the result is recorded only.
    authenticode: { mode: 'recorded' },
    acceptanceCheck: async (staged) => {
      await readTorVersion(join(staged, 'tor', 'tor.exe'));
    },
    fetch: fetchImplementation,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return runtimeAt(destination, options.version, verification);
}
