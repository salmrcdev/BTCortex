import type { CatalogueRecord, DependencyCheck, DependencyReport } from '@btcortex/contracts';

// Dependency resolution for the catalogue (specification section 17.2): which
// requirements are met by what is on this computer, which conflicting entries
// are present, and in which order the required chain would have to be set up.
// A group of several ids means that any one of them satisfies it; for the
// order, the one already present is preferred, otherwise the first listed.

export interface ResolverInput {
  /** Catalogue records by id. Dependencies may name entries outside the catalogue. */
  records: ReadonlyMap<string, CatalogueRecord>;
  /** Display names of every researched entry, inside the catalogue or not. */
  names: Readonly<Record<string, string>>;
  /** Entries present on this computer now: installed, found already there, or running. */
  present: ReadonlySet<string>;
}

/** Software that runs on a computer; hardware, hosted services and specifications are "not applicable". */
function installable(id: string, input: ResolverInput): boolean {
  return input.records.get(id)?.platforms.windowsNative !== 'not-applicable';
}

export function resolveDependencies(id: string, input: ResolverInput): DependencyReport {
  const record = input.records.get(id);
  const checks: DependencyCheck[] = (record?.dependencies ?? []).map((dependency) => ({
    relationship: dependency.relationship,
    ids: dependency.ids,
    names: dependency.ids.map((candidate) => input.names[candidate] ?? candidate),
    notes: dependency.notes,
    present: dependency.ids.filter((candidate) => input.present.has(candidate)),
  }));
  const missing = checks
    .filter((check) => check.relationship === 'requires' && check.present.length === 0)
    .map((check) => check.ids);
  const conflicts = [
    ...new Set(checks.filter((check) => check.relationship === 'conflicts').flatMap((check) => check.present)),
  ];

  const order: string[] = [];
  const done = new Set<string>();
  const path: string[] = [];
  // Set inside visit(); declared through a cast so the compiler does not narrow it to null for good.
  let cycle = null as string[] | null;
  const visit = (current: string) => {
    if (cycle !== null || done.has(current)) return;
    const seen = path.indexOf(current);
    if (seen !== -1) {
      cycle = [...path.slice(seen), current];
      return;
    }
    path.push(current);
    for (const dependency of input.records.get(current)?.dependencies ?? []) {
      if (dependency.relationship !== 'requires') continue;
      const chosen = dependency.ids.find((candidate) => input.present.has(candidate)) ?? dependency.ids[0];
      // A device or a hosted service is something the user brings, not a step to set up: a signing
      // device and its companion app require each other without that being an installation loop.
      if (chosen !== undefined && installable(chosen, input)) visit(chosen);
    }
    path.pop();
    done.add(current);
    order.push(current);
  };
  visit(id);

  return { checks, missing, conflicts, order: cycle === null ? order : [], cycle };
}
