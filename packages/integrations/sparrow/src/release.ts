import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { installVerifiedArchive, readVerificationRecord } from '@btcortex/installation-manager';
import type { InstallProgress, TrustedKey, VerificationRecord } from '@btcortex/installation-manager';
import { SPARROW_SIGNING_KEY } from './signing-key.generated';

// Verified installation of Sparrow from its portable ZIP, which brings its own
// Java runtime and needs no installer, registry entries or URI handlers
// (docs/research/notes/wallets-hardware.md §3.1–3.2). The release manifest is
// signed by Craig Raw; the key is pinned by fingerprint.

const RELEASES = 'https://github.com/sparrowwallet/sparrow/releases';
const VERSION = /^\d+\.\d+\.\d+$/;
/** The 2.5.5 ZIP expands to about 119 MiB. */
const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;

export const SPARROW_TRUSTED_KEYS: readonly TrustedKey[] = [
  {
    name: SPARROW_SIGNING_KEY.owner,
    armored: SPARROW_SIGNING_KEY.armored,
    fingerprints: [SPARROW_SIGNING_KEY.fingerprint],
  },
];

export interface SparrowRuntime {
  version: string;
  directory: string;
  executable: string;
  verification: VerificationRecord;
}

export function sparrowReleaseFiles(version: string) {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a Sparrow release version.`);
  const base = `${RELEASES}/download/${version}/`;
  return {
    manifest: `${base}sparrow-${version}-manifest.txt`,
    signature: `${base}sparrow-${version}-manifest.txt.asc`,
    archiveName: `Sparrow-${version}.zip`,
    archive: `${base}Sparrow-${version}.zip`,
  };
}

export async function fetchLatestSparrowVersion(fetchImplementation: typeof fetch = fetch): Promise<string> {
  const response = await fetchImplementation('https://api.github.com/repos/sparrowwallet/sparrow/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BTCortex' },
  });
  if (!response.ok)
    throw new Error(`GitHub answered HTTP ${response.status} when asked for the latest Sparrow release.`);
  const body = (await response.json()) as { tag_name?: unknown; prerelease?: unknown; draft?: unknown };
  const tag = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/, '') : '';
  if (!VERSION.test(tag) || body.prerelease === true || body.draft === true) {
    throw new Error(`The latest Sparrow release tag "${tag}" is not a final release.`);
  }
  return tag;
}

function executableIn(directory: string): string {
  return join(directory, 'Sparrow', 'Sparrow.exe');
}

export async function findInstalledSparrow(
  appsDirectory: string,
  version: string,
): Promise<SparrowRuntime | undefined> {
  const directory = join(appsDirectory, version);
  const verification = await readVerificationRecord(directory);
  const executable = executableIn(directory);
  if (!verification || !existsSync(executable)) return undefined;
  return { version, directory, executable, verification };
}

export interface InstallSparrowOptions {
  version: string;
  /** Parent of the versioned Sparrow directories. */
  appsDirectory: string;
  downloadsDirectory: string;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export async function installSparrow(options: InstallSparrowOptions): Promise<SparrowRuntime> {
  const existing = await findInstalledSparrow(options.appsDirectory, options.version);
  if (existing) return existing;
  const files = sparrowReleaseFiles(options.version);
  const destination = join(options.appsDirectory, options.version);
  const { verification } = await installVerifiedArchive({
    source: {
      label: `Sparrow ${options.version}`,
      version: options.version,
      manifestUrl: files.manifest,
      signatureUrl: files.signature,
      archiveUrl: files.archive,
      archiveName: files.archiveName,
      expectedRoot: 'Sparrow',
      requiredFiles: ['Sparrow.exe'],
    },
    keys: SPARROW_TRUSTED_KEYS,
    threshold: 1,
    trustAnchors: `Sparrow release key ${SPARROW_SIGNING_KEY.fingerprint} (${SPARROW_SIGNING_KEY.owner}), expires ${SPARROW_SIGNING_KEY.expires}`,
    destination,
    downloadsDirectory: options.downloadsDirectory,
    maxExtractedBytes: MAX_EXTRACTED_BYTES,
    // Whether Sparrow's executables are code-signed is not established; the result is recorded only.
    authenticode: { mode: 'recorded' },
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return { version: options.version, directory: destination, executable: executableIn(destination), verification };
}
