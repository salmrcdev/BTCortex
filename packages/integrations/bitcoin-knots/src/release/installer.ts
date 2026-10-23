import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { installVerifiedArchive, readVerificationRecord } from '@btcortex/installation-manager';
import type { InstallProgress, VerificationRecord } from '@btcortex/installation-manager';
import { compareKnotsVersions, parseKnotsVersion, releaseFiles } from './releases';
import {
  BITCOIN_KNOTS_TRUST_ANCHORS,
  BITCOIN_KNOTS_TRUSTED_KEYS,
  DEFAULT_SIGNATURE_THRESHOLD,
  RELEASE_MAINTAINER,
} from './verification';

// Unattended Bitcoin Knots installation from the signed portable ZIP into a
// per-user, versioned runtime directory of its own, never Bitcoin Core's:
// no administrator rights, no PATH changes, no URI handlers. The NSIS
// installer is never used, because it installs into Bitcoin Core's folder.

const execFileAsync = promisify(execFile);

export interface InstalledKnotsRuntime {
  version: string;
  directory: string;
  bitcoind: string;
  bitcoinCli: string;
  verification: VerificationRecord;
}

export interface KnotsInstallOptions {
  version: string;
  /** Parent of the versioned runtime directories. */
  runtimesDirectory: string;
  /** Where archives are cached (and resumed) while downloading. */
  downloadsDirectory: string;
  signatureThreshold?: number;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** The 29.4.2 archive expands to well under 200 MiB; anything far larger is suspicious. */
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;

export function knotsRuntimeDirectory(runtimesDirectory: string, version: string): string {
  return join(runtimesDirectory, version);
}

function executables(directory: string, version: string) {
  const bin = join(directory, `bitcoin-${version}`, 'bin');
  return { bitcoind: join(bin, 'bitcoind.exe'), bitcoinCli: join(bin, 'bitcoin-cli.exe') };
}

/** Returns an already installed and verified runtime, if present. */
export async function findInstalledKnots(
  runtimesDirectory: string,
  version: string,
): Promise<InstalledKnotsRuntime | undefined> {
  const directory = knotsRuntimeDirectory(runtimesDirectory, version);
  const verification = await readVerificationRecord(directory);
  const paths = executables(directory, version);
  if (!verification || !existsSync(paths.bitcoind) || !existsSync(paths.bitcoinCli)) return undefined;
  return { version, directory, ...paths, verification };
}

/** Installed and verified runtimes, newest first. */
export async function listInstalledKnots(runtimesDirectory: string): Promise<InstalledKnotsRuntime[]> {
  const names = await readdir(runtimesDirectory).catch(() => []);
  const versions = names
    .map((name) => parseKnotsVersion(name))
    .filter((version) => version !== undefined)
    .sort((a, b) => compareKnotsVersions(b, a));
  const runtimes: InstalledKnotsRuntime[] = [];
  for (const version of versions) {
    const runtime = await findInstalledKnots(runtimesDirectory, version.text);
    if (runtime) runtimes.push(runtime);
  }
  return runtimes;
}

/**
 * The arguments that make bitcoind print its version without touching any
 * data directory of the user's: even for -version (and -help), bitcoind reads
 * the configuration of its data directory and writes settings.json there,
 * which for the default one is %APPDATA%\Bitcoin.
 */
export function versionCheckArguments(emptyDataDirectory: string): string[] {
  return [`-datadir=${emptyDataDirectory}`, '-nosettings', '-version'];
}

/** The extracted bitcoind must run and call itself Bitcoin Knots of this version. */
async function acceptKnots(directory: string, version: string): Promise<void> {
  const { bitcoind } = executables(directory, version);
  const scratch = await mkdtemp(join(tmpdir(), 'btcortex-knots-version-'));
  try {
    const { stdout } = await execFileAsync(bitcoind, versionCheckArguments(scratch), {
      windowsHide: true,
      timeout: 60_000,
    });
    const firstLine = stdout.split(/\r?\n/)[0] ?? '';
    if (!/Knots/i.test(firstLine) || !firstLine.includes(version)) {
      throw new Error(`The extracted bitcoind reports "${firstLine}", not Bitcoin Knots ${version}.`);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function installBitcoinKnots(options: KnotsInstallOptions): Promise<InstalledKnotsRuntime> {
  const existing = await findInstalledKnots(options.runtimesDirectory, options.version);
  if (existing) return existing;

  const files = releaseFiles(options.version);
  const destination = knotsRuntimeDirectory(options.runtimesDirectory, options.version);
  const { verification } = await installVerifiedArchive({
    source: {
      label: `Bitcoin Knots ${options.version}`,
      version: options.version,
      manifestUrl: files.sums,
      signatureUrl: files.signatures,
      archiveUrl: files.windowsArchive,
      archiveName: files.windowsArchiveName,
      expectedRoot: `bitcoin-${options.version}`,
      requiredFiles: ['bin/bitcoind.exe', 'bin/bitcoin-cli.exe'],
    },
    keys: BITCOIN_KNOTS_TRUSTED_KEYS,
    threshold: options.signatureThreshold ?? DEFAULT_SIGNATURE_THRESHOLD,
    requiredSigners: [RELEASE_MAINTAINER],
    trustAnchors: BITCOIN_KNOTS_TRUST_ANCHORS,
    destination,
    downloadsDirectory: options.downloadsDirectory,
    maxExtractedBytes: MAX_EXTRACTED_BYTES,
    // The "pgpverifiable" builds are not code-signed: the result is recorded only.
    authenticode: { mode: 'recorded' },
    acceptanceCheck: (directory) => acceptKnots(directory, options.version),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    version: options.version,
    directory: destination,
    ...executables(destination, options.version),
    verification,
  };
}
