#!/usr/bin/env node
// Validates the research records against the contract in schema.mjs.
//
//   node scripts/research/validate.mjs                 validate every file
//   node scripts/research/validate.mjs <file> [...]    validate specific files
//
// File kind is inferred from the path: docs/research/tech-stack/*.json holds
// package records, data/standards-*.json holds standards, and every other
// data/*.json holds ecosystem entries. Cross-file checks (duplicate ids,
// dependencies on unknown ids) run only when every file is validated.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEntry, validatePackage, validateStandard } from './schema.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = join(root, 'docs', 'research', 'data');
const techStackDir = join(root, 'docs', 'research', 'tech-stack');

function listJson(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(dir, name));
}

function kindOf(file) {
  const normalised = resolve(file);
  if (dirname(normalised) === techStackDir) return 'package';
  if (basename(normalised).startsWith('standards-')) return 'standard';
  return 'entry';
}

const explicit = process.argv.slice(2).map((file) => resolve(file));
const files = explicit.length > 0 ? explicit : [...listJson(dataDir), ...listJson(techStackDir)];
const validateAll = explicit.length === 0;

const errors = [];
const warnings = [];
const entryIds = new Map();
const standardIds = new Map();
const dependencyRefs = [];
let recordCount = 0;

for (const file of files) {
  const label = relative(root, file);
  let records;
  try {
    records = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${label}: invalid JSON: ${error.message}`);
    continue;
  }
  if (!Array.isArray(records)) {
    errors.push(`${label}: top level must be an array`);
    continue;
  }

  const kind = kindOf(file);
  records.forEach((record, index) => {
    recordCount += 1;
    const recordLabel = `${label}[${index}${record && record.id ? ` ${record.id}` : record && record.name ? ` ${record.name}` : ''}]`;
    if (kind === 'package') {
      errors.push(...validatePackage(record, recordLabel));
      return;
    }
    if (kind === 'standard') {
      errors.push(...validateStandard(record, recordLabel));
      if (record && typeof record.id === 'string') {
        if (standardIds.has(record.id))
          errors.push(`${recordLabel}: duplicate standard id (also in ${standardIds.get(record.id)})`);
        else standardIds.set(record.id, label);
      }
      return;
    }
    errors.push(...validateEntry(record, recordLabel));
    if (record && typeof record.id === 'string') {
      if (entryIds.has(record.id))
        errors.push(`${recordLabel}: duplicate entry id (also in ${entryIds.get(record.id)})`);
      else entryIds.set(record.id, label);
    }
    if (record && Array.isArray(record.dependencies)) {
      for (const dependency of record.dependencies) {
        if (dependency && Array.isArray(dependency.ids)) {
          for (const id of dependency.ids) dependencyRefs.push({ from: recordLabel, id });
        }
      }
    }
  });
}

if (validateAll) {
  for (const ref of dependencyRefs) {
    if (!entryIds.has(ref.id)) warnings.push(`${ref.from}: depends on unknown id "${ref.id}"`);
  }
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
for (const error of errors) console.error(`error: ${error}`);
console.log(
  `${files.length} file(s), ${recordCount} record(s), ${errors.length} error(s), ${warnings.length} warning(s)`,
);
process.exit(errors.length > 0 ? 1 : 0);
