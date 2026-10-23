import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { installVerifiedArchive, readVerificationRecord } from '@btcortex/installation-manager';
import type { InstallProgress, TrustedKey, VerificationRecord } from '@btcortex/installation-manager';
import { HWI_SIGNING_KEY } from './signing-key.generated';

// Verified installation of HWI, Bitcoin Core's Hardware Wallet Interface
// (docs/research/notes/wallets-hardware.md §5.1): the portable Windows ZIP,
// whose clear-signed SHA256SUMS.txt.asc must carry a valid signature from Ava
// Chow's pinned key and also lists the hash of each executable inside the
// ZIP. HWI's executables are not known to be code-signed, so Authenticode is
// recorded only. The extracted hwi.exe must report its version before the
// installation is activated.

const execFileAsync = promisify(execFile);

const RELEASES = 'https://github.com/bitcoin-core/HWI/releases';
const VERSION = /^\d+\.\d+\.\d+$/;
/** 3.2.0 expands to about 61 MB. */
const MAX_EXTRACTED_BYTES = 192 * 1024 * 1024;

export const HWI_TRUSTED_KEYS: readonly TrustedKey[] = [
  { name: HWI_SIGNING_KEY.owner, armored: HWI_SIGNING_KEY.armored, fingerprints: [HWI_SIGNING_KEY.fingerprint] },
];

export function hwiReleaseFiles(version: string) {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not an HWI release version.`);
  const base = `${RELEASES}/download/${version}/`;
  const archiveName = `hwi-${version}-windows-x86_64.zip`;
  return { manifest: `${base}SHA256SUMS.txt.asc`, archiveName, archive: `${base}${archiveName}` };
}

export async function fetchLatestHwiVersion(fetchImplementation: typeof fetch = fetch): Promise<string> {
  const response = await fetchImplementation('https://api.github.com/repos/bitcoin-core/HWI/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BTCortex' },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered HTTP ${String(response.status)} when asked for the latest HWI release.`);
  }
  const body = (await response.json()) as { tag_name?: unknown; prerelease?: unknown; draft?: unknown };
  const tag = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/, '') : '';
  if (!VERSION.test(tag) || body.prerelease === true || body.draft === true) {
    throw new Error(`The latest HWI release tag "${tag}" is not a final release.`);
  }
  return tag;
}

/** `hwi --version` prints the program name and version. */
export async function readHwiVersion(executable: string): Promise<string> {
  const { stdout } = await execFileAsync(executable, ['--version'], { windowsHide: true, timeout: 60_000 });
  // argparse prints the program name: `hwi.exe 3.2.0` on Windows.
  const match = /hwi(?:\.exe)? (\d+\.\d+\.\d+)/.exec(stdout);
  if (!match?.[1]) throw new Error(`hwi.exe did not report its version (it printed "${stdout.slice(0, 120)}").`);
  return match[1];
}

export interface HwiRuntime {
  version: string;
  directory: string;
  executable: string;
  verification: VerificationRecord;
}

export async function findInstalledHwi(runtimesDirectory: string, version: string): Promise<HwiRuntime | undefined> {
  if (!VERSION.test(version)) return undefined;
  const directory = join(runtimesDirectory, version);
  const verification = await readVerificationRecord(directory);
  const executable = join(directory, 'hwi.exe');
  if (!verification || !existsSync(executable)) return undefined;
  return { version, directory, executable, verification };
}

/** Verified installations, newest first. */
export async function listInstalledHwi(runtimesDirectory: string): Promise<HwiRuntime[]> {
  if (!existsSync(runtimesDirectory)) return [];
  const versions = (await readdir(runtimesDirectory))
    .filter((name) => VERSION.test(name))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  const runtimes: HwiRuntime[] = [];
  for (const version of versions) {
    const runtime = await findInstalledHwi(runtimesDirectory, version);
    if (runtime) runtimes.push(runtime);
  }
  return runtimes;
}

export interface InstallHwiOptions {
  version: string;
  /** Parent of the versioned HWI folders. */
  runtimesDirectory: string;
  downloadsDirectory: string;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export async function installHwi(options: InstallHwiOptions): Promise<HwiRuntime> {
  const existing = await findInstalledHwi(options.runtimesDirectory, options.version);
  if (existing) return existing;
  const files = hwiReleaseFiles(options.version);
  const destination = join(options.runtimesDirectory, options.version);
  const { verification } = await installVerifiedArchive({
    source: {
      label: `HWI ${options.version}`,
      version: options.version,
      manifestUrl: files.manifest,
      manifestFormat: 'cleartext',
      archiveUrl: files.archive,
      archiveName: files.archiveName,
      // The ZIP holds the two executables directly, without a folder.
      expectedRoot: ['hwi.exe', 'hwi-qt.exe'],
      requiredFiles: ['hwi.exe'],
    },
    keys: HWI_TRUSTED_KEYS,
    threshold: 1,
    trustAnchors: `HWI release key ${HWI_SIGNING_KEY.fingerprint} (${HWI_SIGNING_KEY.owner}), expires ${HWI_SIGNING_KEY.expires}`,
    destination,
    downloadsDirectory: options.downloadsDirectory,
    maxExtractedBytes: MAX_EXTRACTED_BYTES,
    authenticode: { mode: 'recorded' },
    acceptanceCheck: async (staged) => {
      const reported = await readHwiVersion(join(staged, 'hwi.exe'));
      if (reported !== options.version) throw new Error(`hwi.exe reports version ${reported}.`);
    },
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return { version: options.version, directory: destination, executable: join(destination, 'hwi.exe'), verification };
}
