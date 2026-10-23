import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { checkAuthenticode, isTrustedSignature } from './authenticode';
import type { AuthenticodeResult } from './authenticode';
import { InstallationRejectedError } from './archive-installer';
import type { InstallProgress } from './archive-installer';
import { downloadFile, fetchBytes } from './download';
import { verifyDetachedSignatures } from './openpgp';
import type { SignatureReport, TrustedKey } from './openpgp';

// A vendor's own installer, for applications that ship no portable archive
// (Trezor Suite). Without a checksum file, trust comes from the detached
// OpenPGP signature over the installer itself, checked against a pinned key,
// and the installer must also carry the publisher's valid Windows signature.
// Only then is it run, unattended and for the current user only, so Windows
// asks for no administrator rights. Nothing runs unless both checks pass.

export interface SignedInstallerOptions {
  /** Product and version for messages, for example `Trezor Suite 26.10.2`. */
  label: string;
  version: string;
  installerUrl: string;
  /** The installer's file name; it must contain the intended version. */
  installerName: string;
  /** Detached OpenPGP signature over the installer. */
  signatureUrl: string;
  keys: readonly TrustedKey[];
  threshold: number;
  trustAnchors: string;
  /** The installer's Authenticode certificate must name one of these publishers (`CN=…`). */
  expectedSigners: readonly string[];
  /** Arguments for an unattended installation for the current user. */
  silentArguments: readonly string[];
  /** The program the installation must produce. */
  installedExecutable: string;
  /** Where the verification record is written. */
  recordFile: string;
  downloadsDirectory: string;
  /** How long the installer may run. */
  timeoutMs?: number;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Replaced in tests: runs the verified installer and resolves with its exit code. */
  runInstaller?: (path: string, args: readonly string[], timeoutMs: number) => Promise<number | null>;
}

export interface InstallerRecord {
  label: string;
  version: string;
  installer: { url: string; sha256: string; bytes: number };
  signatures: SignatureReport;
  authenticode: AuthenticodeResult;
  trustAnchors: string;
  installedExecutable: string;
  installedAt: string;
}

function runInstallerProcess(path: string, args: readonly string[], timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, [...args], { windowsHide: true, stdio: 'ignore', shell: false });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('The installer did not finish in time.'));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

export async function installSignedInstaller(options: SignedInstallerOptions): Promise<InstallerRecord> {
  const progress = (update: InstallProgress) => options.onProgress?.(update);
  const network = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
  if (!options.installerName.includes(options.version)) {
    throw new InstallationRejectedError(
      `The installer name ${options.installerName} does not contain version ${options.version}.`,
    );
  }

  progress({ stage: 'downloading', message: `Downloading ${options.installerName}.` });
  const path = join(options.downloadsDirectory, options.installerName);
  const downloaded = await downloadFile(options.installerUrl, path, {
    ...network,
    onProgress: ({ receivedBytes, totalBytes }) => {
      progress({
        stage: 'downloading',
        message: `Downloading ${options.installerName}.`,
        receivedBytes,
        ...(totalBytes === undefined ? {} : { totalBytes }),
      });
    },
  });

  try {
    progress({ stage: 'verifying-signatures', message: `Checking the signature on ${options.installerName}.` });
    const signatures = await verifyDetachedSignatures(
      await readFile(path),
      new TextDecoder().decode(await fetchBytes(options.signatureUrl, network)),
      { keys: options.keys, threshold: options.threshold },
    );
    if (!signatures.meetsThreshold) {
      throw new InstallationRejectedError(
        `The signature on ${options.installerName} is not valid for the pinned ${options.label} key.`,
        { results: signatures.results },
      );
    }

    progress({ stage: 'verifying-executables', message: 'Checking the Windows code signature of the installer.' });
    const [authenticode] = await checkAuthenticode([path]);
    if (!authenticode || !options.expectedSigners.some((signer) => isTrustedSignature(authenticode, signer))) {
      throw new InstallationRejectedError(
        `${options.installerName} does not carry a valid Windows signature from ${options.expectedSigners.join(' or ')}.`,
        { authenticode },
      );
    }

    progress({ stage: 'installing', message: `Installing ${options.label} for this Windows user.` });
    const timeoutMs = options.timeoutMs ?? 10 * 60_000;
    const exitCode = await (options.runInstaller ?? runInstallerProcess)(path, options.silentArguments, timeoutMs);
    if (exitCode !== 0) {
      throw new InstallationRejectedError(`The ${options.label} installer stopped with exit code ${String(exitCode)}.`);
    }
    if (!existsSync(options.installedExecutable)) {
      throw new InstallationRejectedError(
        `The ${options.label} installer finished, but ${options.installedExecutable} is not there.`,
      );
    }

    progress({ stage: 'finalising', message: 'Recording the verification.' });
    const record: InstallerRecord = {
      label: options.label,
      version: options.version,
      installer: { url: options.installerUrl, sha256: downloaded.sha256, bytes: downloaded.bytes },
      signatures,
      authenticode,
      trustAnchors: options.trustAnchors,
      installedExecutable: options.installedExecutable,
      installedAt: (options.now ?? (() => new Date()))().toISOString(),
    };
    await mkdir(dirname(options.recordFile), { recursive: true });
    await writeFile(options.recordFile, `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally {
    // Verified or not, the installer is not needed any more.
    await rm(path, { force: true });
  }
}

export async function readInstallerRecord(recordFile: string): Promise<InstallerRecord | undefined> {
  if (!existsSync(recordFile)) return undefined;
  return JSON.parse(await readFile(recordFile, 'utf8')) as InstallerRecord;
}
