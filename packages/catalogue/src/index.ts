import { z } from 'zod';
import { CatalogueRecordSchema } from '@btcortex/contracts';
import type { CatalogueRecord } from '@btcortex/contracts';
import data from './catalogue.generated.json' with { type: 'json' };

// The catalogue's research records, generated from docs/research by
// scripts/research/build-catalogue.mjs and checked against the shared schema
// as they load, so a malformed record fails at start-up rather than on screen.

const CatalogueDataSchema = z.object({
  entries: z.array(CatalogueRecordSchema),
  names: z.record(z.string(), z.string()),
});

const parsed = CatalogueDataSchema.parse(data);

export const CATALOGUE_RECORDS: readonly CatalogueRecord[] = parsed.entries;

/** Display names of every researched entry, including those outside the catalogue. */
export const ENTRY_NAMES: Readonly<Record<string, string>> = parsed.names;

export const RECORDS_BY_ID: ReadonlyMap<string, CatalogueRecord> = new Map(
  CATALOGUE_RECORDS.map((record) => [record.id, record]),
);

export * from './resolver';
