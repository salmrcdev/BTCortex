import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CatalogueRecord } from '@btcortex/contracts';
import { CATALOGUE_RECORDS, ENTRY_NAMES, RECORDS_BY_ID, resolveDependencies } from './index';

const root = resolve(import.meta.dirname, '..', '..', '..');

function record(id: string, dependencies: CatalogueRecord['dependencies']): CatalogueRecord {
  const base = CATALOGUE_RECORDS[0];
  if (!base) throw new Error('empty catalogue');
  return { ...base, id, name: id.toUpperCase(), dependencies };
}

describe('catalogue data', () => {
  it('is generated from the current research records', () => {
    // Fails with a non-zero exit code when the committed file is out of date.
    const output = execFileSync(
      process.execPath,
      [join(root, 'scripts', 'research', 'build-catalogue.mjs'), '--check'],
      {
        encoding: 'utf8',
      },
    );
    expect(output).toContain('catalogue up to date');
  });

  it('holds only catalogue-eligible entries, each with a target level among its feasible ones', () => {
    expect(CATALOGUE_RECORDS.length).toBeGreaterThan(50);
    expect(RECORDS_BY_ID.get('bitcoin-core')?.recommendedSupportLevel).toBe('fully-managed');
    for (const entry of CATALOGUE_RECORDS) {
      expect(entry.supportLevels, entry.id).toContain(entry.recommendedSupportLevel);
    }
    // Names cover dependencies outside the catalogue too.
    expect(ENTRY_NAMES['bitcoin-core']).toBe('Bitcoin Core');
  });
});

describe('resolveDependencies', () => {
  const records = new Map<string, CatalogueRecord>([
    ['core', record('core', [])],
    ['fulcrum', record('fulcrum', [{ ids: ['core'], relationship: 'requires', notes: 'Unpruned, txindex.' }])],
    ['electrs', record('electrs', [{ ids: ['core'], relationship: 'requires', notes: null }])],
    [
      'wallet',
      record('wallet', [
        { ids: ['fulcrum', 'electrs'], relationship: 'requires', notes: 'Any Electrum server.' },
        { ids: ['tor'], relationship: 'optional', notes: null },
        { ids: ['other-wallet'], relationship: 'conflicts', notes: 'Same port.' },
      ]),
    ],
    ['loop-a', record('loop-a', [{ ids: ['loop-b'], relationship: 'requires', notes: null }])],
    ['loop-b', record('loop-b', [{ ids: ['loop-a'], relationship: 'requires', notes: null }])],
  ]);
  const names = { core: 'Bitcoin Core', fulcrum: 'Fulcrum', tor: 'Tor' };

  it('orders the required chain, preferring what is already here', () => {
    const fresh = resolveDependencies('wallet', { records, names, present: new Set() });
    expect(fresh.missing).toEqual([['fulcrum', 'electrs']]);
    expect(fresh.order).toEqual(['core', 'fulcrum', 'wallet']);
    expect(fresh.checks[0]?.names).toEqual(['Fulcrum', 'electrs']);

    const withElectrs = resolveDependencies('wallet', { records, names, present: new Set(['core', 'electrs']) });
    expect(withElectrs.missing).toEqual([]);
    expect(withElectrs.order).toEqual(['core', 'electrs', 'wallet']);
    expect(withElectrs.checks[0]?.present).toEqual(['electrs']);
  });

  it('reports conflicting entries that are present', () => {
    const report = resolveDependencies('wallet', { records, names, present: new Set(['other-wallet']) });
    expect(report.conflicts).toEqual(['other-wallet']);
  });

  it('treats a device as something the user brings, not a step in the order', () => {
    const device = record('device', [{ ids: ['companion'], relationship: 'requires', notes: 'Set-up app.' }]);
    const withDevice = new Map(records)
      .set('device', { ...device, platforms: { ...device.platforms, windowsNative: 'not-applicable' } })
      .set('companion', record('companion', [{ ids: ['device'], relationship: 'requires', notes: null }]));
    expect(resolveDependencies('companion', { records: withDevice, names, present: new Set() })).toMatchObject({
      missing: [['device']],
      order: ['companion'],
      cycle: null,
    });
    expect(resolveDependencies('device', { records: withDevice, names, present: new Set() }).order).toEqual([
      'companion',
      'device',
    ]);
  });

  it('detects requirement loops instead of looping', () => {
    const report = resolveDependencies('loop-a', { records, names, present: new Set() });
    expect(report.cycle).toEqual(['loop-a', 'loop-b', 'loop-a']);
    expect(report.order).toEqual([]);
  });

  it('finds no loop in the real research data', () => {
    for (const entry of CATALOGUE_RECORDS) {
      const report = resolveDependencies(entry.id, { records: RECORDS_BY_ID, names: ENTRY_NAMES, present: new Set() });
      expect(report.cycle, entry.id).toBeNull();
      expect(report.order.at(-1), entry.id).toBe(entry.id);
    }
  });
});
