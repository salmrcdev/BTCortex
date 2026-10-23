import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { installVerifiedArchive, readVerificationRecord } from '@btcortex/installation-manager';
import type { InstallProgress, VerificationRecord } from '@btcortex/installation-manager';
import { releaseFiles } from './releases';
import {
  BITCOIN_CORE_CODE_SIGNER,
  BITCOIN_CORE_TRUST_ANCHORS,
  BITCOIN_CORE_TRUSTED_KEYS,
  DEFAULT_SIGNATURE_THRESHOLD,
} from './verification';

// Unattended Bitcoin Core installation from the official signed ZIP into a
// per-user, versioned runtime directory — no administrator rights, no PATH
// changes, no URI handlers (docs/research/notes/full-nodes-core.md §2.5).

export interface InstalledRuntime {
  version: string;
  directory: string;
  bitcoind: string;
  bitcoinCli: string;
  verification: VerificationRecord;
}

export interface InstallOptions {
  version: string;
  /** Parent of the versioned runtime directories. */
  runtimesDirectory: string;
  /** Where archives are cached (and resumed) while downloading. */
  downloadsDirectory: string;
  signatureThreshold?: number;
  /** Authenticode is defence in depth; disabled only in tests. */
  checkAuthenticode?: boolean;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** The 31.1 archive expands to well under 200 MiB; anything far larger is suspicious. */
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;

export function runtimeDirectory(runtimesDirectory: string, version: string): string {
  return join(runtimesDirectory, version);
}

function executables(directory: string, version: string) {
  const bin = join(directory, `bitcoin-${version}`, 'bin');
  return { bitcoind: join(bin, 'bitcoind.exe'), bitcoinCli: join(bin, 'bitcoin-cli.exe') };
}

/** Returns an already installed and verified runtime, if present. */
export async function findInstalledRuntime(
  runtimesDirectory: string,
  version: string,
): Promise<InstalledRuntime | undefined> {
  const directory = runtimeDirectory(runtimesDirectory, version);
  const verification = await readVerificationRecord(directory);
  const paths = executables(directory, version);
  if (!verification || !existsSync(paths.bitcoind) || !existsSync(paths.bitcoinCli)) return undefined;
  return { version, directory, ...paths, verification };
}

export async function installBitcoinCore(options: InstallOptions): Promise<InstalledRuntime> {
  const existing = await findInstalledRuntime(options.runtimesDirectory, options.version);
  if (existing) return existing;

  const files = releaseFiles(options.version);
  const destination = runtimeDirectory(options.runtimesDirectory, options.version);
  const { verification } = await installVerifiedArchive({
    source: {
      label: `Bitcoin Core ${options.version}`,
      version: options.version,
      manifestUrl: files.sums,
      signatureUrl: files.signatures,
      archiveUrl: files.windowsArchive,
      archiveName: files.windowsArchiveName,
      expectedRoot: `bitcoin-${options.version}`,
      requiredFiles: ['bin/bitcoind.exe', 'bin/bitcoin-cli.exe'],
    },
    keys: BITCOIN_CORE_TRUSTED_KEYS,
    threshold: options.signatureThreshold ?? DEFAULT_SIGNATURE_THRESHOLD,
    trustAnchors: BITCOIN_CORE_TRUST_ANCHORS,
    destination,
    downloadsDirectory: options.downloadsDirectory,
    maxExtractedBytes: MAX_EXTRACTED_BYTES,
    ...((options.checkAuthenticode ?? true)
      ? { authenticode: { mode: 'required' as const, expectedSigner: BITCOIN_CORE_CODE_SIGNER } }
      : {}),
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
