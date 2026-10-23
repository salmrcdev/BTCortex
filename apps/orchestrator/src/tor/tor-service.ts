import { existsSync, mkdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppFailure, TorPortsSchema } from '@btcortex/contracts';
import type {
  AppError,
  ExternalTor,
  LogSeverity,
  OrchestratorEvent,
  TorLogLine,
  TorPorts,
  TorSettingsChange,
  TorState,
  TorStatus,
} from '@btcortex/contracts';
import type { InstallProgress } from '@btcortex/installation-manager';
import {
  buildTorrc,
  connectAuthenticated,
  DEFAULT_TOR_PORTS,
  detectExternalTor,
  fetchLatestTorVersion,
  installTor,
  isAcceptingConnections,
  isProcessAlive,
  isTorCompatiblePath,
  listInstalledTor,
  parseArguments,
  parseBootstrapStatus,
  parseTorLogLine,
  readTorLogTail,
  readTorVersion,
  startTorProcess,
  torArguments,
  torLayout,
  TORRC_DEFAULTS,
} from '@btcortex/integration-tor';
import type {
  BootstrapStatus,
  ControlEvent,
  OnionPort,
  TorControlConnection,
  TorProcess,
  TorRuntime,
} from '@btcortex/integration-tor';
import { describeInstallationFailure } from '../jobs/installation-errors';
import type { JobManager } from '../jobs/job-manager';
import type { Logger } from '../logging/logger';
import { TOR_LOG_FILE } from '../logs/log-service';
import type { SettingsStore } from '../persistence/settings';
import { chooseLoopbackPort, isLoopbackPortFree } from '../platform/ports';
import { shortFolderPath } from '../platform/short-path';

// BTCortex's own tor (specification section 10; privacy-networking.md §2):
// the newest verified Expert Bundle, run per user with loopback listeners and
// SAFECOOKIE control authentication. Its state comes from tor itself over the
// control port: bootstrap progress and problems, circuits, network liveness.
// tor runs detached, like the nodes it serves, so a node that keeps running
// after BTCortex closes keeps its Tor connections; when BTCortex starts and
// finds its tor still running, it connects to it again instead of starting
// another one.

const COMPONENT = 'Tor';
const SETTINGS_KEY = 'tor';
const RECENT_LINES = 200;
const SHOWN_LINES = 50;
const CONTROL_WAIT_MS = 45_000;
const STOP_WAIT_MS = 10_000;
const STALL_MS = 120_000;
const EXTERNAL_REUSE_MS = 30_000;
const PUBLISH_DELAY_MS = 250;
const RESTART_DELAYS_MS = [5_000, 15_000, 45_000] as const;
const FAILURE_WINDOW_MS = 10 * 60_000;
const PORT_NAMES = ['socks', 'applicationSocks', 'control'] as const;
const FALLBACK_RANGES: Record<keyof TorPorts, readonly [number, number]> = {
  socks: [19050, 19059],
  applicationSocks: [19060, 19069],
  control: [19070, 19079],
};
const EVENTS = ['STATUS_CLIENT', 'STATUS_GENERAL', 'NETWORK_LIVENESS', 'NOTICE', 'WARN', 'ERR'];
const EVENT_SEVERITIES: Record<string, LogSeverity> = { NOTICE: 'info', WARN: 'warning', ERR: 'error' };
const LINE_SEVERITIES: Record<string, LogSeverity> = {
  err: 'error',
  warn: 'warning',
  notice: 'info',
  info: 'debug',
  debug: 'debug',
};

const TorSettingsSchema = z.object({
  autoStart: z.boolean(),
  /** Chosen at the first start and kept, so that node settings pointing at them stay valid. */
  ports: TorPortsSchema.optional(),
  /** The bundle and process BTCortex started last, to recognise them in a later session. */
  started: z.object({ version: z.string(), pid: z.number().int().positive() }).optional(),
});
type TorSettings = z.infer<typeof TorSettingsSchema>;

/** A node whose configuration routes through BTCortex's tor, or a service BTCortex publishes through it. */
export interface TorUser {
  id: string;
  name: string;
  running: boolean;
  keepRunningOnExit: boolean;
  /** `electrum`: a node's Electrum server, reachable as an onion service. */
  kind?: 'node' | 'electrum';
}

/** An onion service BTCortex publishes through its tor for one of its own services. */
export interface OnionServiceRequest {
  /** Who asked, for example `electrum:<node id>`. */
  id: string;
  ports: OnionPort[];
  /** The identity published before; a new one is made when omitted. */
  identity?: { privateKey: string; serviceId: string };
}

interface RegisteredOnion {
  ports: OnionPort[];
  privateKey: string;
  serviceId: string;
}

export interface TorServiceOptions {
  /** Parent of the verified Expert Bundle folders. */
  runtimesDirectory: string;
  /** BTCortex's tor folder: torrc, data directory, control cookie. */
  home: string;
  logsDirectory: string;
  downloadsDirectory: string;
  settings: Pick<SettingsStore, 'get' | 'set'>;
  jobs: Pick<JobManager, 'run'>;
  publish: (event: OrchestratorEvent) => void;
  logger: Logger;
  users: () => Promise<TorUser[]>;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Replaced in tests. */
  latestVersion?: () => Promise<string>;
  install?: (version: string, onProgress: (progress: InstallProgress) => void) => Promise<void>;
  detectExternal?: (skipPorts: readonly number[]) => Promise<ExternalTor[]>;
  /** Tests only: tor starts with DisableNetwork, so it never contacts the Tor network. */
  offline?: boolean;
}

interface Current {
  /** The bundle tor was started from, when known. */
  version: string | null;
  pid: number;
  control: TorControlConnection;
  /** Present when this BTCortex session started tor. */
  process?: TorProcess;
}

interface BootstrapState {
  progress: number;
  summary: string;
  tag: string;
  problem?: { warning: string; reason?: string; count?: number };
  changedAt: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What tor's last notices say about why it stopped. */
export function likelyCause(lines: readonly string[]): string {
  const text = lines.join('\n');
  const bind = /Could not bind to [^:\s]+:(\d+)/.exec(text);
  if (bind) return `Another program already uses port ${bind[1] ?? ''}.`;
  if (/another Tor process is running with the same data directory/i.test(text)) {
    return 'Another tor uses BTCortex’s tor folder.';
  }
  if (/Failed to parse\/validate config|Reading config failed/i.test(text)) return 'tor refused its configuration.';
  if (/Permission denied|Access is denied|No such file/i.test(text)) return 'tor could not open one of its files.';
  return 'tor stopped without saying why; its last notices are attached.';
}

/** Lines from tor's log file carry a local time without the year. */
function lineTime(line: string, now: Date): Date {
  const parsed = new Date(`${line.slice(0, 6)} ${String(now.getFullYear())} ${line.slice(7, 19)}`);
  if (Number.isNaN(parsed.getTime())) return now;
  // Lines from the end of last year, read in January.
  if (parsed.getTime() - now.getTime() > 86_400_000) parsed.setFullYear(parsed.getFullYear() - 1);
  return parsed;
}

export class TorService {
  private state: TorState = 'stopped';
  private current: Current | undefined;
  private newest: TorRuntime | undefined;
  private bootstrap: BootstrapState | undefined;
  private circuitEstablished = false;
  private liveness: 'up' | 'down' | null = null;
  private versionStatus: string | null = null;
  private traffic: TorStatus['traffic'] = null;
  private startedAt: string | null = null;
  private clockSkewSeconds: number | undefined;
  private error: AppError | undefined;
  private recent: TorLogLine[] = [];
  /** tor should be running: started by the user, by a node or at BTCortex's start. */
  private wanted = false;
  private closing = false;
  private failures: number[] = [];
  private restartTimer: NodeJS.Timeout | undefined;
  private publishTimer: NodeJS.Timeout | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private users: TorUser[] = [];
  private external: { at: number; value: ExternalTor[] } | undefined;
  private readonly torVersions = new Map<string, string>();
  private readonly usablePaths = new Map<string, string>();
  /** Published again whenever tor starts, for as long as BTCortex runs. */
  private readonly onions = new Map<string, RegisteredOnion>();

  constructor(private readonly options: TorServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private get logFile(): string {
    return join(this.options.logsDirectory, TOR_LOG_FILE);
  }

  private settings(): TorSettings {
    return this.options.settings.get(SETTINGS_KEY, TorSettingsSchema) ?? { autoStart: true };
  }

  private saveSettings(change: Partial<TorSettings>): void {
    this.options.settings.set(SETTINGS_KEY, { ...this.settings(), ...change });
  }

  /** The ports tor uses, or will use when it first starts. */
  ports(): TorPorts {
    return this.settings().ports ?? DEFAULT_TOR_PORTS;
  }

  /** Whether BTCortex's tor runs now (connecting or connected). */
  isRunning(): boolean {
    return this.current !== undefined;
  }

  /** The bundle version of the running tor, for the installed-software page. */
  runningVersion(): string | null {
    return this.current?.version ?? null;
  }

  /** Starts and stops run one at a time. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private failure(code: string, message: string, extra: Partial<AppError> = {}): AppFailure {
    return new AppFailure({ code, message, component: COMPONENT, dataRisk: 'none', recoveryActions: [], ...extra });
  }

  /** Records a failure as tor's state and returns it, to be thrown. */
  private fail(failure: AppFailure): AppFailure {
    this.error = failure.error;
    this.state = 'failed';
    this.schedulePublish();
    return failure;
  }

  private setState(state: TorState): void {
    this.state = state;
    this.schedulePublish();
  }

  private schedulePublish(): void {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined;
      this.options.publish({ type: 'tor.status', at: this.now().toISOString(), payload: this.snapshot() });
    }, PUBLISH_DELAY_MS);
    this.publishTimer.unref();
  }

  private resetHealth(): void {
    this.bootstrap = undefined;
    this.circuitEstablished = false;
    this.liveness = null;
    this.traffic = null;
    this.startedAt = null;
    this.clockSkewSeconds = undefined;
  }

  private remember(severity: LogSeverity, message: string, time = this.now()): void {
    this.recent.push({ time: time.toISOString(), severity, message });
    if (this.recent.length > RECENT_LINES) this.recent.splice(0, this.recent.length - RECENT_LINES);
  }

  private snapshot(): TorStatus {
    const newest = this.newest;
    const bootstrap = this.bootstrap;
    const skew = this.clockSkewSeconds;
    const problem =
      bootstrap?.problem ??
      (skew !== undefined && Math.abs(skew) >= 60 && (bootstrap?.progress ?? 0) < 100
        ? {
            warning: `The clock of this computer differs from the Tor network’s by about ${String(Math.round(Math.abs(skew) / 60))} minutes.`,
            reason: 'CLOCK_SKEW',
          }
        : undefined);
    return {
      state: this.state,
      installed: newest
        ? {
            version: newest.version,
            torVersion: this.torVersions.get(newest.executable) ?? null,
            verifiedAt: newest.verification.verifiedAt,
          }
        : null,
      runningVersion: this.current?.version ?? null,
      autoStart: this.settings().autoStart,
      ports: this.ports(),
      bootstrap: bootstrap
        ? {
            progress: bootstrap.progress,
            summary: bootstrap.summary,
            tag: bootstrap.tag,
            ...(problem ? { problem } : {}),
            stalled: bootstrap.progress < 100 && this.now().getTime() - bootstrap.changedAt > STALL_MS,
          }
        : null,
      circuitEstablished: this.circuitEstablished,
      networkLiveness: this.liveness,
      versionStatus: this.versionStatus,
      startedAt: this.startedAt,
      traffic: this.traffic,
      pid: this.current?.pid ?? null,
      ...(this.error ? { error: this.error } : {}),
      recentLines: this.recent.slice(-SHOWN_LINES),
      external: this.external?.value ?? [],
      usedBy: this.users.map(({ id, name, running, kind }) => ({ id, name, running, kind: kind ?? 'node' })),
    };
  }

  async status(): Promise<TorStatus> {
    await this.refreshInstalled();
    if (this.current) await this.refreshCounters(this.current.control);
    this.users = await this.options.users().catch(() => this.users);
    await this.refreshExternal();
    return this.snapshot();
  }

  private async refreshInstalled(): Promise<void> {
    this.newest = (await listInstalledTor(this.options.runtimesDirectory))[0];
    const newest = this.newest;
    if (newest && !this.torVersions.has(newest.executable)) {
      try {
        this.torVersions.set(newest.executable, await readTorVersion(newest.executable));
      } catch (error) {
        this.options.logger.warn('tor did not report its version', { error });
      }
    }
    if (!this.current && (this.state === 'not-installed' || this.state === 'stopped')) {
      this.state = newest ? 'stopped' : 'not-installed';
    }
  }

  private async refreshExternal(): Promise<void> {
    const now = this.now().getTime();
    if (this.external && now - this.external.at < EXTERNAL_REUSE_MS) return;
    // While BTCortex's tor runs, its own ports are not someone else's.
    const skip = this.current ? Object.values(this.ports()) : [];
    const detect = this.options.detectExternal ?? detectExternalTor;
    this.external = { at: now, value: await detect(skip).catch(() => []) };
  }

  private async refreshCounters(control: TorControlConnection): Promise<void> {
    const read = async (key: string) => {
      try {
        return (await control.getInfo([key])).get(key);
      } catch {
        return undefined;
      }
    };
    const [phase, circuit, liveness, version, received, sent, uptime] = await Promise.all([
      read('status/bootstrap-phase'),
      read('status/circuit-established'),
      read('network-liveness'),
      read('status/version/current'),
      read('traffic/read'),
      read('traffic/written'),
      read('uptime'),
    ]);
    const parsed = phase === undefined ? undefined : parseBootstrapStatus(phase);
    if (parsed) this.applyBootstrap(parsed);
    if (circuit !== undefined) this.circuitEstablished = circuit.trim() === '1';
    if (liveness !== undefined) this.liveness = liveness.trim().toLowerCase() === 'up' ? 'up' : 'down';
    if (version !== undefined && version.trim() !== '') this.versionStatus = version.trim();
    if (received !== undefined && sent !== undefined) {
      this.traffic = { readBytes: Number(received) || 0, writtenBytes: Number(sent) || 0 };
    }
    const seconds = Number(uptime);
    if (uptime !== undefined && Number.isFinite(seconds)) {
      this.startedAt = new Date(this.now().getTime() - seconds * 1000).toISOString();
    }
    this.updateState();
  }

  private applyBootstrap(report: BootstrapStatus): void {
    const previous = this.bootstrap;
    const now = this.now().getTime();
    const moved = previous?.progress !== report.progress;
    const problem =
      report.severity !== 'NOTICE' && report.recommendation === 'warn' && report.warning !== undefined
        ? {
            warning: report.warning,
            ...(report.reason === undefined ? {} : { reason: report.reason }),
            ...(report.count === undefined ? {} : { count: report.count }),
          }
        : moved
          ? undefined
          : previous.problem;
    this.bootstrap = {
      progress: report.progress,
      summary: report.summary === '' ? (previous?.summary ?? '') : report.summary,
      tag: report.tag,
      ...(problem ? { problem } : {}),
      changedAt: moved ? now : previous.changedAt,
    };
    if (report.progress === 100) this.clockSkewSeconds = undefined;
  }

  private updateState(): void {
    if (!this.current || this.state === 'stopping') return;
    const next: TorState = this.bootstrap?.progress === 100 ? 'running' : 'starting';
    if (next === 'running' && this.state !== 'running') {
      this.error = undefined;
      this.failures = [];
    }
    this.setState(next);
  }

  private handleEvent(event: ControlEvent): void {
    const severity = EVENT_SEVERITIES[event.type];
    if (severity) {
      this.remember(severity, event.body);
      this.schedulePublish();
      return;
    }
    const { positional, keywords } = parseArguments(event.body);
    if (event.type === 'STATUS_CLIENT') {
      const report = parseBootstrapStatus(event.body);
      if (report) this.applyBootstrap(report);
      else if (positional[1] === 'CIRCUIT_ESTABLISHED') this.circuitEstablished = true;
      else if (positional[1] === 'CIRCUIT_NOT_ESTABLISHED') this.circuitEstablished = false;
    } else if (event.type === 'NETWORK_LIVENESS') {
      this.liveness = positional[0]?.toUpperCase() === 'UP' ? 'up' : 'down';
    } else if (event.type === 'STATUS_GENERAL') {
      if (positional[1] === 'CLOCK_SKEW') {
        const skew = Number(keywords.get('SKEW'));
        if (Number.isFinite(skew)) this.clockSkewSeconds = skew;
      } else if (positional[1] === 'DANGEROUS_VERSION') {
        this.versionStatus = keywords.get('REASON')?.toLowerCase() ?? 'unrecommended';
      }
    }
    this.updateState();
    this.schedulePublish();
  }

  /** A folder path tor can open: the path itself, or its 8.3 short form when it has non-ASCII characters. */
  private async usablePath(path: string): Promise<string> {
    const known = this.usablePaths.get(path);
    if (known !== undefined) return known;
    let usable = path;
    if (!isTorCompatiblePath(path)) {
      mkdirSync(path, { recursive: true });
      const short = await shortFolderPath(path);
      if (short === undefined || !isTorCompatiblePath(short)) {
        throw this.fail(
          this.failure(
            'tor.path-unsupported',
            `tor cannot use the folder ${path}, because its name has characters outside the basic Latin alphabet and Windows keeps no short name for it.`,
            {
              likelyCause: 'The Windows user name contains accented or non-Latin letters (Tor issue 10416).',
              recoveryActions: [{ id: 'contact-support', label: 'Report this case so it can be supported' }],
            },
          ),
        );
      }
      usable = short;
    }
    this.usablePaths.set(path, usable);
    return usable;
  }

  private async layout(): Promise<ReturnType<typeof torLayout>> {
    return torLayout(await this.usablePath(this.options.home));
  }

  /** Free means nobody listens on it and it can be bound. */
  private async portAvailable(port: number): Promise<boolean> {
    return !(await isAcceptingConnections(port)) && (await isLoopbackPortFree(port));
  }

  private async portsForStart(): Promise<TorPorts> {
    const stored = this.settings().ports;
    if (stored) {
      for (const name of PORT_NAMES) {
        if (await this.portAvailable(stored[name])) continue;
        throw this.fail(
          this.failure(
            'tor.port-in-use',
            `Port ${String(stored[name])} is used by another program, so tor cannot start.`,
            {
              likelyCause: 'Another tor, or another program, listens on that port.',
              details: { port: stored[name], purpose: name },
              recoveryActions: [{ id: 'start-tor', label: 'Close the other program and start Tor again' }],
            },
          ),
        );
      }
      return stored;
    }
    return this.choosePorts();
  }

  /** The usual ports when free, otherwise free ones nearby; kept from then on. */
  private async choosePorts(): Promise<TorPorts> {
    const chosen = { ...DEFAULT_TOR_PORTS };
    for (const name of PORT_NAMES) {
      const port = (await this.portAvailable(DEFAULT_TOR_PORTS[name]))
        ? DEFAULT_TOR_PORTS[name]
        : await chooseLoopbackPort(FALLBACK_RANGES[name][0], FALLBACK_RANGES[name]);
      if (port === undefined) {
        throw this.fail(this.failure('tor.no-free-port', 'No free port was found for tor on this computer.'));
      }
      chosen[name] = port;
    }
    this.saveSettings({ ports: chosen });
    return chosen;
  }

  /**
   * The ports tor uses, chosen and kept now if tor has never started, so
   * that a node's settings can point at them before tor first runs.
   */
  async fixedPorts(): Promise<TorPorts> {
    return this.settings().ports ?? this.exclusive(async () => this.settings().ports ?? (await this.choosePorts()));
  }

  /** Connects to a tor BTCortex started in an earlier session, if it still runs. */
  private async attach(): Promise<boolean> {
    const settings = this.settings();
    if (!settings.ports) return false;
    const layout = await this.layout();
    if (!existsSync(layout.cookie)) return false;
    let control: TorControlConnection;
    try {
      control = await connectAuthenticated(settings.ports.control, layout.cookie, { timeoutMs: 3000 });
    } catch {
      return false;
    }
    let pid: number;
    try {
      pid = Number((await control.getInfo(['process/pid'])).get('process/pid'));
    } catch {
      control.close();
      return false;
    }
    if (!Number.isInteger(pid) || pid <= 0) {
      control.close();
      return false;
    }
    this.resetHealth();
    this.error = undefined;
    this.current = { version: settings.started?.pid === pid ? settings.started.version : null, pid, control };
    this.wanted = true;
    this.setState('starting');
    await this.watch(control);
    this.options.logger.info('Connected to the tor BTCortex started earlier', { pid });
    return true;
  }

  private seedRecentLines(): void {
    const now = this.now();
    this.recent = [];
    for (const line of readTorLogTail(this.logFile, SHOWN_LINES)) {
      const parsed = parseTorLogLine(line);
      if (parsed) this.remember(LINE_SEVERITIES[parsed.severity] ?? 'info', parsed.message, lineTime(line, now));
    }
  }

  private async watch(control: TorControlConnection): Promise<void> {
    this.seedRecentLines();
    control.onEvent((event) => {
      this.handleEvent(event);
    });
    control.onClose(() => {
      this.controlClosed(control);
    });
    await control.setEvents(EVENTS);
    await this.refreshCounters(control);
    await this.republishOnions(control);
    this.schedulePublish();
  }

  /** After tor (re)started: onion services it no longer knows are published again with their own keys. */
  private async republishOnions(control: TorControlConnection): Promise<void> {
    if (this.onions.size === 0) return;
    const detached = await control.detachedOnions().catch(() => [] as string[]);
    for (const [id, onion] of this.onions) {
      if (detached.includes(onion.serviceId)) continue;
      try {
        await control.addOnion(onion.ports, onion.privateKey);
        this.options.logger.info('Published an onion service again', { id });
      } catch (error) {
        this.options.logger.warn('An onion service could not be published again', { id, error });
      }
    }
  }

  /**
   * Publishes an onion service through BTCortex's tor, which must run, and
   * keeps publishing it whenever tor starts while BTCortex runs. The service
   * outlives BTCortex's control connection, like a node that keeps running.
   */
  async publishOnion(request: OnionServiceRequest): Promise<{ serviceId: string; privateKey: string }> {
    return this.exclusive(async () => {
      const control = this.current?.control;
      if (!control) {
        throw this.failure('tor.not-running', 'Tor is not running, so the onion service cannot be published.', {
          recoveryActions: [{ id: 'start-tor', label: 'Start Tor' }],
        });
      }
      let published: { serviceId: string; privateKey: string };
      if (request.identity) {
        // Published again with the same identity, so its ports are the ones asked for now.
        const detached = await control.detachedOnions().catch(() => [] as string[]);
        if (detached.includes(request.identity.serviceId)) {
          await control.delOnion(request.identity.serviceId).catch(() => undefined);
        }
        const { serviceId } = await control.addOnion(request.ports, request.identity.privateKey);
        published = { serviceId, privateKey: request.identity.privateKey };
      } else {
        const { serviceId, privateKey } = await control.addOnion(request.ports);
        if (privateKey === undefined) throw new Error('tor did not return the new onion service’s key.');
        published = { serviceId, privateKey };
      }
      this.onions.set(request.id, { ports: request.ports, ...published });
      this.options.logger.info('Published an onion service', { id: request.id });
      return published;
    });
  }

  /** Stops an onion service published earlier, if tor runs; it is not published again. */
  async removeOnion(id: string, serviceId?: string): Promise<void> {
    await this.exclusive(async () => {
      const known = this.onions.get(id)?.serviceId ?? serviceId;
      this.onions.delete(id);
      if (known === undefined) return;
      await this.current?.control.delOnion(known).catch(() => undefined);
    });
  }

  private async waitForControl(started: TorProcess, port: number, cookie: string): Promise<TorControlConnection> {
    const deadline = Date.now() + CONTROL_WAIT_MS;
    // An object, so that the check below sees the callback's change.
    const watch = { exited: false };
    void started.exited.then(() => {
      watch.exited = true;
    });
    while (!watch.exited && Date.now() < deadline) {
      if (existsSync(cookie)) {
        try {
          return await connectAuthenticated(port, cookie, { timeoutMs: 2000 });
        } catch {
          // Not ready yet.
        }
      }
      await delay(250);
    }
    if (!watch.exited) {
      try {
        started.child.kill();
      } catch {
        // It is already gone.
      }
    }
    const lines = readTorLogTail(this.logFile, 15);
    throw this.fail(
      this.failure(
        watch.exited ? 'tor.exited' : 'tor.no-control',
        watch.exited ? 'tor stopped while it was starting.' : 'tor did not open its control port in time.',
        {
          likelyCause: likelyCause(lines),
          details: { lastLines: lines },
          recoveryActions: [{ id: 'start-tor', label: 'Start Tor again' }],
        },
      ),
    );
  }

  private async startNow(): Promise<void> {
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    if (this.current) return;
    await this.refreshInstalled();
    const runtime = this.newest;
    if (!runtime) {
      throw this.failure('tor.not-installed', 'Tor is not installed yet.', {
        recoveryActions: [{ id: 'install-tor', label: 'Set up Tor' }],
      });
    }
    if (await this.attach()) return;
    const ports = await this.portsForStart();
    const home = await this.usablePath(this.options.home);
    const bundle = await this.usablePath(runtime.directory);
    const layout = torLayout(home);
    mkdirSync(layout.data, { recursive: true });
    mkdirSync(layout.onionAuth, { recursive: true });
    mkdirSync(this.options.logsDirectory, { recursive: true });
    await writeFile(layout.torrc, buildTorrc(ports));
    await writeFile(layout.defaults, TORRC_DEFAULTS);
    // tor writes a new cookie when it starts; an old one must not be mistaken for it.
    await rm(layout.cookie, { force: true });
    this.resetHealth();
    this.error = undefined;
    this.setState('starting');

    let started: TorProcess;
    try {
      started = await startTorProcess({
        executable: join(bundle, 'tor', 'tor.exe'),
        bundle,
        args: torArguments({ bundle, home, ...(this.options.offline ? { disableNetwork: true } : {}) }),
        logFile: this.logFile,
      });
    } catch (error) {
      throw this.fail(
        this.failure('tor.launch-failed', 'Windows did not start tor.exe.', {
          likelyCause:
            'An antivirus or application-control policy blocked tor.exe, which the Tor Project does not code-sign, or the file was removed.',
          details: { reason: error instanceof Error ? error.message : String(error) },
          recoveryActions: [
            { id: 'verify-installation', label: 'Check the installed files' },
            { id: 'install-tor', label: 'Install Tor again' },
          ],
        }),
      );
    }
    this.saveSettings({ started: { version: runtime.version, pid: started.pid } });
    this.options.logger.info('Started tor', { pid: started.pid, version: runtime.version, ports });
    void started.exited.then((exit) => {
      if (this.current?.process === started) {
        this.lost(`tor stopped unexpectedly${exit.code === null ? '' : ` (exit code ${String(exit.code)})`}.`);
      }
    });
    const control = await this.waitForControl(started, ports.control, layout.cookie);
    this.current = { version: runtime.version, pid: started.pid, control, process: started };
    await this.watch(control);
  }

  /** tor went away, or BTCortex lost it, without being asked to stop. */
  private lost(message: string): void {
    const current = this.current;
    this.current = undefined;
    current?.control.close();
    this.resetHealth();
    if (this.closing) return;
    if (this.state === 'stopping' || !this.wanted) {
      this.setState(this.newest ? 'stopped' : 'not-installed');
      return;
    }
    const lines = readTorLogTail(this.logFile, 15);
    this.options.logger.warn('tor stopped unexpectedly', { message, lastLines: lines });
    this.fail(
      this.failure('tor.exited', message, {
        likelyCause: likelyCause(lines),
        details: { lastLines: lines },
        recoveryActions: [{ id: 'start-tor', label: 'Start Tor again' }],
      }),
    );
    this.scheduleRestart();
  }

  private controlClosed(control: TorControlConnection): void {
    const current = this.current;
    if (current?.control !== control || this.state === 'stopping' || this.closing) return;
    void (async () => {
      // When tor itself stopped, the exit is noticed meanwhile.
      await delay(1000);
      if (this.current !== current) return;
      if (!isProcessAlive(current.pid)) {
        this.lost('tor stopped unexpectedly.');
        return;
      }
      try {
        const layout = await this.layout();
        current.control = await connectAuthenticated(this.ports().control, layout.cookie, { timeoutMs: 3000 });
        await this.watch(current.control);
      } catch (error) {
        this.options.logger.warn('Lost the connection to tor; ending it so that it can start again', { error });
        try {
          process.kill(current.pid);
        } catch {
          // Already gone.
        }
        this.lost('BTCortex lost its connection to tor.');
      }
    })();
  }

  private scheduleRestart(): void {
    const now = this.now().getTime();
    this.failures = [...this.failures.filter((at) => now - at < FAILURE_WINDOW_MS), now];
    const wait = RESTART_DELAYS_MS[this.failures.length - 1];
    if (wait === undefined) {
      this.wanted = false;
      this.options.logger.warn('tor stopped repeatedly; it is not restarted again automatically');
      return;
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (!this.wanted || this.closing) return;
      void this.exclusive(() => this.startNow()).catch((error: unknown) => {
        this.options.logger.warn('Restarting tor failed', { error });
        if (this.wanted && !this.closing && !this.current) this.scheduleRestart();
      });
    }, wait);
    this.restartTimer.unref();
  }

  private async waitForExit(current: Current, ms: number): Promise<boolean> {
    if (current.process) {
      return Promise.race([current.process.exited.then(() => true), delay(ms).then(() => false)]);
    }
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (!isProcessAlive(current.pid)) return true;
      await delay(200);
    }
    return !isProcessAlive(current.pid);
  }

  private async stopNow(waitMs: number): Promise<void> {
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    const current = this.current;
    if (!current) {
      if (this.state !== 'not-installed') this.setState(this.newest ? 'stopped' : 'not-installed');
      return;
    }
    this.setState('stopping');
    await current.control.signal('SHUTDOWN').catch(() => undefined);
    if (!(await this.waitForExit(current, waitMs))) {
      this.options.logger.warn('tor did not stop when asked; ending it', { pid: current.pid });
      try {
        process.kill(current.pid);
      } catch {
        // Already gone.
      }
      await this.waitForExit(current, 3000);
    }
    current.control.close();
    if (this.current === current) this.current = undefined;
    this.resetHealth();
    this.setState('stopped');
  }

  /** Starts tor once BTCortex is up, when it should run and is not running already. */
  initialise(): void {
    void this.exclusive(async () => {
      await this.refreshInstalled();
      if (!this.newest) return;
      if (await this.attach()) return;
      if (!this.settings().autoStart) return;
      this.wanted = true;
      await this.startNow();
    }).catch((error: unknown) => {
      this.options.logger.warn('tor did not start with BTCortex', { error });
    });
  }

  async start(): Promise<TorStatus> {
    this.wanted = true;
    this.failures = [];
    await this.exclusive(() => this.startNow());
    return this.status();
  }

  async stop(): Promise<TorStatus> {
    this.wanted = false;
    await this.exclusive(() => this.stopNow(STOP_WAIT_MS));
    return this.status();
  }

  async configure(change: TorSettingsChange): Promise<TorStatus> {
    this.saveSettings({ autoStart: change.autoStart });
    return this.status();
  }

  /** Before a node that routes through Tor starts: tor must run, at least far enough to accept connections. */
  async ensureRunning(): Promise<void> {
    if (this.current) return;
    this.wanted = true;
    await this.exclusive(() => this.startNow());
  }

  /** After an update: a running tor moves to the newest verified bundle. */
  async restartIfRunning(): Promise<void> {
    if (!this.current) return;
    await this.exclusive(async () => {
      await this.stopNow(STOP_WAIT_MS);
      this.wanted = true;
      await this.startNow();
    });
  }

  /** Installs the current Expert Bundle as a job, then starts tor and keeps it starting with BTCortex. */
  install(): string {
    const job = this.options.jobs.run(
      'tor.install',
      'Set up Tor',
      async (report) => {
        report({ stage: 'resolving', message: 'Checking the current Tor release.' });
        const version = await (this.options.latestVersion ?? (() => fetchLatestTorVersion(this.options.fetch)))();
        const onProgress = (progress: InstallProgress) => {
          report({
            stage: progress.stage,
            message: progress.message,
            ...(progress.receivedBytes !== undefined && progress.totalBytes
              ? { fraction: Math.min(1, progress.receivedBytes / progress.totalBytes) }
              : {}),
          });
        };
        const install =
          this.options.install ??
          (async (target: string, progress: (update: InstallProgress) => void) => {
            await installTor({
              version: target,
              runtimesDirectory: this.options.runtimesDirectory,
              downloadsDirectory: this.options.downloadsDirectory,
              ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
              onProgress: progress,
            });
          });
        await install(version, onProgress);
        this.saveSettings({ autoStart: true });
        report({ stage: 'starting', message: 'Starting tor.' });
        if (this.current) await this.restartIfRunning();
        else await this.start();
        report({ stage: 'finished', message: `Tor ${version} is installed, verified and running.` });
        return undefined;
      },
      (error) => describeInstallationFailure(error, COMPONENT),
    );
    return job.id;
  }

  /**
   * When BTCortex closes: tor stops, unless a node that keeps running after
   * BTCortex closes routes through it.
   */
  async shutdown(): Promise<void> {
    this.closing = true;
    clearTimeout(this.restartTimer);
    clearTimeout(this.publishTimer);
    const current = this.current;
    if (!current) return;
    const users = await this.options.users().catch(() => [] as TorUser[]);
    if (users.some((user) => user.running && user.keepRunningOnExit)) {
      this.options.logger.info('tor keeps running for the nodes that keep running after BTCortex closes');
      current.control.close();
      return;
    }
    await current.control.signal('SHUTDOWN').catch(() => undefined);
    current.control.close();
  }
}
