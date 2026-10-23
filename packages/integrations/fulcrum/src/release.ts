import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { installVerifiedArchive, readVerificationRecord } from '@btcortex/installation-manager';
import type { InstallProgress, TrustedKey, VerificationRecord } from '@btcortex/installation-manager';
import { FULCRUM_SIGNING_KEY } from './signing-key.generated';

// Verified installation of Fulcrum, the Electrum server
// (docs/research/notes/electrum-indexers-explorers.md §3.1): the portable
// Windows ZIP, whose hash is listed in Fulcrum-<version>-shasums.txt, signed
// by Calin Culianu's pinned key. That key is DSA-2048, which OpenPGP.js
// rejects by default; it is accepted for this one pinned key. Fulcrum's
// executables are not known to be code-signed, so Authenticode is recorded
// only. FulcrumAdmin.exe, a packed Python script antivirus programs have
// flagged (upstream issue #203), is not installed: BTCortex speaks the admin
// protocol itself. The extracted Fulcrum.exe must report its version before
// the installation is activated.

const execFileAsync = promisify(execFile);

const RELEASES = 'https://github.com/cculianu/Fulcrum/releases';
const VERSION = /^\d+\.\d+\.\d+$/;
/** 2.1.4 expands to about 37 MB. */
const MAX_EXTRACTED_BYTES = 160 * 1024 * 1024;

export const FULCRUM_TRUSTED_KEYS: readonly TrustedKey[] = [
  {
    name: FULCRUM_SIGNING_KEY.owner,
    armored: FULCRUM_SIGNING_KEY.armored,
    fingerprints: [FULCRUM_SIGNING_KEY.fingerprint],
    allowDsa: true,
  },
];

export function fulcrumReleaseFiles(version: string) {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a Fulcrum release version.`);
  const base = `${RELEASES}/download/v${version}/`;
  const archiveName = `Fulcrum-${version}-win64.zip`;
  const manifestName = `Fulcrum-${version}-shasums.txt`;
  return {
    manifest: `${base}${manifestName}`,
    signature: `${base}${manifestName}.asc`,
    archiveName,
    archive: `${base}${archiveName}`,
    /** The folder every file in the ZIP lives under. */
    root: `Fulcrum-${version}-win64`,
  };
}

export async function fetchLatestFulcrumVersion(fetchImplementation: typeof fetch = fetch): Promise<string> {
  const response = await fetchImplementation('https://api.github.com/repos/cculianu/Fulcrum/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BTCortex' },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered HTTP ${String(response.status)} when asked for the latest Fulcrum release.`);
  }
  const body = (await response.json()) as { tag_name?: unknown; prerelease?: unknown; draft?: unknown };
  const tag = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/, '') : '';
  if (!VERSION.test(tag) || body.prerelease === true || body.draft === true) {
    throw new Error(`The latest Fulcrum release tag "${tag}" is not a final release.`);
  }
  return tag;
}

/** `Fulcrum.exe --version` starts with "Fulcrum 2.1.4 (Release 02e22da9)". */
export function parseFulcrumVersion(output: string): string | undefined {
  return /^Fulcrum (\d+\.\d+\.\d+)\b/m.exec(output)?.[1];
}

export async function readFulcrumVersion(executable: string): Promise<string> {
  const { stdout } = await execFileAsync(executable, ['--version'], { windowsHide: true, timeout: 60_000 });
  const version = parseFulcrumVersion(stdout);
  if (!version) throw new Error(`Fulcrum.exe did not report its version (it printed "${stdout.slice(0, 120)}").`);
  return version;
}

export interface FulcrumRuntime {
  version: string;
  /** The versioned installation folder, which holds the verification record. */
  directory: string;
  executable: string;
  verification: VerificationRecord;
}

function executableIn(directory: string, version: string): string {
  return join(directory, fulcrumReleaseFiles(version).root, 'Fulcrum.exe');
}

export async function findInstalledFulcrum(
  runtimesDirectory: string,
  version: string,
): Promise<FulcrumRuntime | undefined> {
  if (!VERSION.test(version)) return undefined;
  const directory = join(runtimesDirectory, version);
  const verification = await readVerificationRecord(directory);
  const executable = executableIn(directory, version);
  if (!verification || !existsSync(executable)) return undefined;
  return { version, directory, executable, verification };
}

/** Verified installations, newest first. */
export async function listInstalledFulcrum(runtimesDirectory: string): Promise<FulcrumRuntime[]> {
  if (!existsSync(runtimesDirectory)) return [];
  const versions = (await readdir(runtimesDirectory))
    .filter((name) => VERSION.test(name))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  const runtimes: FulcrumRuntime[] = [];
  for (const version of versions) {
    const runtime = await findInstalledFulcrum(runtimesDirectory, version);
    if (runtime) runtimes.push(runtime);
  }
  return runtimes;
}

export interface InstallFulcrumOptions {
  version: string;
  /** Parent of the versioned Fulcrum folders. */
  runtimesDirectory: string;
  downloadsDirectory: string;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export async function installFulcrum(options: InstallFulcrumOptions): Promise<FulcrumRuntime> {
  const existing = await findInstalledFulcrum(options.runtimesDirectory, options.version);
  if (existing) return existing;
  const files = fulcrumReleaseFiles(options.version);
  const destination = join(options.runtimesDirectory, options.version);
  const { verification } = await installVerifiedArchive({
    source: {
      label: `Fulcrum ${options.version}`,
      version: options.version,
      manifestUrl: files.manifest,
      signatureUrl: files.signature,
      archiveUrl: files.archive,
      archiveName: files.archiveName,
      expectedRoot: files.root,
      requiredFiles: ['Fulcrum.exe'],
      skippedFiles: ['FulcrumAdmin.exe'],
    },
    keys: FULCRUM_TRUSTED_KEYS,
    threshold: 1,
    trustAnchors: `Fulcrum release key ${FULCRUM_SIGNING_KEY.fingerprint} (${FULCRUM_SIGNING_KEY.owner}, DSA-2048)`,
    destination,
    downloadsDirectory: options.downloadsDirectory,
    maxExtractedBytes: MAX_EXTRACTED_BYTES,
    authenticode: { mode: 'recorded' },
    acceptanceCheck: async (staged) => {
      const reported = await readFulcrumVersion(executableIn(staged, options.version));
      if (reported !== options.version) throw new Error(`Fulcrum.exe reports version ${reported}.`);
    },
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    version: options.version,
    directory: destination,
    executable: executableIn(destination, options.version),
    verification,
  };
}
