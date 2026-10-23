// What a Bitcoin Core version means for security and for upgrades
// (docs/research/notes/full-nodes-core.md §10.7 and §11): the version-warning
// matrix, and what changes in the data directory when a node crosses a major
// version, so that the security centre and the update centre say the same.

export interface CoreVersion {
  major: number;
  minor: number;
}

/** "31.1" or "31.1.0" → { major: 31, minor: 1 }; undefined for anything else. */
export function parseCoreVersion(text: string | null | undefined): CoreVersion | undefined {
  const match = /^(\d+)\.(\d+)/.exec(text ?? '');
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : undefined;
}

/** From the number getnetworkinfo reports: 310100 → 31.1. */
export function coreVersionFromNumber(number: number): CoreVersion {
  return { major: Math.floor(number / 10_000), minor: Math.floor((number % 10_000) / 100) };
}

export function formatCoreVersion(version: CoreVersion): string {
  return `${String(version.major)}.${String(version.minor)}`;
}

/** The research's version-warning matrix; undefined when the version is fine. */
export function coreVersionRisk(
  version: CoreVersion,
): { severity: 'critical' | 'warning'; reason: string } | undefined {
  const text = formatCoreVersion(version);
  if (version.major < 25) {
    return {
      severity: 'critical',
      reason: `Bitcoin Core ${text} has reached its end of life and has publicly known high-severity flaws that let peers crash it.`,
    };
  }
  if (version.major < 29) {
    return {
      severity: 'warning',
      reason: `Bitcoin Core ${text} has reached its end of life and no longer receives security fixes.`,
    };
  }
  if (version.major === 30 && version.minor < 2) {
    return {
      severity: 'warning',
      reason: `Bitcoin Core ${text} was withdrawn: its wallet migration can delete wallet files.`,
    };
  }
  return undefined;
}

/** What changes for good when a node moves from one major version to a newer one. */
export function majorUpgradeNotes(from: CoreVersion, to: CoreVersion): string[] {
  const crosses = (major: number) => from.major < major && to.major >= major;
  const notes: string[] = [];
  if (to.major > from.major) {
    notes.push(
      `Bitcoin Core does not support going back from ${formatCoreVersion(to)} to ${formatCoreVersion(from)}: make a backup first.`,
    );
  }
  if (crosses(28))
    notes.push('From 28.0 the blocks folder is obfuscated with a key, so versions before 28.0 cannot read it.');
  if (crosses(30)) {
    notes.push(
      'From 30.0 legacy (BDB) wallets no longer load: migrate them with migratewallet first, but not with 30.0 or 30.1.',
      'From 30.0 the coin statistics index moves to indexes\\coinstatsindex; the old one is kept for a downgrade.',
    );
  }
  if (crosses(32)) {
    notes.push('From 32.0 the transaction index is rebuilt in a compact format, which older versions rebuild again.');
  }
  return notes;
}
