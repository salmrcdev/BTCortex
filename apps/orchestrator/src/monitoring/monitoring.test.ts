import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  BackupSettings,
  ElectrumOverview,
  LightningConnectionWithStatus,
  NodeProfile,
  NodeWithStatus,
  OrchestratorEvent,
  PaymentServerWithStatus,
  RemoteElectrumWithStatus,
  RemoteExplorerWithStatus,
  TorStatus,
} from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { openDatabase } from '../persistence/database';
import { migrations } from '../persistence/migrations';
import { SettingsStore } from '../persistence/settings';
import { ConfigWatch } from './config-watch';
import { MonitoringService } from './monitoring-service';
import { RecentErrorsSink } from './recent-errors';
import { AlertStore, MetricsStore } from './stores';
import { activityBetween } from './system-activity';
import type { RawCounters } from './system-activity';

const GIB = 1024 ** 3;
let root: string;
let database: DatabaseSync;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'btcortex-monitoring-'));
  database = openDatabase({
    file: join(root, 'test.db'),
    migrations,
    logger: new StructuredLogger([new MemorySink()], 'debug'),
  });
});

afterEach(() => {
  database.close();
  rmSync(root, { recursive: true, force: true });
});

interface NodeOptions {
  id?: string;
  name?: string;
  network?: string;
  height?: number;
  ibd?: boolean;
  peers?: number;
  managed?: boolean;
  dataDirectory?: string;
  takenAt?: string;
  received?: number;
  sent?: number;
}

function node(state: NodeWithStatus['status']['state'], options: NodeOptions = {}): NodeWithStatus {
  return {
    profile: {
      id: options.id ?? 'n1',
      name: options.name ?? 'Main node',
      implementation: 'bitcoin-core',
      network: options.network ?? 'mainnet',
      execution: options.managed === false ? 'external' : 'managed',
      dataDirectory: options.dataDirectory ?? null,
      authentication: { kind: 'password', username: 'monitor', secretId: 's1' },
    },
    status: {
      nodeId: options.id ?? 'n1',
      state,
      checkedAt: '2026-10-23T08:00:00.000Z',
      ...(state === 'running'
        ? {
            snapshot: {
              takenAt: options.takenAt ?? '2026-10-23T08:00:00.000Z',
              blockchain: {
                blocks: options.height ?? 100,
                initialBlockDownload: options.ibd ?? false,
                verificationProgress: 0.5,
              },
              network: { connections: options.peers ?? 8, networkActive: true },
              mempool: { loaded: true, transactions: 1200, virtualBytes: 600_000 },
              traffic: { bytesReceived: options.received ?? 0, bytesSent: options.sent ?? 0 },
            },
          }
        : {}),
      ...(state === 'failed' ? { error: { message: 'bitcoind exited with code 1.' } } : {}),
    },
  } as unknown as NodeWithStatus;
}

interface World {
  nodes: NodeWithStatus[];
  tor?: TorStatus;
  electrum?: ElectrumOverview;
  lightning: LightningConnectionWithStatus[];
  payments?: PaymentServerWithStatus[];
  remoteElectrum?: RemoteElectrumWithStatus[];
  remoteExplorers?: RemoteExplorerWithStatus[];
  backups?: BackupSettings;
  freeBytes: number;
  memoryFree?: number;
  counters?: RawCounters;
  updates?: {
    product: string;
    name: string;
    latest: string;
    security: { severity: 'critical' | 'warning'; reason: string } | null;
  }[];
}

function fakeVault() {
  const secrets = new Map<string, string>();
  return {
    store: (_purpose: string, plaintext: string) => {
      const id = `secret-${String(secrets.size + 1)}`;
      secrets.set(id, plaintext);
      return Promise.resolve(id);
    },
    reveal: (id: string) => {
      const secret = secrets.get(id);
      return secret === undefined ? Promise.reject(new Error('gone')) : Promise.resolve(secret);
    },
  };
}

function setUp(
  world: World,
  clock: { now: Date },
  extra: { configWatch?: ConfigWatch; errors?: RecentErrorsSink } = {},
) {
  const events: OrchestratorEvent[] = [];
  const revealed: string[] = [];
  let processorTotal = 0;
  const service = new MonitoringService({
    alerts: new AlertStore(database),
    metrics: new MetricsStore(database),
    settings: new SettingsStore(database),
    nodes: () => world.nodes,
    tor: () => (world.tor ? Promise.resolve(world.tor) : Promise.reject(new Error('no tor'))),
    electrum: () => Promise.resolve(world.electrum ?? { installed: null, servers: [] }),
    lightning: () => world.lightning,
    payments: () => world.payments ?? [],
    remoteElectrum: () => world.remoteElectrum ?? [],
    remoteExplorers: () => world.remoteExplorers ?? [],
    backups: () =>
      world.backups ?? {
        destination: null,
        retention: 10,
        schedule: { everyHours: 0, encrypted: false },
        passphraseStored: false,
        lastRun: null,
      },
    ...(extra.configWatch ? { configWatch: extra.configWatch } : {}),
    ...(extra.errors ? { recentErrors: (now: Date) => extra.errors?.summary(now) ?? { count: 0, latest: [] } } : {}),
    paths: { root, exports: join(root, 'exports') },
    publish: (event) => events.push(event),
    logger: new StructuredLogger([new MemorySink()], 'debug'),
    now: () => clock.now,
    volumeOf: () => Promise.resolve({ root: 'C:\\', freeBytes: world.freeBytes, totalBytes: 500 * GIB }),
    // Each check sees 1000 more units of processor time, 250 of them idle: 75 % busy.
    processors: () => {
      processorTotal += 1000;
      return { idle: processorTotal / 4, total: processorTotal };
    },
    memory: () => ({ total: 8 * GIB, free: world.memoryFree ?? 2 * GIB }),
    counters: () => Promise.resolve(world.counters),
    updates: () => Promise.resolve(world.updates ?? []),
    reveal: (path) => revealed.push(path),
  });
  return { service, events, revealed };
}

const later = (clock: { now: Date }, minutes: number) => {
  clock.now = new Date(clock.now.getTime() + minutes * 60_000);
};

/** Counters as Windows keeps them: cumulative, with a 10 MHz clock. */
function counters(seconds: number, totals: { idle: number; read: number; written: number; in: number; out: number }) {
  const ticks = String(seconds * 10_000_000);
  return {
    disks: [
      {
        name: '0 C:',
        idle: String(totals.idle * 10_000_000),
        base: String(132_000_000_000_000_000n + BigInt(seconds) * 10_000_000n),
        read: String(totals.read),
        write: String(totals.written),
        time: ticks,
        frequency: '10000000',
      },
    ],
    interfaces: [
      { name: 'Ethernet', received: String(totals.in), sent: String(totals.out), time: ticks, frequency: '10000000' },
    ],
  };
}

describe('monitoring', () => {
  it('raises an alert for a node that stopped unexpectedly, once, and resolves it when the node runs again', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const world: World = { nodes: [node('failed')], lightning: [], freeBytes: 200 * GIB };
    const { service, events } = setUp(world, clock);
    const first = await service.check();
    expect(first.overall).toBe('failed');
    expect(first.alerts).toEqual({ open: 1, critical: 1, warning: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'alerts.changed',
      payload: { raised: [{ id: 'node.failed:n1', severity: 'critical', message: 'bitcoind exited with code 1.' }] },
    });
    later(clock, 1);
    await service.check();
    expect(events).toHaveLength(1);
    world.nodes = [node('running')];
    later(clock, 1);
    const recovered = await service.check();
    expect(events[1]).toMatchObject({ payload: { resolved: [{ id: 'node.failed:n1' }], open: 0 } });
    expect(recovered.overall).toBe('healthy');
    expect(service.alerts(false)).toEqual([]);
    expect(service.alerts(true)[0]).toMatchObject({ id: 'node.failed:n1', resolvedAt: clock.now.toISOString() });
  });

  it('waits before alerting about passing trouble: an unanswering node, no peers, a Lightning node', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const world: World = {
      nodes: [
        node('unreachable'),
        node('running', { id: 'n2', peers: 0 }),
        node('running', { id: 'n3', network: 'regtest', peers: 0 }),
      ],
      lightning: [
        {
          connection: {
            id: 'c1',
            name: 'LND',
            certificateExpiresAt: null,
            macaroon: { access: 'read-only', permissions: [], caveats: [] },
          },
          status: { connectionId: 'c1', state: 'unreachable', alias: 'bob' },
        } as unknown as LightningConnectionWithStatus,
      ],
      freeBytes: 200 * GIB,
    };
    const { service, events } = setUp(world, clock);
    await service.check();
    expect(events).toEqual([]);
    later(clock, 3);
    await service.check();
    expect(
      service
        .alerts(false)
        .map((alert) => alert.id)
        .sort(),
    ).toEqual(['node.unreachable:n1']);
    later(clock, 3);
    await service.check();
    expect(
      service
        .alerts(false)
        .map((alert) => alert.id)
        .sort(),
    ).toEqual(['lightning.unavailable:c1', 'node.unreachable:n1']);
    later(clock, 5);
    await service.check();
    // A regtest node has no peers by design; a mainnet node without peers is worth a warning.
    expect(
      service
        .alerts(false)
        .map((alert) => alert.id)
        .sort(),
    ).toEqual(['lightning.unavailable:c1', 'node.no-peers:n2', 'node.unreachable:n1']);
  });

  it('notices a synchronisation that stalls and a disk that fills up, by the thresholds the user chose', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const world: World = { nodes: [node('running', { height: 500, ibd: true })], lightning: [], freeBytes: 8 * GIB };
    const { service } = setUp(world, clock);
    await service.check();
    expect(service.alerts(false)).toMatchObject([{ id: 'disk.low:c:\\', severity: 'warning' }]);
    later(clock, 31);
    world.freeBytes = 1 * GIB;
    await service.check();
    const alerts = service.alerts(false);
    expect(alerts.find((alert) => alert.id === 'disk.low:c:\\')).toMatchObject({ severity: 'critical' });
    expect(alerts.find((alert) => alert.id === 'node.sync-stalled:n1')?.message).toMatch(/at block 500 for 31 minutes/);
    world.nodes = [node('running', { height: 501, ibd: true })];
    world.freeBytes = 50 * GIB;
    later(clock, 1);
    await service.check();
    expect(service.alerts(false)).toEqual([]);

    service.configure({ diskWarningGiB: 100, diskCriticalGiB: 20 });
    await service.check();
    expect(service.alerts(false)).toMatchObject([{ id: 'disk.low:c:\\', severity: 'warning' }]);
    expect(() => service.configure({ diskCriticalGiB: 200 })).toThrow(/must be below/);
    expect(service.settings()).toMatchObject({ diskWarningGiB: 100, diskCriticalGiB: 20, detailedHours: 48 });
  });

  it('reports tor, Electrum servers, macaroons, certificates and backups, and sums the health up', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const world: World = {
      nodes: [node('running')],
      tor: { state: 'failed', error: { message: 'tor exited.' } } as unknown as TorStatus,
      electrum: {
        installed: null,
        servers: [
          { nodeId: 'n1', state: 'failed', error: { message: 'Fulcrum exited.' } },
          { nodeId: 'n2', state: 'indexing', progress: 0.456 },
        ],
      } as unknown as ElectrumOverview,
      lightning: [
        {
          connection: {
            id: 'c1',
            name: 'LND',
            certificateExpiresAt: '2026-11-10T00:00:00.000Z',
            macaroon: { access: 'read-only', permissions: [], caveats: [], expiresAt: '2026-10-25T00:00:00.000Z' },
          },
          status: { connectionId: 'c1', state: 'ready', alias: 'bob' },
        } as unknown as LightningConnectionWithStatus,
      ],
      backups: {
        destination: 'E:\\Backups',
        retention: 10,
        schedule: { everyHours: 24, encrypted: false },
        passphraseStored: false,
        lastRun: {
          at: '2026-10-20T08:00:00.000Z',
          trigger: 'scheduled',
          outcome: 'succeeded',
          path: 'E:\\x',
          skipped: [],
        },
      },
      freeBytes: 200 * GIB,
    };
    const { service } = setUp(world, clock);
    const health = await service.check();
    expect(
      service
        .alerts(false)
        .map((alert) => alert.id)
        .sort(),
    ).toEqual([
      'backup.overdue',
      'electrum.failed:n1',
      'lightning.certificate-expiring:c1',
      'lightning.macaroon-expiring:c1',
      'tor.failed',
    ]);
    expect(service.alerts(false).find((alert) => alert.id === 'lightning.certificate-expiring:c1')?.message).toMatch(
      /expires on 2026-11-10\. LND makes a new one when it restarts/,
    );
    expect(Object.fromEntries(health.services.map((service_) => [service_.id, service_.health]))).toEqual({
      nodes: 'healthy',
      tor: 'failed',
      electrum: 'failed',
      lightning: 'healthy',
      backups: 'attention',
    });
    expect(health.services.find((service_) => service_.id === 'electrum')?.summary).toBe(
      '2 servers, 0 ready. Indexing 45 %.',
    );
    const settings = world.backups;
    if (!settings) throw new Error('The world has backup settings.');
    world.backups = {
      ...settings,
      lastRun: {
        at: '2026-10-23T07:00:00.000Z',
        trigger: 'manual',
        outcome: 'failed',
        message: 'The destination is full.',
        skipped: [],
      },
    };
    await service.check();
    expect(service.alerts(false).find((alert) => alert.id === 'backup.failed')?.message).toBe(
      'The destination is full.',
    );
  });

  it('warns when memory stays nearly used up, unless the user turned that off', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const world: World = { nodes: [], lightning: [], freeBytes: 200 * GIB, memoryFree: 0.4 * GIB };
    const { service } = setUp(world, clock);
    await service.check();
    expect(service.alerts(false)).toEqual([]);
    later(clock, 11);
    await service.check();
    expect(service.alerts(false)).toMatchObject([
      { id: 'resources.memory-high', severity: 'warning', title: 'Memory is nearly used up' },
    ]);
    service.configure({ resourceWarningPercent: null });
    later(clock, 1);
    await service.check();
    expect(service.alerts(false)).toEqual([]);
  });

  it('records the computer’s and every running node’s figures once a minute', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const world: World = {
      nodes: [node('running', { takenAt: '2026-10-23T08:00:00.000Z', received: 1_000, sent: 500 })],
      lightning: [],
      freeBytes: 200 * GIB,
      counters: counters(1000, { idle: 900, read: 0, written: 0, in: 0, out: 0 }),
    };
    const { service } = setUp(world, clock);
    expect((await service.check()).resources.cpuPercent).toBeNull();
    later(clock, 1);
    const health = await service.check();
    expect(health.resources).toMatchObject({ cpuPercent: 75, memoryUsedBytes: 6 * GIB, memoryTotalBytes: 8 * GIB });
    expect(health.resources.activity.diskBusyPercent).toBeNull();
    await service.sample();

    // A minute later: the disk was idle 45 of 60 seconds and moved 6 MB in and 3 MB out; the network 60 kB.
    world.counters = counters(1060, { idle: 945, read: 6_000_000, written: 3_000_000, in: 60_000, out: 6_000 });
    world.nodes = [node('running', { takenAt: '2026-10-23T08:01:00.000Z', received: 61_000, sent: 30_500 })];
    later(clock, 1);
    await service.sample();
    await service.check();
    const activity = (await service.health()).resources.activity;
    expect(activity.diskBusyPercent).toBeCloseTo(25);
    expect(activity).toMatchObject({
      diskReadBytesPerSecond: 100_000,
      diskWriteBytesPerSecond: 50_000,
      networkInBytesPerSecond: 1_000,
      networkOutBytesPerSecond: 100,
    });
    expect(service.history('system.cpu', 1).points.map((point) => point.value)).toEqual([75, 75]);
    expect(service.history('system.disk-read', 1).points).toEqual([{ at: clock.now.toISOString(), value: 100_000 }]);
    expect(service.history('node.peers:n1', 1).points.map((point) => point.value)).toEqual([8, 8]);
    expect(service.history('node.mempool-size:n1', 1).points[0]?.value).toBe(600_000);
    expect(service.history('node.sync:n1', 1).points[0]?.value).toBe(50);
    // Bitcoin Core counts bytes since it started: 60,000 more received over 60 seconds.
    expect(service.history('node.traffic-in:n1', 1).points).toEqual([{ at: clock.now.toISOString(), value: 1_000 }]);
    expect(service.history('node.traffic-out:n1', 1).points[0]?.value).toBe(500);
  });

  it('folds old minute samples into hourly averages and forgets what is past its retention', () => {
    const metrics = new MetricsStore(database);
    const retention = { detailedHours: 48, historyDays: 90 };
    const start = Date.parse('2026-10-20T08:00:00.000Z');
    for (let minute = 0; minute < 120; minute += 1) {
      metrics.record('system.cpu', new Date(start + minute * 60_000), minute < 60 ? 10 : 30);
    }
    metrics.record('system.cpu', new Date('2026-10-23T07:59:00.000Z'), 50);
    metrics.record('node.peers:gone', new Date('2026-10-23T07:59:00.000Z'), 8);
    const now = new Date('2026-10-23T08:00:00.000Z');
    metrics.compact(now, retention);
    expect(metrics.history('system.cpu', 1, now, 48).points).toEqual([{ at: '2026-10-23T07:59:00.000Z', value: 50 }]);
    const week = metrics.history('system.cpu', 24 * 7, now, 48);
    expect(week.resolution).toBe('hour');
    expect(week.points).toEqual([
      { at: '2026-10-20T08:00:00.000Z', value: 10 },
      { at: '2026-10-20T09:00:00.000Z', value: 30 },
      { at: '2026-10-23T07:00:00.000Z', value: 50 },
    ]);
    // Six hours of detail: the last minute sample stays, the two-hour block above was already folded.
    metrics.compact(now, { detailedHours: 6, historyDays: 2 });
    expect(metrics.history('system.cpu', 24 * 7, now, 6).points).toEqual([
      { at: '2026-10-23T07:00:00.000Z', value: 50 },
    ]);
    metrics.forgetNodesExcept(['n1']);
    expect(metrics.seriesSince(new Date(0))).toEqual(['system.cpu']);
    metrics.compact(new Date('2027-02-01T00:00:00.000Z'), retention);
    expect(metrics.history('system.cpu', 24 * 90, new Date('2027-02-01T00:00:00.000Z'), 48).points).toEqual([]);
  });

  it('says when an update is available, as a warning when staying matters for security', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const world: World = {
      nodes: [],
      lightning: [],
      freeBytes: 200 * GIB,
      updates: [{ product: 'sparrow', name: 'Sparrow', latest: '2.4.0', security: null }],
    };
    const { service } = setUp(world, clock);
    await service.check();
    expect(service.alerts(false)).toMatchObject([
      { id: 'update.available:sparrow', severity: 'info', title: 'Sparrow 2.4.0 is available', route: '/updates' },
    ]);
    world.updates = [
      {
        product: 'bitcoin-core',
        name: 'Bitcoin Core',
        latest: '31.1',
        security: { severity: 'warning', reason: 'Bitcoin Core 30.1 was withdrawn.' },
      },
    ];
    await service.check();
    expect(service.alerts(false)).toMatchObject([{ id: 'update.available:bitcoin-core', severity: 'warning' }]);
  });

  it('keeps an alert seen but open until its cause is gone', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const { service } = setUp({ nodes: [node('failed')], lightning: [], freeBytes: 200 * GIB }, clock);
    await service.check();
    const acknowledged = service.acknowledge('node.failed:n1');
    expect(acknowledged.acknowledgedAt).toBe(clock.now.toISOString());
    expect(acknowledged.clearsWhenSeen).toBe(false);
    expect(service.alerts(false)).toHaveLength(1);
    expect(() => service.acknowledge('nothing')).toThrow(/no such alert/);
  });

  it('exports chosen metrics as CSV and a plain-text report, and shows only its own exports', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const errors = new RecentErrorsSink();
    const logger = new StructuredLogger([errors], 'debug', 'tor', () => clock.now);
    logger.error('tor exited with code 1');
    const world: World = { nodes: [node('running', { name: '=Main, node' })], lightning: [], freeBytes: 200 * GIB };
    const { service, revealed } = setUp(world, clock, { errors });
    await service.check();
    later(clock, 1);
    await service.check();
    await service.sample();
    const csv = await service.export({ kind: 'metrics', series: ['system.cpu', 'node.peers:n1'], hours: 24 });
    expect(csv.path).toMatch(/btcortex-monitoring-metrics-2026-10-23T08-01-00\.csv$/);
    // A name that a spreadsheet would run as a formula is kept as text.
    expect(readFileSync(csv.path, 'utf8')).toBe(
      `Time (UTC),Processor use (%),"'=Main, node: peers"\r\n2026-10-23T08:01:00.000Z,75,8\r\n`,
    );
    const report = await service.export({ kind: 'report', hours: 24 });
    const text = readFileSync(report.path, 'utf8');
    expect(text).toContain('Period: the last 24 hours, from 2026-10-22 08:01 UTC');
    expect(text).toContain('Overall: Everything is working.');
    expect(text).toContain('- Bitcoin nodes: 1 node, 1 running.');
    expect(text).toContain('- Processor use (%): 75 / 75 / 75 (1 sample)');
    expect(text).toContain('Errors BTCortex logged in the last 24 hours: 1');
    expect(text).toContain('tor: tor exited with code 1');
    service.revealExport(csv.path);
    expect(revealed).toEqual([csv.path]);
    expect(() => {
      service.revealExport(join(root, 'test.db'));
    }).toThrow(/not a monitoring export/);
  });
});

describe('disk and network activity', () => {
  it('works out busy time and rates between two readings, leaving out what cannot be compared', () => {
    const first = counters(1000, { idle: 900, read: 0, written: 0, in: 1_000, out: 1_000 });
    const second = counters(1010, { idle: 908, read: 10_000, written: 20_000, in: 11_000, out: 2_000 });
    expect(activityBetween(first, second)).toEqual({
      diskBusyPercent: expect.closeTo(20, 5) as number,
      diskReadBytesPerSecond: 1_000,
      diskWriteBytesPerSecond: 2_000,
      networkInBytesPerSecond: 1_000,
      networkOutBytesPerSecond: 100,
    });
    // A counter that went backwards (a reset adapter) and a new disk give no figure.
    const reset = {
      ...second,
      disks: [{ ...second.disks[0], name: '1 D:' }] as RawCounters['disks'],
      interfaces: [{ ...second.interfaces[0], received: '5' }] as RawCounters['interfaces'],
    };
    expect(activityBetween(first, reset)).toEqual({
      diskBusyPercent: null,
      diskReadBytesPerSecond: null,
      diskWriteBytesPerSecond: null,
      networkInBytesPerSecond: null,
      networkOutBytesPerSecond: null,
    });
  });
});

describe('security-relevant bitcoin.conf changes', () => {
  function watchedNode(directory: string): NodeProfile {
    return node('running', { id: 'n1', dataDirectory: directory }).profile;
  }

  it('notes changes made elsewhere once the file settles, without keeping the values, and BTCortex’s own as such', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const directory = join(root, 'node');
    mkdirSync(directory);
    const file = join(directory, 'bitcoin.conf');
    writeFileSync(file, 'server=1\nrpcallowip=127.0.0.1\ndbcache=450\n');
    const settings = new SettingsStore(database);
    const watch = new ConfigWatch({
      settings,
      vault: fakeVault(),
      logger: new StructuredLogger([new MemorySink()], 'debug'),
      now: () => clock.now,
    });
    const profile = watchedNode(directory);
    await watch.scan([profile]);
    await watch.scan([profile]);
    expect(watch.notices()).toEqual([]);

    writeFileSync(file, 'server=1\nrpcallowip=192.168.1.0/24\ndbcache=900\nblocknotify=curl -u me:hunter2 http://x\n');
    await watch.scan([profile]);
    // Not compared until it has stayed the same between two looks.
    expect(watch.notices()).toEqual([]);
    await watch.scan([profile]);
    expect(watch.notices()).toEqual([
      {
        nodeId: 'n1',
        nodeName: 'Main node',
        at: clock.now.toISOString(),
        byBtcortex: false,
        changes: [
          { key: 'blocknotify', kind: 'added', now: null },
          { key: 'rpcallowip', kind: 'changed', now: ['192.168.1.0/24'] },
        ],
      },
    ]);
    // Only digests are kept: neither the old address nor the command, with its password, is stored.
    const stored = JSON.stringify(settings.entries());
    expect(stored).not.toContain('127.0.0.1');
    expect(stored).not.toContain('hunter2');

    watch.dismiss('n1');
    writeFileSync(file, 'server=1\nrpcallowip=192.168.1.0/24\ndbcache=900\nlisten=0\n');
    await watch.ownChange(profile);
    expect(watch.notices()).toMatchObject([
      {
        byBtcortex: true,
        changes: [
          { key: 'blocknotify', kind: 'removed', now: null },
          { key: 'listen', kind: 'added', now: ['off'] },
        ],
      },
    ]);
    // A later scan does not report BTCortex's own change again.
    await watch.scan([profile]);
    await watch.scan([profile]);
    expect(watch.notices()).toHaveLength(1);
  });

  it('turns a notice into an alert that is resolved once it has been seen', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const directory = join(root, 'node');
    mkdirSync(directory);
    writeFileSync(join(directory, 'bitcoin.conf'), 'rpcbind=127.0.0.1\n');
    const watch = new ConfigWatch({
      settings: new SettingsStore(database),
      vault: fakeVault(),
      logger: new StructuredLogger([new MemorySink()], 'debug'),
      now: () => clock.now,
    });
    const world: World = {
      nodes: [node('running', { dataDirectory: directory })],
      lightning: [],
      freeBytes: 200 * GIB,
    };
    const { service, events } = setUp(world, clock, { configWatch: watch });
    await service.check();
    await service.check();
    writeFileSync(join(directory, 'bitcoin.conf'), 'rpcbind=0.0.0.0\nrpcallowip=0.0.0.0/0\n');
    await service.check();
    await service.check();
    const [alert] = service.alerts(false);
    expect(alert).toMatchObject({
      id: 'config.changed:n1',
      severity: 'warning',
      title: 'bitcoin.conf of Main node changed outside BTCortex',
      route: '/nodes/n1/configuration',
      clearsWhenSeen: true,
    });
    expect(alert?.message).toContain('rpcallowip now 0.0.0.0/0; rpcbind now 0.0.0.0');
    const seen = service.acknowledge('config.changed:n1');
    expect(seen.resolvedAt).toBe(clock.now.toISOString());
    expect(events.at(-1)).toMatchObject({ payload: { resolved: [{ id: 'config.changed:n1' }], open: 0 } });
    await service.check();
    expect(service.alerts(false)).toEqual([]);
  });

  it('warns when a BTCPay Server stays out of reach, and shows payments only once one is connected', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const status = (state: PaymentServerWithStatus['status']['state']): PaymentServerWithStatus => ({
      server: {
        id: 'p1',
        kind: 'btcpay',
        name: 'Shop',
        url: 'https://pay.example',
        via: 'direct',
        addedAt: '2026-10-22T08:00:00.000Z',
      },
      status: {
        serverId: 'p1',
        state,
        checkedAt: clock.now.toISOString(),
        version: '2.4.5',
        onion: null,
        chains: [],
        error: state === 'unreachable' ? 'pay.example cannot be reached (ENOTFOUND).' : null,
        unreachableSince: null,
      },
    });
    const world: World = { nodes: [], lightning: [], freeBytes: 200 * GIB };
    const { service } = setUp(world, clock);
    expect((await service.health()).services.map((entry) => entry.id)).not.toContain('payments');
    world.payments = [status('unreachable')];
    await service.check();
    later(clock, 6);
    await service.check();
    expect(service.alerts(false).find((alert) => alert.id === 'payments.unavailable:p1')).toMatchObject({
      severity: 'warning',
      title: 'Shop does not answer',
      route: '/payments',
    });
    expect((await service.health()).services.find((entry) => entry.id === 'payments')).toMatchObject({
      health: 'attention',
      summary: '1 BTCPay Server, 0 online.',
    });
    world.payments = [status('online')];
    await service.check();
    expect(service.alerts(false).some((alert) => alert.id === 'payments.unavailable:p1')).toBe(false);
  });

  it('warns when an Electrum server on another computer stays out of reach, and at once when its certificate changes', async () => {
    const clock = { now: new Date('2026-10-23T08:00:00.000Z') };
    const remote = (
      state: RemoteElectrumWithStatus['status']['state'],
      error: string | null,
    ): RemoteElectrumWithStatus => ({
      server: {
        id: 'e1',
        name: 'Umbrel',
        host: 'umbrel.local',
        port: 50002,
        tls: true,
        via: 'direct',
        certificateFingerprint: null,
        nodeId: null,
        addedAt: '2026-10-22T08:00:00.000Z',
      },
      status: {
        state,
        serverVersion: 'electrs/0.10.9',
        network: 'mainnet',
        height: 968_000,
        checkedAt: clock.now.toISOString(),
        error,
        unreachableSince: null,
      },
    });
    const world: World = {
      nodes: [],
      lightning: [],
      freeBytes: 200 * GIB,
      remoteElectrum: [remote('unreachable', 'Nothing answers on umbrel.local:50002.')],
    };
    const { service } = setUp(world, clock);
    await service.check();
    // A few minutes of silence can be a restart.
    expect(service.alerts(false).some((alert) => alert.id === 'electrum.remote.unavailable:e1')).toBe(false);
    later(clock, 6);
    await service.check();
    expect(service.alerts(false).find((alert) => alert.id === 'electrum.remote.unavailable:e1')).toMatchObject({
      severity: 'warning',
      title: 'Umbrel does not answer',
      route: '/electrum',
    });
    world.remoteElectrum = [
      remote('certificate-changed', 'The server presented a different certificate from the one you accepted.'),
    ];
    await service.check();
    expect(service.alerts(false).find((alert) => alert.id === 'electrum.remote.unavailable:e1')).toMatchObject({
      severity: 'critical',
      title: 'Umbrel presented another certificate',
    });
    world.remoteElectrum = [remote('online', null)];
    await service.check();
    expect(service.alerts(false).some((alert) => alert.id === 'electrum.remote.unavailable:e1')).toBe(false);
  });

  it('says when tor has lost the network or cannot connect, instead of calling it connected', async () => {
    const clock = { now: new Date('2026-10-23T12:00:00.000Z') };
    const connected = {
      state: 'running',
      bootstrap: { progress: 100, summary: 'Done', tag: 'done', stalled: false },
      circuitEstablished: true,
      networkLiveness: 'up',
    } as unknown as TorStatus;
    const world: World = { nodes: [], lightning: [], freeBytes: 200 * GIB, tor: connected };
    const { service } = setUp(world, clock);
    await service.check();
    expect((await service.health()).services.find((entry) => entry.id === 'tor')).toMatchObject({
      health: 'healthy',
      summary: 'Connected to the Tor network.',
    });

    world.tor = { ...connected, circuitEstablished: false, networkLiveness: 'down' };
    await service.check();
    expect((await service.health()).services.find((entry) => entry.id === 'tor')).toMatchObject({
      health: 'attention',
      summary: 'Running, but cut off from the Tor network.',
    });
    // A moment offline (sleep, a new network) raises nothing; two minutes do.
    expect(service.alerts(false).some((alert) => alert.id === 'tor.disconnected')).toBe(false);
    later(clock, 3);
    await service.check();
    expect(service.alerts(false).find((alert) => alert.id === 'tor.disconnected')).toMatchObject({
      severity: 'warning',
      route: '/tor',
    });

    world.tor = {
      state: 'starting',
      bootstrap: {
        progress: 10,
        summary: 'Finishing handshake',
        tag: 'handshake',
        stalled: true,
        problem: { warning: 'Connection refused' },
      },
      circuitEstablished: false,
      networkLiveness: null,
    } as unknown as TorStatus;
    await service.check();
    expect(service.alerts(false).find((alert) => alert.id === 'tor.bootstrap-stalled')?.message).toContain(
      'Connection refused',
    );
    expect(service.alerts(false).some((alert) => alert.id === 'tor.disconnected')).toBe(false);
  });

  it('raises an alert for an explorer on another computer after five minutes of silence, at once on another chain', async () => {
    const clock = { now: new Date('2026-10-23T12:00:00.000Z') };
    const explorer = (state: RemoteExplorerWithStatus['status']['state'], error: string | null) => ({
      explorer: {
        id: 'x1',
        name: 'Home mempool',
        url: 'http://umbrel.local:3006',
        apiUrl: 'http://umbrel.local:3006/api',
        kind: 'mempool' as const,
        via: 'direct' as const,
        network: 'mainnet' as const,
        nodeId: null,
        addedAt: '2026-10-23T11:00:00.000Z',
      },
      status: {
        state,
        network: 'mainnet' as const,
        height: 968_000,
        blocksBehind: null,
        checkedAt: clock.now.toISOString(),
        error,
        unreachableSince: null,
      },
    });
    const world: World = {
      nodes: [],
      lightning: [],
      freeBytes: 200 * GIB,
      remoteExplorers: [explorer('unreachable', 'Nothing answers at umbrel.local:3006.')],
    };
    const { service } = setUp(world, clock);
    await service.check();
    expect(service.alerts(false).some((alert) => alert.id === 'explorers.remote.unavailable:x1')).toBe(false);
    later(clock, 6);
    await service.check();
    expect(service.alerts(false).find((alert) => alert.id === 'explorers.remote.unavailable:x1')).toMatchObject({
      severity: 'warning',
      title: 'Home mempool does not answer',
      route: '/explorer',
    });
    world.remoteExplorers = [explorer('wrong-chain', 'It follows another chain.')];
    await service.check();
    expect(service.alerts(false).find((alert) => alert.id === 'explorers.remote.unavailable:x1')?.title).toBe(
      'Home mempool follows another chain',
    );
    world.remoteExplorers = [explorer('online', null)];
    await service.check();
    expect(service.alerts(false).some((alert) => alert.id === 'explorers.remote.unavailable:x1')).toBe(false);
  });
});
