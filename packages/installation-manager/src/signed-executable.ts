import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkAuthenticode, isTrustedSignature } from './authenticode';
import { InstallationRejectedError, readVerificationRecord, VERIFICATION_RECORD_FILE } from './archive-installer';
import type { InstallProgress, VerificationRecord } from './archive-installer';
import { downloadFile, fetchBytes, sha256Hex } from './download';
import { withInstallLock } from './install-lock';
import { verifyDetachedSignatures } from './openpgp';
import type { TrustedKey } from './openpgp';
import { renameWhenReleased } from './rename';

// A program published as one standalone executable with a detached OpenPGP
// signature over it and no checksum file (Electrum's `electrum-<v>.exe`).
// The executable is kept only when the signature verifies against pinned keys
// and it carries the publisher's valid Windows signature; it then goes into
// its own versioned folder with the same verification record as an archive
// installation, so it can be listed, checked again and removed like one.

export interface SignedExecutableOptions {
  /** Product and version for messages, for example `Electrum 4.8.2`. */
  label: string;
  version: string;
  executableUrl: string;
  /** The file's name; it must contain the intended version. */
  executableName: string;
  /** Detached OpenPGP signatures over the executable. */
  signatureUrl: string;
  keys: readonly TrustedKey[];
  threshold: number;
  trustAnchors: string;
  /** The Authenticode certificate must name one of these publishers (`CN=…`). */
  expectedSigners: readonly string[];
  /** Final folder of this version; replaced only once everything has been verified. */
  destination: string;
  downloadsDirectory: string;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  now?: () => Date;
}

interface SignedExecutableInstallation {
  directory: string;
  executable: string;
  verification: VerificationRecord;
}

export function installSignedExecutable(options: SignedExecutableOptions): Promise<SignedExecutableInstallation> {
  return withInstallLock(options.destination, async () => {
    // Another request for the same release may have finished while this one waited.
    const existing = await readVerificationRecord(options.destination);
    if (existing?.version === options.version) {
      return {
        directory: options.destination,
        executable: join(options.destination, options.executableName),
        verification: existing,
      };
    }
    return installAlone(options);
  });
}

async function installAlone(options: SignedExecutableOptions): Promise<SignedExecutableInstallation> {
  const progress = (update: InstallProgress) => options.onProgress?.(update);
  const network = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
  if (!options.executableName.includes(options.version)) {
    throw new InstallationRejectedError(
      `The file name ${options.executableName} does not contain version ${options.version}.`,
    );
  }

  progress({ stage: 'downloading', message: `Downloading ${options.executableName}.` });
  const download = join(options.downloadsDirectory, options.executableName);
  const downloaded = await downloadFile(options.executableUrl, download, {
    ...network,
    onProgress: ({ receivedBytes, totalBytes }) => {
      progress({
        stage: 'downloading',
        message: `Downloading ${options.executableName}.`,
        receivedBytes,
        ...(totalBytes === undefined ? {} : { totalBytes }),
      });
    },
  });

  const staging = `${options.destination}.partial`;
  try {
    progress({ stage: 'verifying-signatures', message: `Checking the signatures on ${options.executableName}.` });
    const signatureBytes = await fetchBytes(options.signatureUrl, network);
    const signatures = await verifyDetachedSignatures(
      await readFile(download),
      new TextDecoder().decode(signatureBytes),
      { keys: options.keys, threshold: options.threshold },
    );
    if (!signatures.meetsThreshold) {
      throw new InstallationRejectedError(
        `Only ${String(signatures.validSigners.length)} trusted signatures were found on ${options.executableName}; ${String(signatures.threshold)} are required.`,
        { results: signatures.results },
      );
    }

    progress({
      stage: 'verifying-executables',
      message: `Checking the Windows code signature of ${options.executableName}.`,
    });
    const [authenticode] = await checkAuthenticode([download]);
    if (!authenticode || !options.expectedSigners.some((signer) => isTrustedSignature(authenticode, signer))) {
      throw new InstallationRejectedError(
        `${options.executableName} does not carry a valid Windows signature from ${options.expectedSigners.join(' or ')}.`,
        { authenticode },
      );
    }

    progress({ stage: 'finalising', message: 'Recording the verification and activating the installation.' });
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const staged = join(staging, options.executableName);
    await renameWhenReleased(download, staged);
    const verification: VerificationRecord = {
      label: options.label,
      version: options.version,
      archive: { url: options.executableUrl, sha256: downloaded.sha256, bytes: downloaded.bytes },
      manifest: { url: options.signatureUrl, sha256: sha256Hex(signatureBytes) },
      signatures,
      authenticode: [{ ...authenticode, file: join(options.destination, options.executableName) }],
      trustAnchors: options.trustAnchors,
      verifiedAt: (options.now ?? (() => new Date()))().toISOString(),
      files: [{ path: options.executableName, sha256: downloaded.sha256, bytes: (await stat(staged)).size }],
    };
    await writeFile(join(staging, VERIFICATION_RECORD_FILE), `${JSON.stringify(verification, null, 2)}\n`);
    await rm(options.destination, { recursive: true, force: true });
    await renameWhenReleased(staging, options.destination);
    return {
      directory: options.destination,
      executable: join(options.destination, options.executableName),
      verification,
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    // Verified and moved, or rejected: the download is not kept either way.
    await rm(download, { force: true });
  }
}
