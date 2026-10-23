// Release locations and version rules for Bitcoin Knots (the bitcoin-knots
// research record; docs/research/notes/full-nodes-core.md §12). Versions read
// <Bitcoin Core base>.knots<date>, for example 29.4.2.knots20260508; since 29.4
// the base no longer matches a Bitcoin Core release.

export const RELEASE_BASE_URL = 'https://bitcoinknots.org/files/';

export interface KnotsVersion {
  text: string;
  major: number;
  minor: number;
  patch: number;
  /** The date in the version, for example 20260508. */
  stamp: string;
}

const VERSION = /^(\d+)\.(\d+)(?:\.(\d+))?\.knots(\d{8})$/;

export function parseKnotsVersion(text: string): KnotsVersion | undefined {
  const match = VERSION.exec(text.trim());
  if (!match) return undefined;
  return {
    text: text.trim(),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
    stamp: match[4] ?? '',
  };
}

export function compareKnotsVersions(a: KnotsVersion, b: KnotsVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || a.stamp.localeCompare(b.stamp);
}

/**
 * 29.4.1 and later enforce rules Bitcoin Core does not — the BIP110 softfork
 * and, from mainnet block 961,640, a BLAKE2b proof of work — so they follow a
 * different chain from Bitcoin Core's.
 */
export function followsDifferentChain(version: KnotsVersion): boolean {
  return (
    version.major > 29 || (version.major === 29 && (version.minor > 4 || (version.minor === 4 && version.patch >= 1)))
  );
}

export interface ReleaseFiles {
  directory: string;
  sums: string;
  signatures: string;
  /** The portable archive; the "pgpverifiable" builds carry no Authenticode signature. */
  windowsArchiveName: string;
  windowsArchive: string;
}

export function releaseFiles(version: string): ReleaseFiles {
  const parsed = parseKnotsVersion(version);
  if (!parsed) throw new Error(`"${version}" is not a Bitcoin Knots release version.`);
  const directory = `${RELEASE_BASE_URL}${String(parsed.major)}.x/${parsed.text}/`;
  const windowsArchiveName = `bitcoin-${parsed.text}-win64-pgpverifiable.zip`;
  return {
    directory,
    sums: `${directory}SHA256SUMS`,
    signatures: `${directory}SHA256SUMS.asc`,
    windowsArchiveName,
    windowsArchive: `${directory}${windowsArchiveName}`,
  };
}

/** The latest final release according to GitHub, which carries the tags; release candidates are never returned. */
export async function fetchLatestKnotsVersion(fetchImplementation: typeof fetch = fetch): Promise<string> {
  const response = await fetchImplementation('https://api.github.com/repos/bitcoinknots/bitcoin/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BTCortex' },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered HTTP ${String(response.status)} when asked for the latest Bitcoin Knots release.`);
  }
  const body = (await response.json()) as { tag_name?: unknown; prerelease?: unknown; draft?: unknown };
  const tag = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/, '') : '';
  const parsed = parseKnotsVersion(tag);
  if (!parsed || body.prerelease === true || body.draft === true) {
    throw new Error(`The latest GitHub release tag "${tag}" is not a final Bitcoin Knots release.`);
  }
  return parsed.text;
}
