import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, statfs, unlink, writeFile } from 'node:fs/promises';
import { cpus, freemem, totalmem } from 'node:os';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { z } from 'zod';
import { AppFailure, describeSeries, MonitoringSettingsSchema, nodeSeries } from '@btcortex/contracts';
import type {
  Activity,
  Alert,
  AlertSeverity,
  BackupSettings,
  ConfigureMonitoringParams,
  ElectrumOverview,
  HealthService,
  HealthSummary,
  LightningConnectionWithStatus,
  PaymentServerWithStatus,
  RemoteElectrumWithStatus,
  RemoteExplorerWithStatus,
  MetricHistory,
  MetricKind,
  MetricSeries,
  MonitoringExport,
  MonitoringExportParams,
  MonitoringSettings,
  NodeWithStatus,
  OrchestratorEvent,
  RecentError,
  ServiceHealth,
  SystemMetric,
  TorStatus,
  VolumeUsage,
} from '@btcortex/contracts';
import type { Logger } from '../logging/logger';
import { localDataDirectory } from '../nodes/local-files';
import type { SettingsStore } from '../persistence/settings';
import type { AppPaths } from '../platform/paths';
import type { ConfigChange, ConfigNotice, ConfigWatch } from './config-watch';
import type { AlertStore, MetricsStore } from './stores';
import { activityBetween, NO_ACTIVITY, readRawCounters } from './system-activity';
import type { RawCounters } from './system-activity';

// Monitoring (specification section 19): every 30 seconds the state of nodes,
// tor, Electrum servers, Lightning connections, backups, the disks BTCortex
// uses and the security-relevant settings of each node's bitcoin.conf is
// turned into a health summary and a set of conditions. A condition becomes
// an alert, raised once and resolved when it is gone; conditions that can be
// passing (a node restarting, a busy hour) must last a while first, so that a
// short hiccup does not alarm anyone. Once a minute the computer's processor,
// memory, disk and network use and each running node's peers, mempool,
// traffic and progress are recorded into a history whose retention the user
// chooses; it can be exported as CSV or summed up in a plain-text report.

const CHECK_INTERVAL_MS = 30_000;
const SAMPLE_INTERVAL_MS = 60_000;
const COMPACT_INTERVAL_MS = 60 * 60 * 1000;
const NODE_DOWN_GRACE_MS = 2 * 60_000;
const SYNC_STALL_MS = 30 * 60_000;
const NO_PEERS_GRACE_MS = 10 * 60_000;
const LIGHTNING_GRACE_MS = 5 * 60_000;
const PAYMENTS_GRACE_MS = 5 * 60_000;
const REMOTE_ELECTRUM_GRACE_MS = 5 * 60_000;
const RESOURCE_GRACE_MS = 10 * 60_000;
/** tor loses the network for a moment when the computer sleeps or changes networks. */
const TOR_DISCONNECTED_GRACE_MS = 2 * 60_000;
const MACAROON_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
const CERTIFICATE_WARNING_MS = 30 * 24 * 60 * 60 * 1000;
const GIB = 1024 ** 3;
const SETTINGS_KEY = 'monitoring';
const EXPORT_PREFIX = 'btcortex-monitoring-';
const KEPT_EXPORTS = 20;

export const DEFAULT_MONITORING_SETTINGS: MonitoringSettings = {
  detailedHours: 48,
  historyDays: 90,
  diskWarningGiB: 10,
  diskCriticalGiB: 2,
  resourceWarningPercent: 90,
  desktopNotifications: 'all',
};

const METRIC_LABELS: Record<MetricKind, string> = {
  'system.cpu': 'Processor use (%)',
  'system.memory': 'Memory use (%)',
  'system.disk-busy': 'Busiest disk, time busy (%)',
  'system.disk-read': 'Disk reads (bytes/s)',
  'system.disk-write': 'Disk writes (bytes/s)',
  'system.network-in': 'Network received (bytes/s)',
  'system.network-out': 'Network sent (bytes/s)',
  'node.peers': 'peers',
  'node.mempool-transactions': 'mempool transactions',
  'node.mempool-size': 'mempool size (vB)',
  'node.traffic-in': 'received from peers (bytes/s)',
  'node.traffic-out': 'sent to peers (bytes/s)',
  'node.sync': 'blocks verified (%)',
  'node.size': 'blocks on disk (bytes)',
};

const ACTIVITY_SERIES: [SystemMetric, keyof Activity][] = [
  ['system.disk-busy', 'diskBusyPercent'],
  ['system.disk-read', 'diskReadBytesPerSecond'],
  ['system.disk-write', 'diskWriteBytesPerSecond'],
  ['system.network-in', 'networkInBytesPerSecond'],
  ['system.network-out', 'networkOutBytesPerSecond'],
];

const OVERALL_WORDS: Record<HealthSummary['overall'], string> = {
  healthy: 'Everything is working',
  attention: 'Something needs attention',
  failed: 'Something has failed',
  unknown: 'Nothing set up yet',
};

const SERVICE_NAMES: Record<HealthService['id'], string> = {
  nodes: 'Bitcoin nodes',
  tor: 'Tor',
  electrum: 'Electrum servers',
  lightning: 'Lightning',
  payments: 'Payments',
  backups: 'Backups',
};

export interface MonitoringServiceOptions {
  alerts: AlertStore;
  metrics: MetricsStore;
  settings: SettingsStore;
  nodes: () => NodeWithStatus[];
  tor: () => Promise<TorStatus>;
  electrum: () => Promise<ElectrumOverview>;
  lightning: () => LightningConnectionWithStatus[];
  /** BTCPay Server connections; none when the option is left out. */
  payments?: () => PaymentServerWithStatus[];
  /** Electrum servers on other computers that BTCortex reads. */
  remoteElectrum?: () => RemoteElectrumWithStatus[];
  /** Block explorers on other computers that BTCortex follows. */
  remoteExplorers?: () => RemoteExplorerWithStatus[];
  backups: () => BackupSettings;
  /** Security-relevant changes to each node's bitcoin.conf. */
  configWatch?: Pick<ConfigWatch, 'scan' | 'notices' | 'dismiss'>;
  /** Errors BTCortex logged lately. */
  recentErrors?: (now: Date) => { count: number; latest: RecentError[] };
  /** Updates available and not deferred (or deferred but relevant for security). */
  updates?: () => Promise<
    {
      product: string;
      name: string;
      latest: string;
      security: { severity: 'critical' | 'warning'; reason: string } | null;
    }[]
  >;
  paths: Pick<AppPaths, 'root' | 'exports'>;
  publish: (event: OrchestratorEvent) => void;
  logger: Logger;
  now?: () => Date;
  /** For tests. */
  volumeOf?: (path: string) => Promise<{ root: string; freeBytes: number; totalBytes: number }>;
  processors?: () => { idle: number; total: number };
  memory?: () => { total: number; free: number };
  counters?: () => Promise<RawCounters | undefined>;
  reveal?: (path: string) => void;
}

export interface Condition {
  id: string;
  rule: string;
  severity: AlertSeverity;
  component: string;
  title: string;
  message: string;
  route: string | null;
  /** How long the condition must last before it becomes an alert. */
  graceMs?: number;
}

interface Inputs {
  nodes: NodeWithStatus[];
  tor: TorStatus | undefined;
  electrum: ElectrumOverview | undefined;
  lightning: LightningConnectionWithStatus[];
  payments: PaymentServerWithStatus[];
  remoteElectrum: RemoteElectrumWithStatus[];
  remoteExplorers: RemoteExplorerWithStatus[];
  backups: BackupSettings | undefined;
  volumes: VolumeUsage[];
  configNotices: ConfigNotice[];
  updates: Awaited<ReturnType<NonNullable<MonitoringServiceOptions['updates']>>>;
}

async function measureVolume(path: string): Promise<{ root: string; freeBytes: number; totalBytes: number }> {
  let existing = path;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  const stats = await statfs(existing);
  return { root: parse(existing).root, freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
}

function processorTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const processor of cpus()) {
    const times = processor.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

function revealInExplorer(path: string): void {
  if (process.platform !== 'win32') return;
  spawn('explorer.exe', ['/select,', path], { detached: true, stdio: 'ignore' }).unref();
}

const GiB = (bytes: number) => `${(bytes / GIB).toFixed(1)} GiB`;
const minutes = (milliseconds: number) => String(Math.round(milliseconds / 60_000));
const utc = (time: string | Date) =>
  `${(typeof time === 'string' ? time : time.toISOString()).slice(0, 16).replace('T', ' ')} UTC`;

/** "hour", "24 hours", "7 days". */
function period(hours: number): string {
  if (hours === 1) return 'hour';
  return hours < 48 ? `${String(hours)} hours` : `${String(hours / 24)} days`;
}

function describeChange(change: ConfigChange): string {
  if (change.kind === 'removed') return `${change.key} removed`;
  if (change.now !== null) return `${change.key} now ${change.now.join(', ')}`;
  return `${change.key} ${change.kind}`;
}

/** A CSV field; text that a spreadsheet would read as a formula is quoted as text. */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function csvNumber(value: number | null): string {
  if (value === null) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

/** tor runs and finished connecting, yet says the network is down or it cannot build circuits. */
function torOffline(tor: TorStatus): boolean {
  return (
    tor.state === 'running' &&
    (tor.bootstrap?.progress ?? 0) >= 100 &&
    (tor.networkLiveness === 'down' || !tor.circuitEstablished)
  );
}

export class MonitoringService {
  private readonly firstSeen = new Map<string, number>();
  private readonly heights = new Map<string, { height: number; at: number }>();
  private readonly traffic = new Map<string, { at: number; received: number; sent: number }>();
  private lastProcessors: { idle: number; total: number } | undefined;
  private lastCounters: RawCounters | undefined;
  private cpuPercent: number | null = null;
  private activity: Activity = NO_ACTIVITY;
  private latest: HealthSummary | undefined;
  private timers: NodeJS.Timeout[] = [];
  private checking: Promise<HealthSummary> | undefined;

  constructor(private readonly options: MonitoringServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  initialise(): void {
    const every = (milliseconds: number, work: () => unknown) => {
      const timer = setInterval(() => {
        try {
          void Promise.resolve(work()).catch((error: unknown) => {
            this.options.logger.warn('A monitoring task failed', { error });
          });
        } catch (error) {
          this.options.logger.warn('A monitoring task failed', { error });
        }
      }, milliseconds);
      timer.unref();
      this.timers.push(timer);
    };
    every(CHECK_INTERVAL_MS, () => this.check());
    every(SAMPLE_INTERVAL_MS, () => this.sample());
    every(COMPACT_INTERVAL_MS, () => {
      this.tidy();
    });
    void this.check().catch((error: unknown) => {
      this.options.logger.warn('The first monitoring check failed', { error });
    });
    void this.sample().catch((error: unknown) => {
      this.options.logger.warn('The first monitoring sample failed', { error });
    });
  }

  shutdown(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  // Settings

  settings(): MonitoringSettings {
    // Stored values over the defaults, so that a setting added later starts at its default.
    const stored = this.options.settings.get(SETTINGS_KEY, z.record(z.string(), z.unknown())) ?? {};
    const merged = MonitoringSettingsSchema.safeParse({ ...DEFAULT_MONITORING_SETTINGS, ...stored });
    return merged.success ? merged.data : DEFAULT_MONITORING_SETTINGS;
  }

  configure(changes: ConfigureMonitoringParams): MonitoringSettings {
    const next = MonitoringSettingsSchema.parse({ ...this.settings(), ...changes });
    if (next.diskCriticalGiB >= next.diskWarningGiB) {
      throw new AppFailure({
        code: 'monitoring.invalid-thresholds',
        message: 'The free space for a critical alert must be below the free space for a warning.',
        component: 'Monitoring',
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    this.options.settings.set(SETTINGS_KEY, next);
    this.options.logger.info('Changed the monitoring settings', { changed: Object.keys(changes) });
    // A shorter retention applies at once.
    this.tidy();
    return next;
  }

  /** Folds and drops samples past their retention, forgets removed nodes and old resolved alerts. */
  private tidy(): void {
    const settings = this.settings();
    const now = this.now();
    this.options.metrics.compact(now, settings);
    this.options.metrics.forgetNodesExcept(this.options.nodes().map((node) => node.profile.id));
    this.options.alerts.prune(now);
  }

  // Reading

  /** The latest summary, or a fresh one before the first check has finished. */
  async health(): Promise<HealthSummary> {
    return this.latest ?? this.check();
  }

  alerts(includeResolved: boolean): Alert[] {
    return includeResolved
      ? this.options.alerts.recent(new Date(this.now().getTime() - 30 * 24 * 60 * 60 * 1000))
      : this.options.alerts.open();
  }

  /**
   * Marks an alert as seen. An alert about a lasting condition stays open
   * until the condition is gone; one about something that happened is resolved.
   */
  acknowledge(alertId: string): Alert {
    const now = this.now();
    const existing = this.options.alerts.get(alertId);
    if (!existing) {
      throw new AppFailure({
        code: 'monitoring.unknown-alert',
        message: 'There is no such alert.',
        component: 'Monitoring',
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    const acknowledged = this.options.alerts.acknowledge(alertId, now) ?? existing;
    if (!existing.clearsWhenSeen || existing.resolvedAt !== null) return acknowledged;
    if (existing.rule === 'config.changed') this.options.configWatch?.dismiss(alertId.slice(alertId.indexOf(':') + 1));
    const resolved = this.options.alerts.resolve(alertId, now) ?? acknowledged;
    this.options.publish({
      type: 'alerts.changed',
      at: now.toISOString(),
      payload: { raised: [], resolved: [resolved], open: this.options.alerts.open().length },
    });
    return resolved;
  }

  history(series: MetricSeries, hours: number): MetricHistory {
    return this.options.metrics.history(series, hours, this.now(), this.settings().detailedHours);
  }

  // Sampling

  private updateProcessors(): void {
    const current = (this.options.processors ?? processorTimes)();
    const previous = this.lastProcessors;
    this.lastProcessors = current;
    if (!previous) return;
    const total = current.total - previous.total;
    const idle = current.idle - previous.idle;
    if (total > 0) this.cpuPercent = Math.min(100, Math.max(0, ((total - idle) / total) * 100));
  }

  private memoryUse(): { total: number; used: number } {
    const memory = this.options.memory?.() ?? { total: totalmem(), free: freemem() };
    return { total: memory.total, used: memory.total - memory.free };
  }

  /** Records the computer's and every running node's figures; called once a minute. */
  async sample(): Promise<void> {
    const at = this.now();
    const record = (series: MetricSeries, value: number) => {
      this.options.metrics.record(series, at, value);
    };
    if (this.cpuPercent !== null) record('system.cpu', this.cpuPercent);
    const memory = this.memoryUse();
    if (memory.total > 0) record('system.memory', (memory.used / memory.total) * 100);

    const counters = await (this.options.counters ?? readRawCounters)().catch((error: unknown) => {
      this.options.logger.debug('Could not read the disk and network counters', { error });
      return undefined;
    });
    if (counters) {
      if (this.lastCounters) {
        this.activity = activityBetween(this.lastCounters, counters);
        for (const [series, field] of ACTIVITY_SERIES) {
          const value = this.activity[field];
          if (value !== null) record(series, value);
        }
      }
      this.lastCounters = counters;
    }

    for (const { profile, status } of this.options.nodes()) {
      const snapshot = status.snapshot;
      if (status.state !== 'running' || !snapshot) {
        this.traffic.delete(profile.id);
        continue;
      }
      record(nodeSeries('node.peers', profile.id), snapshot.network.connections);
      record(nodeSeries('node.sync', profile.id), Math.min(100, snapshot.blockchain.verificationProgress * 100));
      // The growth of the block files feeds the storage forecast.
      record(nodeSeries('node.size', profile.id), snapshot.blockchain.sizeOnDiskBytes);
      if (snapshot.mempool.loaded) {
        record(nodeSeries('node.mempool-transactions', profile.id), snapshot.mempool.transactions);
        record(nodeSeries('node.mempool-size', profile.id), snapshot.mempool.virtualBytes);
      }
      // Bitcoin Core counts bytes since it started; the rate is the growth between two snapshots.
      const taken = Date.parse(snapshot.takenAt);
      const previous = this.traffic.get(profile.id);
      const current = { at: taken, received: snapshot.traffic.bytesReceived, sent: snapshot.traffic.bytesSent };
      if (previous && taken > previous.at) {
        if (current.received >= previous.received && current.sent >= previous.sent) {
          const seconds = (taken - previous.at) / 1000;
          record(nodeSeries('node.traffic-in', profile.id), (current.received - previous.received) / seconds);
          record(nodeSeries('node.traffic-out', profile.id), (current.sent - previous.sent) / seconds);
        }
        this.traffic.set(profile.id, current);
      } else if (!previous) {
        this.traffic.set(profile.id, current);
      }
    }
  }

  // Checking

  async check(): Promise<HealthSummary> {
    this.checking ??= this.runCheck().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async gather(): Promise<Inputs> {
    const nodes = this.options.nodes();
    const tor = await this.options.tor().catch(() => undefined);
    const electrum = await this.options.electrum().catch(() => undefined);
    let backups: BackupSettings | undefined;
    try {
      backups = this.options.backups();
    } catch {
      backups = undefined;
    }
    const places = new Map<string, string>([[this.options.paths.root, 'BTCortex’s data']]);
    for (const { profile } of nodes) {
      const local = localDataDirectory(profile);
      if (local !== undefined) places.set(local, profile.name);
    }
    const volumes = new Map<string, VolumeUsage>();
    for (const [path, use] of places) {
      try {
        const volume = await (this.options.volumeOf ?? measureVolume)(path);
        const key = volume.root.toLowerCase();
        const known = volumes.get(key);
        if (known) {
          if (!known.uses.includes(use)) known.uses.push(use);
        } else {
          volumes.set(key, { ...volume, uses: [use] });
        }
      } catch {
        // A folder on a disk that went away: the node's own state reports it.
      }
    }
    let configNotices: ConfigNotice[] = [];
    if (this.options.configWatch) {
      await this.options.configWatch.scan(nodes.map((node) => node.profile));
      configNotices = this.options.configWatch.notices();
    }
    const updates = (await this.options.updates?.().catch(() => [])) ?? [];
    return {
      nodes,
      tor,
      electrum,
      lightning: this.options.lightning(),
      payments: this.options.payments?.() ?? [],
      remoteElectrum: this.options.remoteElectrum?.() ?? [],
      remoteExplorers: this.options.remoteExplorers?.() ?? [],
      backups,
      volumes: [...volumes.values()],
      configNotices,
      updates,
    };
  }

  /** Every condition that holds now, before the grace periods are applied. */
  conditions(inputs: Inputs, now: number, settings: MonitoringSettings = this.settings()): Condition[] {
    const conditions: Condition[] = [];
    for (const { profile, status } of inputs.nodes) {
      const managed = profile.execution === 'managed';
      const route = `/nodes/${profile.id}`;
      if (status.state === 'failed') {
        conditions.push({
          id: `node.failed:${profile.id}`,
          rule: 'node.failed',
          severity: managed ? 'critical' : 'warning',
          component: profile.name,
          title: `${profile.name} stopped unexpectedly`,
          message: status.error?.message ?? 'The node is not running and did not stop because BTCortex asked it to.',
          route,
        });
      } else if (status.state === 'unreachable') {
        conditions.push({
          id: `node.unreachable:${profile.id}`,
          rule: 'node.unreachable',
          severity: managed ? 'critical' : 'warning',
          component: profile.name,
          title: `${profile.name} is not answering`,
          message: status.error?.message ?? 'BTCortex cannot reach the node’s RPC interface.',
          route,
          graceMs: NODE_DOWN_GRACE_MS,
        });
      } else if (status.state === 'unauthorised') {
        conditions.push({
          id: `node.unauthorised:${profile.id}`,
          rule: 'node.unauthorised',
          severity: 'warning',
          component: profile.name,
          title: `${profile.name} refuses BTCortex`,
          message: 'The node rejected BTCortex’s credentials (its cookie or password changed).',
          route,
        });
      }
      const snapshot = status.snapshot;
      if (status.state === 'running' && snapshot) {
        const height = snapshot.blockchain.blocks;
        const known = this.heights.get(profile.id);
        if (known?.height !== height) this.heights.set(profile.id, { height, at: now });
        const since = this.heights.get(profile.id)?.at ?? now;
        if (snapshot.blockchain.initialBlockDownload && now - since >= SYNC_STALL_MS) {
          conditions.push({
            id: `node.sync-stalled:${profile.id}`,
            rule: 'node.sync-stalled',
            severity: 'warning',
            component: profile.name,
            title: `${profile.name} has stopped catching up`,
            message: `The node has been at block ${String(height)} for ${minutes(now - since)} minutes while it is still synchronising. It may have no useful peers, or its disk may be too slow.`,
            route,
          });
        }
        if (profile.network !== 'regtest' && snapshot.network.networkActive && snapshot.network.connections === 0) {
          conditions.push({
            id: `node.no-peers:${profile.id}`,
            rule: 'node.no-peers',
            severity: 'warning',
            component: profile.name,
            title: `${profile.name} has no peers`,
            message:
              'The node is not connected to any other node, so it does not learn of new blocks and transactions.',
            route: `${route}/peers`,
            graceMs: NO_PEERS_GRACE_MS,
          });
        }
      } else {
        this.heights.delete(profile.id);
      }
    }

    for (const volume of inputs.volumes) {
      if (volume.freeBytes >= settings.diskWarningGiB * GIB) continue;
      const critical = volume.freeBytes < settings.diskCriticalGiB * GIB;
      conditions.push({
        id: `disk.low:${volume.root.toLowerCase()}`,
        rule: 'disk.low',
        severity: critical ? 'critical' : 'warning',
        component: `Disk ${volume.root}`,
        title: `Disk ${volume.root} is nearly full`,
        message: `${GiB(volume.freeBytes)} free, used by ${volume.uses.join(', ')}.${critical ? ' Bitcoin Core stops by itself below 50 MiB.' : ''}`,
        route: '/monitoring',
      });
    }

    const threshold = settings.resourceWarningPercent;
    const memory = this.memoryUse();
    if (threshold !== null && memory.total > 0 && (memory.used / memory.total) * 100 >= threshold) {
      conditions.push({
        id: 'resources.memory-high',
        rule: 'resources.memory-high',
        severity: 'warning',
        component: 'This computer',
        title: 'Memory is nearly used up',
        message: `${GiB(memory.used)} of ${GiB(memory.total)} has been in use for over ${minutes(RESOURCE_GRACE_MS)} minutes. Windows slows down when memory runs out; a smaller database cache for Bitcoin Core (dbcache) or fewer programs running would help.`,
        route: '/monitoring',
        graceMs: RESOURCE_GRACE_MS,
      });
    }
    if (threshold !== null && this.cpuPercent !== null && this.cpuPercent >= threshold) {
      conditions.push({
        id: 'resources.cpu-high',
        rule: 'resources.cpu-high',
        severity: 'info',
        component: 'This computer',
        title: 'The processor is busy',
        message: `Processor use has stayed above ${String(threshold)} % for over ${minutes(RESOURCE_GRACE_MS)} minutes. That is expected while a node or an Electrum server catches up.`,
        route: '/monitoring',
        graceMs: RESOURCE_GRACE_MS,
      });
    }

    if (inputs.tor?.state === 'failed') {
      conditions.push({
        id: 'tor.failed',
        rule: 'tor.failed',
        severity: 'warning',
        component: 'Tor',
        title: 'Tor stopped working',
        message:
          inputs.tor.error?.message ?? 'tor stopped unexpectedly; nodes that connect only through Tor have no peers.',
        route: '/tor',
      });
    }
    if (inputs.tor && torOffline(inputs.tor)) {
      conditions.push({
        id: 'tor.disconnected',
        rule: 'tor.disconnected',
        severity: 'warning',
        component: 'Tor',
        title: 'Tor has lost the network',
        message:
          'tor runs but cannot reach the Tor network; nodes that connect only through Tor have no peers until it can.',
        route: '/tor',
        graceMs: TOR_DISCONNECTED_GRACE_MS,
      });
    }
    if (inputs.tor?.state === 'starting' && inputs.tor.bootstrap?.stalled === true) {
      conditions.push({
        id: 'tor.bootstrap-stalled',
        rule: 'tor.bootstrap-stalled',
        severity: 'warning',
        component: 'Tor',
        title: 'Tor cannot connect',
        message: `Connecting to the Tor network has not progressed for two minutes (${String(inputs.tor.bootstrap.progress)} %)${
          inputs.tor.bootstrap.problem ? `: ${inputs.tor.bootstrap.problem.warning}` : ''
        }. The network may block Tor, or this computer’s clock may be wrong.`,
        route: '/tor',
      });
    }

    for (const server of inputs.electrum?.servers ?? []) {
      if (server.state !== 'failed') continue;
      const node = inputs.nodes.find((candidate) => candidate.profile.id === server.nodeId);
      const name = node?.profile.name ?? 'a node';
      conditions.push({
        id: `electrum.failed:${server.nodeId}`,
        rule: 'electrum.failed',
        severity: 'warning',
        component: `Electrum server (${name})`,
        title: `The Electrum server of ${name} stopped`,
        message:
          server.error?.message ?? 'Fulcrum stopped and was not started again; wallets using it lose their connection.',
        route: '/electrum',
      });
    }

    for (const { server, status } of inputs.payments) {
      if (status.state !== 'unreachable' && status.state !== 'unauthorised') continue;
      conditions.push({
        id: `payments.unavailable:${server.id}`,
        rule: 'payments.unavailable',
        severity: 'warning',
        component: `Payments (${server.name})`,
        title:
          status.state === 'unauthorised'
            ? `${server.name} refuses BTCortex’s API key`
            : `${server.name} does not answer`,
        message: status.error ?? 'BTCPay Server could not be reached.',
        route: '/payments',
        graceMs: PAYMENTS_GRACE_MS,
      });
    }

    for (const { server, status } of inputs.remoteElectrum) {
      if (status.state === 'online' || status.state === 'unknown') continue;
      conditions.push({
        id: `electrum.remote.unavailable:${server.id}`,
        rule: 'electrum.remote.unavailable',
        // A certificate that changed may mean someone is in between.
        severity: status.state === 'certificate-changed' ? 'critical' : 'warning',
        component: `Electrum servers (${server.name})`,
        title:
          status.state === 'certificate-changed'
            ? `${server.name} presented another certificate`
            : status.state === 'wrong-chain'
              ? `${server.name} follows another chain`
              : `${server.name} does not answer`,
        message: status.error ?? 'The Electrum server could not be reached.',
        route: '/electrum',
        ...(status.state === 'unreachable' ? { graceMs: REMOTE_ELECTRUM_GRACE_MS } : {}),
      });
    }

    for (const { explorer, status } of inputs.remoteExplorers) {
      if (status.state === 'online' || status.state === 'unknown') continue;
      conditions.push({
        id: `explorers.remote.unavailable:${explorer.id}`,
        rule: 'explorers.remote.unavailable',
        severity: 'warning',
        component: `Block explorers (${explorer.name})`,
        title:
          status.state === 'wrong-chain'
            ? `${explorer.name} follows another chain`
            : `${explorer.name} does not answer`,
        message: status.error ?? 'The explorer could not be reached.',
        route: '/explorer',
        ...(status.state === 'unreachable' ? { graceMs: REMOTE_ELECTRUM_GRACE_MS } : {}),
      });
    }

    for (const { connection, status } of inputs.lightning) {
      const name = status.alias ?? connection.name;
      const route = `/lightning?connection=${connection.id}`;
      if (['unreachable', 'unauthorised', 'failed', 'locked'].includes(status.state)) {
        conditions.push({
          id: `lightning.unavailable:${connection.id}`,
          rule: 'lightning.unavailable',
          severity: 'warning',
          component: `Lightning (${name})`,
          title: status.state === 'locked' ? `The wallet of ${name} is locked` : `BTCortex cannot read ${name}`,
          message: status.error?.message ?? 'LND’s wallet is locked; unlock it with LND’s own tools.',
          route,
          graceMs: LIGHTNING_GRACE_MS,
        });
      }
      const macaroonExpiry =
        connection.macaroon.expiresAt === undefined ? Number.NaN : Date.parse(connection.macaroon.expiresAt);
      if (Number.isFinite(macaroonExpiry) && macaroonExpiry - now < MACAROON_WARNING_MS) {
        conditions.push({
          id: `lightning.macaroon-expiring:${connection.id}`,
          rule: 'lightning.macaroon-expiring',
          severity: 'warning',
          component: `Lightning (${name})`,
          title:
            macaroonExpiry <= now ? `The macaroon for ${name} has expired` : `The macaroon for ${name} expires soon`,
          message: `It ${macaroonExpiry <= now ? 'stopped' : 'stops'} working on ${new Date(macaroonExpiry).toISOString().slice(0, 10)}; connect again with a new one.`,
          route,
        });
      }
      const certificateExpiry =
        connection.certificateExpiresAt === null ? Number.NaN : Date.parse(connection.certificateExpiresAt);
      if (Number.isFinite(certificateExpiry) && certificateExpiry - now < CERTIFICATE_WARNING_MS) {
        const expired = certificateExpiry <= now;
        conditions.push({
          id: `lightning.certificate-expiring:${connection.id}`,
          rule: 'lightning.certificate-expiring',
          severity: 'warning',
          component: `Lightning (${name})`,
          title: expired ? `The TLS certificate of ${name} has expired` : `The TLS certificate of ${name} expires soon`,
          message: `It ${expired ? 'expired' : 'expires'} on ${new Date(certificateExpiry).toISOString().slice(0, 10)}. LND makes a new one when it restarts after that date; connect again with the new tls.cert then.`,
          route,
        });
      }
    }

    const backups = inputs.backups;
    if (backups?.lastRun?.outcome === 'failed') {
      conditions.push({
        id: 'backup.failed',
        rule: 'backup.failed',
        severity: 'warning',
        component: 'Backups',
        title: 'The last backup failed',
        message: backups.lastRun.message ?? 'The backup could not be written.',
        route: '/backups',
      });
    }
    if (
      backups !== undefined &&
      backups.destination !== null &&
      backups.schedule.everyHours > 0 &&
      backups.lastRun?.outcome === 'succeeded' &&
      now - Date.parse(backups.lastRun.at) > 2 * backups.schedule.everyHours * 60 * 60 * 1000
    ) {
      conditions.push({
        id: 'backup.overdue',
        rule: 'backup.overdue',
        severity: 'warning',
        component: 'Backups',
        title: 'Automatic backups are overdue',
        message: `The last successful backup was ${String(Math.round((now - Date.parse(backups.lastRun.at)) / 3_600_000))} hours ago.`,
        route: '/backups',
      });
    }

    for (const update of inputs.updates) {
      conditions.push({
        id: `update.available:${update.product}`,
        rule: 'update.available',
        severity: update.security ? 'warning' : 'info',
        component: update.name,
        title: `${update.name} ${update.latest} is available`,
        message: update.security
          ? `${update.security.reason} The update centre shows what the update touches.`
          : 'The update centre shows what the update touches and its release notes.',
        route: '/updates',
      });
    }

    for (const notice of inputs.configNotices) {
      const changes = notice.changes.map(describeChange).join('; ');
      conditions.push({
        id: `config.changed:${notice.nodeId}`,
        rule: 'config.changed',
        severity: notice.byBtcortex ? 'info' : 'warning',
        component: notice.nodeName,
        title: notice.byBtcortex
          ? `Security settings of ${notice.nodeName} changed`
          : `bitcoin.conf of ${notice.nodeName} changed outside BTCortex`,
        message: notice.byBtcortex
          ? `Changed in BTCortex: ${changes}.`
          : `Settings that can open the node to other computers, run programs or change how it signs in or connects were changed: ${changes}. If you did not make this change, look at the file now.`,
        route: `/nodes/${notice.nodeId}/configuration`,
      });
    }
    return conditions;
  }

  private async runCheck(): Promise<HealthSummary> {
    const now = this.now();
    const settings = this.settings();
    this.updateProcessors();
    const inputs = await this.gather();
    const observed = this.conditions(inputs, now.getTime(), settings);
    const open = new Map(this.options.alerts.open().map((alert) => [alert.id, alert]));

    // Graced conditions become alerts once they have lasted long enough, or at once when already open.
    const seen = new Set(observed.map((condition) => condition.id));
    for (const id of this.firstSeen.keys()) if (!seen.has(id)) this.firstSeen.delete(id);
    const active = observed.filter((condition) => {
      if (condition.graceMs === undefined || open.has(condition.id)) return true;
      const first = this.firstSeen.get(condition.id) ?? now.getTime();
      this.firstSeen.set(condition.id, first);
      return now.getTime() - first >= condition.graceMs;
    });

    const raised: Alert[] = [];
    const resolved: Alert[] = [];
    const activeIds = new Set(active.map((condition) => condition.id));
    for (const condition of active) {
      const existing = open.get(condition.id);
      const fields = {
        id: condition.id,
        rule: condition.rule,
        severity: condition.severity,
        component: condition.component,
        title: condition.title,
        message: condition.message,
        route: condition.route,
      };
      if (!existing) {
        raised.push(this.options.alerts.raise(fields, now));
      } else if (
        existing.severity !== fields.severity ||
        existing.title !== fields.title ||
        existing.message !== fields.message ||
        existing.route !== fields.route
      ) {
        this.options.alerts.refresh(fields, now);
      }
    }
    for (const [id] of open) {
      if (activeIds.has(id)) continue;
      const alert = this.options.alerts.resolve(id, now);
      if (alert) resolved.push(alert);
    }
    const stillOpen = this.options.alerts.open();
    if (raised.length > 0 || resolved.length > 0) {
      for (const alert of raised) {
        this.options.logger.warn('Alert raised', { id: alert.id, severity: alert.severity, title: alert.title });
      }
      for (const alert of resolved) this.options.logger.info('Alert resolved', { id: alert.id });
      this.options.publish({
        type: 'alerts.changed',
        at: now.toISOString(),
        payload: { raised, resolved, open: stillOpen.length },
      });
    }

    const memory = this.memoryUse();
    const services = this.services(inputs, now.getTime());
    const critical = stillOpen.filter((alert) => alert.severity === 'critical').length;
    const warning = stillOpen.filter((alert) => alert.severity === 'warning').length;
    const healths = services.map((service) => service.health);
    const summary: HealthSummary = {
      checkedAt: now.toISOString(),
      overall:
        healths.includes('failed') || critical > 0
          ? 'failed'
          : healths.includes('attention') || warning > 0
            ? 'attention'
            : healths.every((health) => health === 'unknown')
              ? 'unknown'
              : 'healthy',
      services,
      resources: {
        cpuPercent: this.cpuPercent,
        memoryUsedBytes: memory.used,
        memoryTotalBytes: memory.total,
        volumes: inputs.volumes,
        activity: this.activity,
      },
      alerts: { open: stillOpen.length, critical, warning },
      recentErrors: this.options.recentErrors?.(now) ?? { count: 0, latest: [] },
    };
    this.latest = summary;
    return summary;
  }

  private services(inputs: Inputs, now: number): HealthService[] {
    const plural = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;

    const nodeStates = inputs.nodes.map((node) => node.status.state);
    const running = nodeStates.filter((state) => state === 'running').length;
    const nodes: HealthService = {
      id: 'nodes',
      route: '/nodes',
      health:
        inputs.nodes.length === 0
          ? 'unknown'
          : nodeStates.includes('failed')
            ? 'failed'
            : nodeStates.some((state) => state === 'unreachable' || state === 'unauthorised')
              ? 'attention'
              : nodeStates.some((state) => state === 'starting' || state === 'stopping')
                ? 'working'
                : running > 0
                  ? 'healthy'
                  : 'inactive',
      summary:
        inputs.nodes.length === 0
          ? 'No node yet.'
          : `${plural(inputs.nodes.length, 'node', 'nodes')}, ${String(running)} running.`,
    };

    const tor = inputs.tor;
    const torStalled = tor?.state === 'starting' && tor.bootstrap?.stalled === true;
    const torHealth: ServiceHealth =
      tor === undefined
        ? 'unknown'
        : tor.state === 'failed'
          ? 'failed'
          : torOffline(tor) || torStalled
            ? 'attention'
            : tor.state === 'running'
              ? (tor.bootstrap?.progress ?? 0) >= 100
                ? 'healthy'
                : 'working'
              : tor.state === 'starting' || tor.state === 'stopping'
                ? 'working'
                : tor.state === 'not-installed'
                  ? 'unknown'
                  : 'inactive';
    const torService: HealthService = {
      id: 'tor',
      route: '/tor',
      health: torHealth,
      summary:
        tor === undefined
          ? 'The state of tor is not known.'
          : torOffline(tor)
            ? 'Running, but cut off from the Tor network.'
            : torStalled
              ? `Cannot connect to the Tor network (${String(tor.bootstrap?.progress ?? 0)} %, no progress for two minutes).`
              : tor.state === 'running'
                ? (tor.bootstrap?.progress ?? 0) >= 100
                  ? 'Connected to the Tor network.'
                  : `Connecting to the Tor network (${String(tor.bootstrap?.progress ?? 0)} %).`
                : tor.state === 'not-installed'
                  ? 'Not set up.'
                  : tor.state === 'failed'
                    ? 'Stopped unexpectedly.'
                    : tor.state === 'stopped'
                      ? 'Stopped.'
                      : 'Starting.',
    };

    const servers = (inputs.electrum?.servers ?? []).filter((server) => server.state !== 'not-set-up');
    const indexing = servers.filter((server) => server.state === 'indexing' && server.progress !== undefined);
    const electrum: HealthService = {
      id: 'electrum',
      route: '/electrum',
      health:
        servers.length === 0
          ? 'unknown'
          : servers.some((server) => server.state === 'failed')
            ? 'failed'
            : servers.some((server) => ['starting', 'indexing', 'waiting', 'stopping'].includes(server.state))
              ? 'working'
              : servers.some((server) => server.state === 'ready')
                ? 'healthy'
                : 'inactive',
      summary:
        servers.length === 0
          ? 'No Electrum server.'
          : `${plural(servers.length, 'server', 'servers')}, ${String(servers.filter((server) => server.state === 'ready').length)} ready.${
              indexing.length > 0
                ? ` Indexing ${indexing.map((server) => `${String(Math.floor((server.progress ?? 0) * 100))} %`).join(', ')}.`
                : ''
            }`,
    };

    const connections = inputs.lightning;
    const lightningStates = connections.map(({ status }) => status.state);
    const lightning: HealthService = {
      id: 'lightning',
      route: '/lightning',
      health:
        connections.length === 0
          ? 'unknown'
          : lightningStates.some((state) => ['unreachable', 'unauthorised', 'failed', 'locked'].includes(state))
            ? 'attention'
            : lightningStates.some((state) => state === 'syncing' || state === 'checking')
              ? 'working'
              : 'healthy',
      summary:
        connections.length === 0
          ? 'No Lightning node connected.'
          : `${plural(connections.length, 'LND node', 'LND nodes')}, ${String(lightningStates.filter((state) => state === 'ready').length)} ready.`,
    };

    const settings = inputs.backups;
    const lastRun = settings?.lastRun ?? null;
    const overdue =
      settings !== undefined &&
      settings.schedule.everyHours > 0 &&
      lastRun?.outcome === 'succeeded' &&
      now - Date.parse(lastRun.at) > 2 * settings.schedule.everyHours * 60 * 60 * 1000;
    const backups: HealthService = {
      id: 'backups',
      route: '/backups',
      health:
        settings === undefined || settings.destination === null
          ? 'unknown'
          : lastRun?.outcome === 'failed'
            ? 'failed'
            : lastRun === null || overdue
              ? 'attention'
              : 'healthy',
      summary:
        settings === undefined || settings.destination === null
          ? 'No backup folder chosen.'
          : lastRun === null
            ? 'No backup yet.'
            : lastRun.outcome === 'failed'
              ? 'The last backup failed.'
              : overdue
                ? 'Automatic backups are overdue.'
                : `Last backup ${utc(lastRun.at)}.`,
    };

    // Payments appear once a BTCPay Server is connected; most people never use one.
    const paymentStates = inputs.payments.map(({ status }) => status.state);
    const payments: HealthService | undefined =
      inputs.payments.length === 0
        ? undefined
        : {
            id: 'payments',
            route: '/payments',
            health: paymentStates.some((state) => state === 'unreachable' || state === 'unauthorised')
              ? 'attention'
              : paymentStates.some((state) => state === 'synchronising' || state === 'checking')
                ? 'working'
                : 'healthy',
            summary: `${plural(inputs.payments.length, 'BTCPay Server', 'BTCPay Servers')}, ${String(paymentStates.filter((state) => state === 'online').length)} online.`,
          };

    return [nodes, torService, electrum, lightning, ...(payments ? [payments] : []), backups];
  }

  // Exports

  /** A series' name in exports, with the node's name for node metrics. */
  private seriesLabel(series: MetricSeries): string {
    const { kind, nodeId } = describeSeries(series);
    if (nodeId === null) return METRIC_LABELS[kind];
    const name = this.options.nodes().find((node) => node.profile.id === nodeId)?.profile.name ?? 'Removed node';
    return `${name}: ${METRIC_LABELS[kind]}`;
  }

  async export(params: MonitoringExportParams): Promise<MonitoringExport> {
    const now = this.now();
    const settings = this.settings();
    const stamp = now.toISOString().slice(0, 19).replaceAll(':', '-');
    let name: string;
    let contents: string;
    if (params.kind === 'metrics') {
      const rows = this.options.metrics.table(params.series, params.hours, now, settings.detailedHours);
      const header = ['Time (UTC)', ...params.series.map((series) => this.seriesLabel(series))].map(csvField);
      contents = [header, ...rows.map((row) => [row.at, ...row.values.map(csvNumber)])]
        .map((fields) => `${fields.join(',')}\r\n`)
        .join('');
      name = `${EXPORT_PREFIX}metrics-${stamp}.csv`;
    } else {
      contents = await this.report(params.hours, now, settings);
      name = `${EXPORT_PREFIX}report-${stamp}.txt`;
    }
    const directory = this.options.paths.exports;
    await mkdir(directory, { recursive: true });
    const path = join(directory, name);
    await writeFile(`${path}.tmp`, contents, 'utf8');
    await rename(`${path}.tmp`, path);
    const exports = (await readdir(directory))
      .filter((file) => file.startsWith(EXPORT_PREFIX))
      .sort()
      .reverse();
    for (const old of exports.slice(KEPT_EXPORTS)) await unlink(join(directory, old)).catch(() => undefined);
    this.options.logger.info('Exported monitoring data', { path, kind: params.kind, hours: params.hours });
    return { path, createdAt: now.toISOString(), sizeBytes: Buffer.byteLength(contents) };
  }

  /** Shows an export in File Explorer; only files BTCortex exported are accepted. */
  revealExport(path: string): void {
    const target = resolve(path);
    const isExport =
      dirname(target) === resolve(this.options.paths.exports) &&
      basename(target).startsWith(EXPORT_PREFIX) &&
      /\.(csv|txt)$/.test(target) &&
      existsSync(target);
    if (!isExport) {
      throw new AppFailure({
        code: 'monitoring.not-an-export',
        message: 'That file is not a monitoring export created by BTCortex.',
        component: 'Monitoring',
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    (this.options.reveal ?? revealInExplorer)(target);
  }

  private async report(hours: number, now: Date, settings: MonitoringSettings): Promise<string> {
    const health = await this.check();
    const since = new Date(now.getTime() - hours * 3600 * 1000);
    const lines: string[] = [
      'BTCortex monitoring report',
      '',
      `Created: ${utc(now)}`,
      `Period: the last ${period(hours)}, from ${utc(since)}`,
      '',
      `Overall: ${OVERALL_WORDS[health.overall]}.`,
      '',
      'Services',
      ...health.services.map((service) => `- ${SERVICE_NAMES[service.id]}: ${service.summary}`),
      '',
      'This computer',
      `- Processor: ${health.resources.cpuPercent === null ? 'not measured yet' : `${health.resources.cpuPercent.toFixed(0)} %`}`,
      `- Memory: ${GiB(health.resources.memoryUsedBytes)} of ${GiB(health.resources.memoryTotalBytes)} in use`,
      ...health.resources.volumes.map(
        (volume) =>
          `- Disk ${volume.root}: ${GiB(volume.freeBytes)} free of ${GiB(volume.totalBytes)} (${volume.uses.join(', ')})`,
      ),
      '',
    ];
    const open = this.options.alerts.open();
    lines.push(`Open alerts: ${String(open.length)}`);
    for (const alert of open) {
      lines.push(`- [${alert.severity}] ${alert.title} (${alert.component}), since ${utc(alert.raisedAt)}`);
      lines.push(`  ${alert.message}`);
    }
    const raised = this.options.alerts.raisedSince(since);
    lines.push('', `Alerts raised in the period: ${String(raised.length)}`);
    for (const alert of raised) {
      lines.push(
        `- ${utc(alert.raisedAt)} [${alert.severity}] ${alert.title} (${alert.component})${alert.resolvedAt === null ? '' : `, resolved ${utc(alert.resolvedAt)}`}`,
      );
    }
    const statistics = this.options.metrics.statistics(hours, now, settings.detailedHours);
    lines.push('', 'Metrics in the period: minimum / average / maximum');
    if (statistics.length === 0) lines.push('- No samples recorded in the period.');
    for (const entry of statistics) {
      const figure = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
      lines.push(
        `- ${this.seriesLabel(entry.series)}: ${figure(entry.minimum)} / ${figure(entry.average)} / ${figure(entry.maximum)} (${String(entry.samples)} ${entry.samples === 1 ? 'sample' : 'samples'})`,
      );
    }
    lines.push(
      '',
      `Errors BTCortex logged in the last 24 hours: ${String(health.recentErrors.count)}`,
      ...health.recentErrors.latest.map((error) => `- ${utc(error.at)} ${error.component}: ${error.message}`),
      '',
      `Samples are kept minute by minute for ${String(settings.detailedHours)} hours and as hourly averages for ${String(settings.historyDays)} days, only while BTCortex runs.`,
      '',
    );
    return lines.join('\r\n');
  }
}
