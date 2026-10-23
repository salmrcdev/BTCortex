import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  InstallationRejectedError,
  installSignedExecutable,
  readVerificationRecord,
} from '@btcortex/installation-manager';
import type { InstallProgress, TrustedKey, VerificationRecord } from '@btcortex/installation-manager';
import { ELECTRUM_SIGNING_KEYS } from './signing-keys.generated';

// Verified installation of the Electrum wallet
// (docs/research/notes/wallets-hardware.md §4.1–4.2): the standalone
// `electrum-<version>.exe`, which keeps its data in %APPDATA%\Electrum and
// needs no administrator rights. Every release carries five detached
// signatures in one `.asc`; BTCortex requires a valid one from ThomasV or
// SomberNight's release key, and Electrum Technologies GmbH's Windows
// signature. Electrum 4.9 plans to require Electrum protocol 1.7, which
// Fulcrum 2.1 does not speak, so only the 4.8 series is installed for now.

const DOWNLOADS = 'https://download.electrum.org';
const VERSION = /^\d+\.\d+\.\d+$/;

/** The newest series that works with the Electrum servers BTCortex runs (protocol 1.4 to 1.6). */
export const COMPATIBLE_ELECTRUM_SERIES = '4.8';
export const ELECTRUM_PUBLISHER = 'Electrum Technologies GmbH';

export const ELECTRUM_TRUSTED_KEYS: readonly TrustedKey[] = ELECTRUM_SIGNING_KEYS.map((key) => ({
  name: key.owner,
  armored: key.armored,
  fingerprints: [key.fingerprint],
}));

export function electrumReleaseFiles(version: string) {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not an Electrum release version.`);
  const executableName = `electrum-${version}.exe`;
  const executable = `${DOWNLOADS}/${version}/${executableName}`;
  return { executableName, executable, signature: `${executable}.asc` };
}

/** Whether Electrum servers that speak protocol 1.4 to 1.6 can serve this Electrum version. */
export function isCompatibleElectrumVersion(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  const [maxMajor = 0, maxMinor = 0] = COMPATIBLE_ELECTRUM_SERIES.split('.').map(Number);
  return major < maxMajor || (major === maxMajor && minor <= maxMinor);
}

/**
 * The newest release, from the file Electrum's own update check reads
 * (https://electrum.org/version). Only its version is used: the download is
 * verified by its signatures, not by this file.
 */
export async function fetchLatestElectrumVersion(fetchImplementation: typeof fetch = fetch): Promise<string> {
  const response = await fetchImplementation('https://electrum.org/version', {
    headers: { Accept: 'application/json', 'User-Agent': 'BTCortex' },
  });
  if (!response.ok) {
    throw new Error(`electrum.org answered HTTP ${String(response.status)} when asked for the latest release.`);
  }
  const body = (await response.json()) as { version?: unknown };
  const version = typeof body.version === 'string' ? body.version.trim() : '';
  if (!VERSION.test(version)) throw new Error(`electrum.org named "${version}" as the latest release.`);
  return version;
}

export interface ElectrumRuntime {
  version: string;
  directory: string;
  executable: string;
  verification: VerificationRecord;
}

export async function findInstalledElectrum(
  runtimesDirectory: string,
  version: string,
): Promise<ElectrumRuntime | undefined> {
  if (!VERSION.test(version)) return undefined;
  const directory = join(runtimesDirectory, version);
  const verification = await readVerificationRecord(directory);
  const executable = join(directory, electrumReleaseFiles(version).executableName);
  if (!verification || !existsSync(executable)) return undefined;
  return { version, directory, executable, verification };
}

/** Verified installations, newest first. */
export async function listInstalledElectrum(runtimesDirectory: string): Promise<ElectrumRuntime[]> {
  if (!existsSync(runtimesDirectory)) return [];
  const versions = (await readdir(runtimesDirectory))
    .filter((name) => VERSION.test(name))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  const runtimes: ElectrumRuntime[] = [];
  for (const version of versions) {
    const runtime = await findInstalledElectrum(runtimesDirectory, version);
    if (runtime) runtimes.push(runtime);
  }
  return runtimes;
}

export interface InstallElectrumOptions {
  version: string;
  /** Parent of the versioned Electrum folders. */
  runtimesDirectory: string;
  downloadsDirectory: string;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

/** Why BTCortex does not install this Electrum, or undefined when it does. */
export function electrumHeldReason(version: string): string | undefined {
  return isCompatibleElectrumVersion(version)
    ? undefined
    : `Electrum ${version} needs a newer Electrum protocol than BTCortex's Electrum servers offer, so BTCortex does not install it yet.`;
}

export async function installElectrum(options: InstallElectrumOptions): Promise<ElectrumRuntime> {
  const held = electrumHeldReason(options.version);
  if (held !== undefined) throw new InstallationRejectedError(held);
  const existing = await findInstalledElectrum(options.runtimesDirectory, options.version);
  if (existing) return existing;
  const files = electrumReleaseFiles(options.version);
  const { directory, executable, verification } = await installSignedExecutable({
    label: `Electrum ${options.version}`,
    version: options.version,
    executableUrl: files.executable,
    executableName: files.executableName,
    signatureUrl: files.signature,
    keys: ELECTRUM_TRUSTED_KEYS,
    threshold: 1,
    trustAnchors: `Electrum release keys: ${ELECTRUM_SIGNING_KEYS.map((key) => `${key.owner} ${key.fingerprint}`).join(', ')}`,
    expectedSigners: [ELECTRUM_PUBLISHER],
    destination: join(options.runtimesDirectory, options.version),
    downloadsDirectory: options.downloadsDirectory,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return { version: options.version, directory, executable, verification };
}
