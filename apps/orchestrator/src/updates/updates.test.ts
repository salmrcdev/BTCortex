import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BackupSettings, InstalledSoftware, NodeWithStatus, SoftwareUpdate, TorStatus } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { openDatabase } from '../persistence/database';
import { migrations } from '../persistence/migrations';
import { SettingsStore } from '../persistence/settings';
import { majorUpgradeNotes } from '../nodes/version-risk';
import { compareVersions, UpdateService } from './update-service';

let root: string;
let database: DatabaseSync;
const logger = new StructuredLogger([new MemorySink()], 'debug');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'btcortex-updates-'));
  database = openDatabase({ file: join(root, 'test.db'), migrations, logger });
});

afterEach(() => {
  database.close();
  rmSync(root, { recursive: true, force: true });
});

const installed = (product: InstalledSoftware['product'], version: string) =>
  ({ product, version }) as InstalledSoftware;

function setUp(world: { latest: Partial<Record<string, string | null>>; torStatus?: string }) {
  const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
  let checks = 0;
  const node = {
    profile: {
      id: 'n1',
      name: 'Main node',
      network: 'mainnet',
      execution: 'managed',
      runtimeVersion: '30.1',
    },
    status: { nodeId: 'n1', state: 'running', checkedAt: '2026-10-23T08:00:00.000Z' },
  } as unknown as NodeWithStatus;
  const service = new UpdateService({
    settings: new SettingsStore(database),
    installations: {
      list: () =>
        Promise.resolve([
          installed('bitcoin-core', '30.1'),
          installed('bitcoin-core', '31.0'),
          installed('tor', '15.0.26'),
          installed('sparrow', '2.3.0'),
        ]),
      checkUpdates: () => {
        checks += 1;
        return Promise.resolve(
          (['bitcoin-core', 'sparrow', 'tor', 'hwi', 'fulcrum', 'electrum'] as const).map(
            (product): SoftwareUpdate => ({
              product,
              installed: null,
              latest: world.latest[product] ?? null,
              updateAvailable: false,
              checkedAt: clock.now.toISOString(),
            }),
          ),
        );
      },
    },
    nodes: () => [node],
    tor: () => Promise.resolve({ versionStatus: world.torStatus ?? 'recommended' } as TorStatus),
    backups: (): BackupSettings => ({
      destination: 'E:\\Backups',
      retention: 10,
      schedule: { everyHours: 24, encrypted: false },
      passphraseStored: false,
      lastRun: {
        at: '2026-10-22T08:00:00.000Z',
        trigger: 'scheduled',
        outcome: 'succeeded',
        path: 'E:\\x',
        skipped: [],
      },
    }),
    version: '0.1.0',
    logger,
    now: () => clock.now,
  });
  return { service, clock, checks: () => checks };
}

describe('update centre', () => {
  it('compares what is installed with the latest releases and what the nodes run', async () => {
    const { service, checks } = setUp({ latest: { 'bitcoin-core': '31.1', sparrow: '2.3.0', tor: '15.0.26' } });
    const before = await service.overview(false);
    expect(before.checkedAt).toBeNull();
    expect(before.components.find((component) => component.product === 'bitcoin-core')?.state).toBe('unknown');
    const overview = await service.overview(true);
    expect(checks()).toBe(1);
    expect(overview.checkedAt).toBe('2026-10-23T08:00:00.000Z');
    const component = (product: string) => overview.components.find((entry) => entry.product === product);
    expect(component('bitcoin-core')).toMatchObject({
      installed: ['31.0', '30.1'],
      latest: '31.1',
      state: 'available',
      releaseNotes: 'https://bitcoincore.org/en/releases/31.1/',
      security: {
        severity: 'warning',
        reason: 'Bitcoin Core 30.1 was withdrawn: its wallet migration can delete wallet files.',
      },
    });
    expect(component('sparrow')?.state).toBe('current');
    expect(component('hwi')?.state).toBe('not-installed');
    expect(overview.nodes).toEqual([
      {
        nodeId: 'n1',
        name: 'Main node',
        network: 'mainnet',
        implementation: 'bitcoin-core',
        managed: true,
        version: '30.1',
        newer: '31.0',
        security: {
          severity: 'warning',
          reason: 'Bitcoin Core 30.1 was withdrawn: its wallet migration can delete wallet files.',
        },
        notes: ['Bitcoin Core does not support going back from 31.0 to 30.1: make a backup first.'],
      },
    ]);
    expect(overview.lastBackupAt).toBe('2026-10-22T08:00:00.000Z');
    expect(overview.btcortex.detail).toMatch(/does not update itself yet/);
  });

  it('defers updates for a while or for a version, but keeps security updates pending', async () => {
    const { service, clock } = setUp({ latest: { 'bitcoin-core': '31.1', sparrow: '2.4.0' }, torStatus: 'obsolete' });
    await service.overview(true);
    expect((await service.pending()).map((update) => update.product).sort()).toEqual(['bitcoin-core', 'sparrow']);
    service.defer('sparrow', '2.4.0', 7);
    service.defer('bitcoin-core', '31.1', null);
    const pending = await service.pending();
    // Bitcoin Core matters for security here, so deferring it does not silence it.
    expect(pending.map((update) => update.product)).toEqual(['bitcoin-core']);
    const overview = await service.overview(false);
    expect(overview.components.find((entry) => entry.product === 'sparrow')?.deferred).toEqual({
      version: '2.4.0',
      until: '2026-10-30T08:00:00.000Z',
    });
    expect(overview.components.find((entry) => entry.product === 'tor')?.security?.reason).toBe(
      'The Tor network rates the tor that runs as "obsolete".',
    );
    clock.now = new Date('2026-10-31T08:00:00.000Z');
    service.resume('bitcoin-core');
    expect((await service.pending()).map((update) => update.product).sort()).toEqual(['bitcoin-core', 'sparrow']);
  });

  it('orders Bitcoin Knots versions by their numbers, not as text', () => {
    // As a string, '29.4.2.knots…' sorts before '29.4.knots…'.
    expect(compareVersions('bitcoin-knots', '29.4.2.knots20260508', '29.4.knots20260508')).toBeGreaterThan(0);
    expect(compareVersions('bitcoin-knots', '29.4.1.knots20260508', '29.4.2.knots20260508')).toBeLessThan(0);
    expect(compareVersions('bitcoin-knots', '29.4.2.knots20260508', '29.4.2.knots20260508')).toBe(0);
    expect(compareVersions('bitcoin-core', '31.1', '30.2')).toBeGreaterThan(0);
    expect(compareVersions('tor', '15.0.26', '15.0.9')).toBeGreaterThan(0);
  });

  it('lists what moving across major versions changes for good', () => {
    expect(majorUpgradeNotes({ major: 27, minor: 2 }, { major: 31, minor: 1 })).toEqual([
      'Bitcoin Core does not support going back from 31.1 to 27.2: make a backup first.',
      'From 28.0 the blocks folder is obfuscated with a key, so versions before 28.0 cannot read it.',
      'From 30.0 legacy (BDB) wallets no longer load: migrate them with migratewallet first, but not with 30.0 or 30.1.',
      'From 30.0 the coin statistics index moves to indexes\\coinstatsindex; the old one is kept for a downgrade.',
    ]);
    expect(majorUpgradeNotes({ major: 31, minor: 0 }, { major: 31, minor: 1 })).toEqual([]);
  });
});
