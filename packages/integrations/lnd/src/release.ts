import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { installVerifiedArchive, readVerificationRecord } from '@btcortex/installation-manager';
import type { InstallProgress, TrustedKey, VerificationRecord } from '@btcortex/installation-manager';
import { LND_REQUIRED_SIGNATURES, LND_SIGNING_KEYS, LND_SIGNING_KEYS_TAG } from './signing-keys.generated';

// Verified installation of LND (docs/research/notes/lightning.md, section 2.1):
// the Windows ZIP, whose hash is listed in manifest-v<version>.txt. LND's
// release signers sign that manifest in separate binary files,
// manifest-<signer>-v<version>.sig, and, as LND's own verify-install.sh
// requires, signatures from at least five of the pinned keys are needed, each
// key counted once. LND's binaries are reproducible but not code-signed, so
// Authenticode is recorded only. lnd.exe must report its version before the
// installation is activated.

const execFileAsync = promisify(execFile);

const REPOSITORY = 'lightningnetwork/lnd';
const API = `https://api.github.com/repos/${REPOSITORY}`;
const DOWNLOADS = `https://github.com/${REPOSITORY}/releases/download/`;
const VERSION = /^\d+\.\d+\.\d+-beta$/;
/** 0.21.4 expands to about 120 MB. */
const MAX_EXTRACTED_BYTES = 400 * 1024 * 1024;

export const LND_TRUSTED_KEYS: readonly TrustedKey[] = LND_SIGNING_KEYS.map((key) => ({
  name: key.owner,
  armored: key.armored,
  fingerprints: [key.fingerprint],
}));

const SIGNERS = new Set<string>(LND_SIGNING_KEYS.map((key) => key.owner));

export function isLndVersion(version: string): boolean {
  return VERSION.test(version);
}

export interface LndRelease {
  /** For example `0.21.4-beta`. */
  version: string;
  manifestUrl: string;
  /** The signature files of pinned signers; other files are ignored, as they could not count. */
  signatureUrls: string[];
  archiveName: string;
  archiveUrl: string;
  /** The folder every file in the ZIP lives under. */
  root: string;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** The files of an LND release, from the assets GitHub lists for it. */
export function lndReleaseFromAssets(version: string, assets: readonly ReleaseAsset[]): LndRelease {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not an LND release version.`);
  const base = `${DOWNLOADS}v${version}/`;
  const url = (name: string) => {
    const asset = assets.find((candidate) => candidate.name === name);
    if (!asset) throw new Error(`LND ${version} does not publish ${name}.`);
    // Only files of this very release on GitHub, wherever the listing points.
    if (asset.browser_download_url !== `${base}${name}`) {
      throw new Error(`LND ${version} lists ${name} at an unexpected address.`);
    }
    return asset.browser_download_url;
  };
  const archiveName = `lnd-windows-amd64-v${version}.zip`;
  const suffix = `-v${version}.sig`;
  const signatureUrls = assets
    .filter((asset) => asset.name.startsWith('manifest-') && asset.name.endsWith(suffix))
    .filter((asset) => SIGNERS.has(asset.name.slice('manifest-'.length, -suffix.length)))
    .map((asset) => url(asset.name));
  if (signatureUrls.length < LND_REQUIRED_SIGNATURES) {
    throw new Error(
      `LND ${version} carries ${String(signatureUrls.length)} signatures from known signers; ${String(LND_REQUIRED_SIGNATURES)} are required.`,
    );
  }
  return {
    version,
    manifestUrl: url(`manifest-v${version}.txt`),
    signatureUrls,
    archiveName,
    archiveUrl: url(archiveName),
    root: `lnd-windows-amd64-v${version}`,
  };
}

/** The latest final release, or the given version. */
export async function fetchLndRelease(
  version?: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<LndRelease> {
  if (version !== undefined && !VERSION.test(version)) throw new Error(`"${version}" is not an LND release version.`);
  const response = await fetchImplementation(
    version === undefined ? `${API}/releases/latest` : `${API}/releases/tags/v${version}`,
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BTCortex' } },
  );
  if (!response.ok) {
    throw new Error(`GitHub answered HTTP ${String(response.status)} when asked for the LND release.`);
  }
  const body = (await response.json()) as {
    tag_name?: unknown;
    prerelease?: unknown;
    draft?: unknown;
    assets?: unknown;
  };
  const tag = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/, '') : '';
  if (!VERSION.test(tag) || body.prerelease === true || body.draft === true) {
    throw new Error(`The LND release "${tag}" is not a final release.`);
  }
  const assets = Array.isArray(body.assets)
    ? body.assets.filter(
        (asset): asset is ReleaseAsset =>
          typeof (asset as Partial<ReleaseAsset>).name === 'string' &&
          typeof (asset as Partial<ReleaseAsset>).browser_download_url === 'string',
      )
    : [];
  return lndReleaseFromAssets(tag, assets);
}

/** `lnd --version` prints "lnd version 0.21.4-beta commit=v0.21.4-beta". */
export function parseLndVersion(output: string): string | undefined {
  return /\blnd version (\d+\.\d+\.\d+-beta)\b/.exec(output)?.[1];
}

export async function readLndVersion(executable: string): Promise<string> {
  const { stdout } = await execFileAsync(executable, ['--version'], { windowsHide: true, timeout: 60_000 });
  const version = parseLndVersion(stdout);
  if (!version) throw new Error(`lnd.exe did not report its version (it printed "${stdout.slice(0, 120)}").`);
  return version;
}

export interface LndRuntime {
  version: string;
  /** The versioned installation folder, which holds the verification record. */
  directory: string;
  lnd: string;
  lncli: string;
  verification: VerificationRecord;
}

function runtimeIn(directory: string, version: string): Pick<LndRuntime, 'lnd' | 'lncli'> {
  const folder = join(directory, `lnd-windows-amd64-v${version}`);
  return { lnd: join(folder, 'lnd.exe'), lncli: join(folder, 'lncli.exe') };
}

export async function findInstalledLnd(runtimesDirectory: string, version: string): Promise<LndRuntime | undefined> {
  if (!VERSION.test(version)) return undefined;
  const directory = join(runtimesDirectory, version);
  const verification = await readVerificationRecord(directory);
  const files = runtimeIn(directory, version);
  if (!verification || !existsSync(files.lnd) || !existsSync(files.lncli)) return undefined;
  return { version, directory, ...files, verification };
}

/** Verified installations, newest first. */
export async function listInstalledLnd(runtimesDirectory: string): Promise<LndRuntime[]> {
  if (!existsSync(runtimesDirectory)) return [];
  const versions = (await readdir(runtimesDirectory))
    .filter((name) => VERSION.test(name))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  const runtimes: LndRuntime[] = [];
  for (const version of versions) {
    const runtime = await findInstalledLnd(runtimesDirectory, version);
    if (runtime) runtimes.push(runtime);
  }
  return runtimes;
}

export interface InstallLndOptions {
  release: LndRelease;
  /** Parent of the versioned LND folders. */
  runtimesDirectory: string;
  downloadsDirectory: string;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export async function installLnd(options: InstallLndOptions): Promise<LndRuntime> {
  const { release } = options;
  const existing = await findInstalledLnd(options.runtimesDirectory, release.version);
  if (existing) return existing;
  const destination = join(options.runtimesDirectory, release.version);
  const { verification } = await installVerifiedArchive({
    source: {
      label: `LND ${release.version}`,
      version: release.version,
      manifestUrl: release.manifestUrl,
      signatureUrls: release.signatureUrls,
      archiveUrl: release.archiveUrl,
      archiveName: release.archiveName,
      expectedRoot: release.root,
      requiredFiles: ['lnd.exe', 'lncli.exe'],
    },
    keys: LND_TRUSTED_KEYS,
    threshold: LND_REQUIRED_SIGNATURES,
    trustAnchors: `${String(LND_REQUIRED_SIGNATURES)} of the ${String(LND_SIGNING_KEYS.length)} LND release keys listed in scripts/verify-install.sh at ${LND_SIGNING_KEYS_TAG}`,
    destination,
    downloadsDirectory: options.downloadsDirectory,
    maxExtractedBytes: MAX_EXTRACTED_BYTES,
    authenticode: { mode: 'recorded' },
    acceptanceCheck: async (staged) => {
      const reported = await readLndVersion(runtimeIn(staged, release.version).lnd);
      if (reported !== release.version) throw new Error(`lnd.exe reports version ${reported}.`);
    },
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return { version: release.version, directory: destination, ...runtimeIn(destination, release.version), verification };
}
