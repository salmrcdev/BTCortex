#!/usr/bin/env node
// Builds the in-app catalogue data (packages/catalogue/src/catalogue.generated.json)
// from the research records in docs/research/data. Only catalogue-eligible
// entries are kept, with the fields the catalogue shows.
//
//   node scripts/research/build-catalogue.mjs           # write the file
//   node scripts/research/build-catalogue.mjs --check   # fail if the file is out of date
//
// The output depends only on the records, so regenerating unchanged data
// produces an identical file.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = join(root, 'docs', 'research', 'data');
const output = join(root, 'packages', 'catalogue', 'src', 'catalogue.generated.json');

function project(record) {
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    purpose: record.purpose,
    website: record.website,
    repository: record.repository,
    maintenance: {
      status: record.maintenance.status,
      evidence: record.maintenance.evidence,
      supersededBy: record.maintenance.supersededBy,
    },
    latestStableRelease: record.latestStableRelease
      ? {
          version: record.latestStableRelease.version,
          date: record.latestStableRelease.date,
          source: record.latestStableRelease.source,
        }
      : null,
    verifiedOn: record.verifiedOn,
    platforms: {
      windowsNative: record.platforms.windowsNative,
      windowsVersions: record.platforms.windowsVersions,
      windowsArchitectures: record.platforms.windowsArchitectures,
      windowsDistribution: record.platforms.windowsDistribution,
      wsl2: record.platforms.wsl2,
      docker: record.platforms.docker,
    },
    dependencies: record.dependencies.map((dependency) => ({
      ids: dependency.ids,
      relationship: dependency.relationship,
      notes: dependency.notes,
    })),
    security: record.security,
    licence: record.licence,
    supportLevels: record.supportLevels,
    recommendedSupportLevel: record.recommendedSupportLevel,
    feasibility: record.feasibility.rating,
    priority: record.priority,
    sources: record.sources.map((source) => ({ title: source.title, url: source.url, accessed: source.accessed })),
  };
}

const records = readdirSync(dataDir)
  .filter((name) => name.endsWith('.json') && !name.startsWith('standards-'))
  .sort()
  .flatMap((name) => JSON.parse(readFileSync(join(dataDir, name), 'utf8')));

// Every record, eligible or not, keeps its name: dependencies refer to entries outside the catalogue too.
const catalogue = {
  entries: records
    .filter((record) => record.catalogueEligible)
    .map(project)
    .sort((a, b) => a.id.localeCompare(b.id, 'en')),
  names: Object.fromEntries(
    records.map((record) => [record.id, record.name]).sort(([a], [b]) => a.localeCompare(b, 'en')),
  ),
};
const text = `${JSON.stringify(catalogue, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(output, 'utf8');
  } catch {
    // Missing counts as out of date.
  }
  if (current.replace(/\r\n/g, '\n') !== text) {
    console.error(`${output} is out of date. Run: node scripts/research/build-catalogue.mjs`);
    process.exit(1);
  }
  console.log(`catalogue up to date (${String(catalogue.entries.length)} entries)`);
} else {
  writeFileSync(output, text);
  console.log(`wrote ${output} (${String(catalogue.entries.length)} entries)`);
}
