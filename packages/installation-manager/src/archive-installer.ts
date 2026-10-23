import { existsSync } from 'node:fs';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkAuthenticode, isTrustedSignature } from './authenticode';
import type { AuthenticodeResult } from './authenticode';
import { parseChecksumManifest } from './checksums';
import { downloadFile, fetchBytes, sha256File, sha256Hex } from './download';
import { extractZip } from './extract';
import { extractTarGz } from './extract-tar';
import { withInstallLock } from './install-lock';
import { verifyCleartextSignatures, verifyDetachedSignatures } from './openpgp';
import type { SignatureReport, TrustedKey } from './openpgp';
import { renameWhenReleased } from './rename';

// Verified installation of a portable release archive, ZIP or tar.gz
// (specification section 17.3): signed manifest (detached or clear-signed) →
// checksum → resumable download → optional signature over the archive itself
// → safe extraction → required files → checksums of files inside the archive
// when the manifest lists them → Authenticode → acceptance check →
// verification record → atomic activation. Every step fails closed; nothing
// is activated unless all checks pass.

export type InstallStage =
  | 'fetching-checksums'
  | 'verifying-signatures'
  | 'downloading'
  | 'extracting'
  | 'verifying-executables'
  | 'installing'
  | 'finalising';

export interface InstallProgress {
  stage: InstallStage;
  message: string;
  receivedBytes?: number;
  totalBytes?: number;
}

export interface VerifiedArchiveSource {
  /** Product and version for messages, for example `Bitcoin Core 31.1`. */
  label: string;
  version: string;
  manifestUrl: string;
  /**
   * `detached` (the default): `signatureUrl` holds the signatures over the
   * manifest. `cleartext`: the manifest itself is clear-signed, as HWI's is.
   */
  manifestFormat?: 'detached' | 'cleartext';
  /** Detached signatures over the manifest; required unless the manifest is clear-signed or `signatureUrls` is given. */
  signatureUrl?: string;
  /**
   * Detached signatures over the manifest in separate files, armoured or
   * binary, used instead of `signatureUrl` (LND publishes one file per release
   * signer).
   */
  signatureUrls?: readonly string[];
  archiveUrl: string;
  /** The archive's name exactly as the manifest lists it; it must contain the intended version. */
  archiveName: string;
  /** `zip` unless stated otherwise. */
  format?: 'zip' | 'tar.gz';
  /**
   * A detached signature over the archive itself, required in addition to the
   * signed checksums when the publisher provides one (the Tor Project does).
   */
  archiveSignatureUrl?: string;
  /**
   * Every archive entry must sit under this top-level folder, or under one of
   * these top-level folders or files (an archive without a folder, such as
   * HWI's, lists its files here).
   */
  expectedRoot: string | readonly string[];
  /**
   * Files that must be present, for example `bin/bitcoind.exe`: relative to
   * `expectedRoot` when it is one folder, otherwise to the installation folder.
   */
  requiredFiles: readonly string[];
  /**
   * Files in the archive BTCortex does not use and does not install (relative
   * like `requiredFiles`), such as a helper antivirus programs tend to flag.
   */
  skippedFiles?: readonly string[];
}

/**
 * `required`: executables must carry a valid signature from `expectedSigner`.
 * `recorded`: results are kept in the verification record but do not block
 * installation, for publishers whose code-signing practice is not established.
 */
export type AuthenticodePolicy = { mode: 'required'; expectedSigner: string } | { mode: 'recorded' };

export interface VerifiedArchiveOptions {
  source: VerifiedArchiveSource;
  keys: readonly TrustedKey[];
  threshold: number;
  /**
   * Signers (by key name) whose valid signature every release must carry,
   * besides the threshold: the maintainer who signs every Bitcoin Knots release.
   */
  requiredSigners?: readonly string[];
  /** Description of the trust anchors, recorded for audit (for example the pinned key set and commit). */
  trustAnchors: string;
  /** Final directory of this version; it must not exist yet. */
  destination: string;
  downloadsDirectory: string;
  maxExtractedBytes: number;
  authenticode?: AuthenticodePolicy;
  /**
   * Runs on the extracted, not yet activated installation (for example a
   * `--version` smoke test); throwing rejects the installation.
   */
  acceptanceCheck?: (directory: string) => Promise<void>;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface InstalledFile {
  /** Relative to the installation folder, with forward slashes. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface VerificationRecord {
  label: string;
  version: string;
  archive: { url: string; sha256: string; bytes: number };
  manifest: { url: string; sha256: string };
  signatures: SignatureReport;
  /** Signatures over the archive itself, when the publisher provides them. */
  archiveSignatures?: SignatureReport;
  authenticode: AuthenticodeResult[];
  trustAnchors: string;
  verifiedAt: string;
  /** Every extracted file as verified, so the installation can be checked later; absent in older records. */
  files?: InstalledFile[];
}

export interface IntegrityCheck {
  /** False for installations made before file hashes were recorded: they cannot be checked. */
  recorded: boolean;
  checked: number;
  missing: string[];
  changed: string[];
}

/** Compares an installation with the files recorded when it was verified. */
export async function checkInstalledFiles(directory: string, record: VerificationRecord): Promise<IntegrityCheck> {
  if (!record.files) return { recorded: false, checked: 0, missing: [], changed: [] };
  const missing: string[] = [];
  const changed: string[] = [];
  for (const file of record.files) {
    const path = join(directory, ...file.path.split('/'));
    if (!existsSync(path)) {
      missing.push(file.path);
      continue;
    }
    if ((await stat(path)).size !== file.bytes || (await sha256File(path)) !== file.sha256) changed.push(file.path);
  }
  return { recorded: true, checked: record.files.length, missing, changed };
}

export class InstallationRejectedError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'InstallationRejectedError';
  }
}

export const VERIFICATION_RECORD_FILE = 'btcortex-verification.json';

export async function readVerificationRecord(directory: string): Promise<VerificationRecord | undefined> {
  const path = join(directory, VERIFICATION_RECORD_FILE);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, 'utf8')) as VerificationRecord;
}

export interface VerifiedArchiveInstallation {
  directory: string;
  extractedFiles: string[];
  verification: VerificationRecord;
}

export function installVerifiedArchive(options: VerifiedArchiveOptions): Promise<VerifiedArchiveInstallation> {
  return withInstallLock(options.destination, async () => {
    // Another request for the same release may have finished while this one waited.
    const existing = await readVerificationRecord(options.destination);
    if (existing?.version === options.source.version) {
      return {
        directory: options.destination,
        extractedFiles: (existing.files ?? []).map((file) => file.path),
        verification: existing,
      };
    }
    return installAlone(options);
  });
}

async function installAlone(options: VerifiedArchiveOptions): Promise<VerifiedArchiveInstallation> {
  const { source } = options;
  const progress = (update: InstallProgress) => options.onProgress?.(update);
  const network = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
  if (!source.archiveName.includes(source.version)) {
    throw new InstallationRejectedError(
      `The archive name ${source.archiveName} does not contain version ${source.version}.`,
    );
  }

  progress({ stage: 'fetching-checksums', message: `Fetching the signed checksums for ${source.label}.` });
  const manifest = await fetchBytes(source.manifestUrl, network);
  const trust = { keys: options.keys, threshold: options.threshold };
  let report: SignatureReport;
  let manifestText: string;
  if (source.manifestFormat === 'cleartext') {
    progress({ stage: 'verifying-signatures', message: `Checking the signatures on the ${source.label} checksums.` });
    ({ report, text: manifestText } = await verifyCleartextSignatures(new TextDecoder().decode(manifest), trust));
  } else {
    const signatureUrls = source.signatureUrls ?? (source.signatureUrl === undefined ? [] : [source.signatureUrl]);
    if (signatureUrls.length === 0) {
      throw new InstallationRejectedError(`No signature is known for the ${source.label} checksums.`);
    }
    const signatures: Uint8Array[] = [];
    for (const url of signatureUrls) signatures.push(await fetchBytes(url, network));
    progress({ stage: 'verifying-signatures', message: `Checking the signatures on the ${source.label} checksums.` });
    report = await verifyDetachedSignatures(manifest, signatures, trust);
    manifestText = new TextDecoder().decode(manifest);
  }
  const signers = new Set(report.validSigners.map(({ signer }) => signer));
  if (!report.meetsThreshold) {
    throw new InstallationRejectedError(
      `Only ${String(report.signerCount)} trusted signers were found on the ${source.label} checksums; ${String(report.threshold)} are required.`,
      { validSigners: report.validSigners, results: report.results },
    );
  }
  const missingSigners = (options.requiredSigners ?? []).filter((name) => !signers.has(name));
  if (missingSigners.length > 0) {
    throw new InstallationRejectedError(
      `The ${source.label} checksums carry no valid signature from ${missingSigners.join(' or ')}, whose signature every release has.`,
      { validSigners: report.validSigners, results: report.results },
    );
  }

  const checksums = parseChecksumManifest(manifestText);
  const expectedSha256 = checksums.get(source.archiveName);
  if (!expectedSha256) throw new InstallationRejectedError(`The signed checksums do not list ${source.archiveName}.`);

  progress({ stage: 'downloading', message: `Downloading ${source.archiveName}.` });
  const archivePath = join(options.downloadsDirectory, source.archiveName);
  const downloaded = await downloadFile(source.archiveUrl, archivePath, {
    ...network,
    expectedSha256,
    onProgress: ({ receivedBytes, totalBytes }) => {
      progress({
        stage: 'downloading',
        message: `Downloading ${source.archiveName}.`,
        receivedBytes,
        ...(totalBytes === undefined ? {} : { totalBytes }),
      });
    },
  });

  let archiveSignatures: SignatureReport | undefined;
  if (source.archiveSignatureUrl) {
    progress({ stage: 'verifying-signatures', message: `Checking the signature on ${source.archiveName}.` });
    archiveSignatures = await verifyDetachedSignatures(
      await readFile(archivePath),
      new TextDecoder().decode(await fetchBytes(source.archiveSignatureUrl, network)),
      { keys: options.keys, threshold: options.threshold },
    );
    if (!archiveSignatures.meetsThreshold) {
      await rm(archivePath, { force: true });
      throw new InstallationRejectedError(
        `The signature on ${source.archiveName} is not valid for the pinned ${source.label} key.`,
        { results: archiveSignatures.results },
      );
    }
  }

  progress({ stage: 'extracting', message: 'Extracting the verified archive.' });
  const staging = `${options.destination}.partial`;
  await rm(staging, { recursive: true, force: true });
  try {
    return await activate(options, {
      staging,
      archivePath,
      checksums,
      report,
      manifest,
      downloaded,
      archiveSignatures,
    });
  } catch (error) {
    // Whatever failed, no half-extracted folder is left behind.
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** Extracts the verified archive into the staging folder, checks what came out and activates it. */
async function activate(
  options: VerifiedArchiveOptions,
  verified: {
    staging: string;
    archivePath: string;
    checksums: Map<string, string>;
    report: SignatureReport;
    manifest: Uint8Array;
    downloaded: { sha256: string; bytes: number };
    archiveSignatures: SignatureReport | undefined;
  },
): Promise<VerifiedArchiveInstallation> {
  const { source } = options;
  const { staging, archivePath, checksums, report, manifest, downloaded, archiveSignatures } = verified;
  const progress = (update: InstallProgress) => options.onProgress?.(update);
  const roots = typeof source.expectedRoot === 'string' ? [source.expectedRoot] : source.expectedRoot;
  const prefix = typeof source.expectedRoot === 'string' ? `${source.expectedRoot}/` : '';
  const skippedFiles = (source.skippedFiles ?? []).map((file) => `${prefix}${file}`);
  const extractedFiles =
    source.format === 'tar.gz'
      ? await extractTarGz(archivePath, staging, {
          allowedRoots: roots,
          maxTotalBytes: options.maxExtractedBytes,
          skippedFiles,
        })
      : await extractZip(archivePath, staging, {
          expectedRoot: source.expectedRoot,
          maxTotalBytes: options.maxExtractedBytes,
          skippedFiles,
        });
  const missing = source.requiredFiles.filter((file) => !extractedFiles.includes(`${prefix}${file}`));
  if (missing.length > 0) {
    await rm(staging, { recursive: true, force: true });
    throw new InstallationRejectedError(`The archive does not contain ${missing.join(', ')}.`);
  }

  let authenticode: AuthenticodeResult[] = [];
  if (options.authenticode) {
    progress({ stage: 'verifying-executables', message: 'Checking the Windows code signatures of the executables.' });
    const executables = extractedFiles
      .filter((file) => file.endsWith('.exe'))
      .map((file) => join(staging, ...file.split('/')));
    authenticode = await checkAuthenticode(executables);
    const policy = options.authenticode;
    if (policy.mode === 'required') {
      const untrusted = authenticode.filter((result) => !isTrustedSignature(result, policy.expectedSigner));
      if (untrusted.length > 0) {
        await rm(staging, { recursive: true, force: true });
        throw new InstallationRejectedError(
          `Some executables do not carry a valid ${policy.expectedSigner} code signature.`,
          {
            untrusted,
          },
        );
      }
    }
  }

  if (options.acceptanceCheck) {
    try {
      await options.acceptanceCheck(staging);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw new InstallationRejectedError(
        `${source.label} failed its check after extraction: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  progress({ stage: 'finalising', message: 'Recording the verification and activating the installation.' });
  // Hashes of what was verified, so a later check can tell whether anything was changed or removed.
  const files: InstalledFile[] = [];
  for (const file of extractedFiles) {
    const path = join(staging, ...file.split('/'));
    files.push({ path: file, sha256: await sha256File(path), bytes: (await stat(path)).size });
  }
  // Some publishers (HWI) also sign the hash of each file inside the archive.
  const mismatched = files.filter((file) => {
    const listed = checksums.get(`${source.archiveName}/${file.path}`);
    return listed !== undefined && listed !== file.sha256;
  });
  if (mismatched.length > 0) {
    await rm(staging, { recursive: true, force: true });
    throw new InstallationRejectedError(
      `Files inside ${source.archiveName} do not match the signed checksums: ${mismatched.map((file) => file.path).join(', ')}.`,
    );
  }
  const verification: VerificationRecord = {
    label: source.label,
    version: source.version,
    archive: { url: source.archiveUrl, sha256: downloaded.sha256, bytes: downloaded.bytes },
    manifest: { url: source.manifestUrl, sha256: sha256Hex(manifest) },
    signatures: report,
    ...(archiveSignatures ? { archiveSignatures } : {}),
    authenticode: authenticode.map((result) => ({
      ...result,
      file: result.file.replace(staging, options.destination),
    })),
    trustAnchors: options.trustAnchors,
    verifiedAt: (options.now ?? (() => new Date()))().toISOString(),
    files,
  };
  await writeFile(join(staging, VERIFICATION_RECORD_FILE), `${JSON.stringify(verification, null, 2)}\n`);
  await rm(options.destination, { recursive: true, force: true });
  await renameWhenReleased(staging, options.destination);
  // The verified archive is no longer needed once extracted.
  await rm(archivePath, { force: true });
  return { directory: options.destination, extractedFiles, verification };
}
