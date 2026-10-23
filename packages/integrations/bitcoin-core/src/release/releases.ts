// Release locations and version rules for Bitcoin Core
// (docs/research/notes/full-nodes-core.md §1, §2.2, §11).

export const RELEASE_BASE_URL = 'https://bitcoincore.org/bin/';

/** Releases whose binaries were withdrawn upstream (wallet deletion bug in 30.0 and 30.1). */
export const WITHDRAWN_VERSIONS: ReadonlySet<string> = new Set(['30.0', '30.1']);

/** Upstream maintains the latest three major versions. */
export const MAINTAINED_MAJOR_COUNT = 3;

export interface ReleaseVersion {
  text: string;
  major: number;
  minor: number;
  patch: number;
}

const VERSION = /^(\d+)\.(\d+)(?:\.(\d+))?$/;

export function parseReleaseVersion(text: string): ReleaseVersion | undefined {
  const match = VERSION.exec(text.trim());
  if (!match) return undefined;
  return { text: text.trim(), major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) };
}

export function compareVersions(a: ReleaseVersion, b: ReleaseVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export interface ReleaseFiles {
  directory: string;
  sums: string;
  signatures: string;
  windowsArchiveName: string;
  windowsArchive: string;
}

export function releaseFiles(version: string): ReleaseFiles {
  const parsed = parseReleaseVersion(version);
  if (!parsed) throw new Error(`"${version}" is not a final Bitcoin Core release version.`);
  if (WITHDRAWN_VERSIONS.has(parsed.text)) {
    throw new Error(`Bitcoin Core ${parsed.text} was withdrawn upstream and must not be installed.`);
  }
  const directory = `${RELEASE_BASE_URL}bitcoin-core-${parsed.text}/`;
  const windowsArchiveName = `bitcoin-${parsed.text}-win64.zip`;
  return {
    directory,
    sums: `${directory}SHA256SUMS`,
    signatures: `${directory}SHA256SUMS.asc`,
    windowsArchiveName,
    windowsArchive: `${directory}${windowsArchiveName}`,
  };
}

/**
 * Latest final release according to GitHub, which carries the tags (binaries
 * are only on bitcoincore.org). Release candidates are never returned.
 */
export async function fetchLatestReleaseVersion(fetchImplementation: typeof fetch = fetch): Promise<string> {
  const response = await fetchImplementation('https://api.github.com/repos/bitcoin/bitcoin/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BTCortex' },
  });
  if (!response.ok)
    throw new Error(`GitHub answered HTTP ${response.status} when asked for the latest Bitcoin Core release.`);
  const body = (await response.json()) as { tag_name?: unknown; prerelease?: unknown; draft?: unknown };
  const tag = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/, '') : '';
  const parsed = parseReleaseVersion(tag);
  if (!parsed || body.prerelease === true || body.draft === true) {
    throw new Error(`The latest GitHub release tag "${tag}" is not a final Bitcoin Core release.`);
  }
  if (WITHDRAWN_VERSIONS.has(parsed.text)) throw new Error(`The latest release ${parsed.text} is marked as withdrawn.`);
  return parsed.text;
}
