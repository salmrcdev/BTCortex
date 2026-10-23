import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { rm, rmdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { setOption } from '@btcortex/bitcoin-config';
import { NETWORK_PARAMETERS } from '@btcortex/bitcoin-config';
import { AppFailure, ElectrumServerPortsSchema } from '@btcortex/contracts';
import type {
  AppError,
  ElectrumConnection,
  ElectrumLogLine,
  ElectrumOverview,
  ElectrumPlanIssue,
  ElectrumRemoval,
  ElectrumServerPorts,
  ElectrumServerState,
  ElectrumServerStatus,
  ElectrumSetupPlan,
  ElectrumWaitReason,
  NodeProfile,
  NodeWithStatus,
  OrchestratorEvent,
  Volume,
} from '@btcortex/contracts';
import type { InstallProgress } from '@btcortex/installation-manager';
import { processImageName } from '@btcortex/integration-bitcoin-core';
import {
  buildFulcrumConfig,
  fetchLatestFulcrumVersion,
  fulcrumCredentialsEnvironment,
  fulcrumDatabaseMemory,
  installFulcrum,
  isFulcrumCompatiblePath,
  isProcessAlive,
  listInstalledFulcrum,
  parseFulcrumLogLine,
  probeElectrumServer,
  readFulcrumInfo,
  readFulcrumLogTail,
  readFulcrumStats,
  requestFulcrumStop,
  startFulcrumProcess,
} from '@btcortex/integration-fulcrum';
import type { FulcrumInfo, FulcrumProcess, FulcrumRuntime, FulcrumStats } from '@btcortex/integration-fulcrum';
import { qrMatrix } from '@btcortex/integration-hardware-wallets';
import { z } from 'zod';
import { describeInstallationFailure } from '../jobs/installation-errors';
import type { JobManager, JobProgressReporter } from '../jobs/job-manager';
import type { Logger } from '../logging/logger';
import type { NodeConfigService } from '../nodes/config-service';
import type { NodeManager } from '../nodes/node-manager';
import type { SettingsStore } from '../persistence/settings';
import { folderSize, measureVolume } from '../platform/disks';
import { chooseLoopbackPort, isLoopbackPortFree } from '../platform/ports';
import { shortFolderPath } from '../platform/short-path';
import type { TorService, TorUser } from '../tor/tor-service';
import type { SecretVault } from '../vault/vault';
import {
  ADMIN_PORTS,
  bitcoindAddress,
  connectionFor,
  DEFAULT_ELECTRUM_PORTS,
  DEFAULT_ZMQ_PORTS,
  defaultIndexDirectory,
  ELECTRUM_FALLBACK_PORTS,
  estimateIndexBytes,
  estimateTransactionIndexBytes,
  expectedBlockFileBytes,
  isWithin,
  likelyCause,
  nodeElectrumSettings,
  SPACE_HEADROOM,
  STATS_PORTS,
  unavailableReason,
  ZMQ_FALLBACK_PORTS,
} from './electrum-plan';

// Electrum servers for BTCortex's nodes (specification section 7;
// docs/research/notes/electrum-indexers-explorers.md §3): one Fulcrum per
// node, verified and installed by BTCortex, its index in a folder BTCortex
// created for it, every port bound to this computer only. Fulcrum starts
// once its node runs, has caught up with the network and has built its
// transaction index; it indexes the node's blocks and then serves wallets.
// Like the nodes, Fulcrum runs detached: it keeps serving a node that keeps
// running after BTCortex closes, and BTCortex finds it again on its next
// start. It is stopped before its node (wallets, then Fulcrum, then
// bitcoind): through its admin port once the index has caught up, otherwise
// by ending it, which Fulcrum 2 is designed to survive.

const COMPONENT = 'Electrum server';
const SETTINGS_KEY = 'electrum';
const MARKER_FILE = 'btcortex-electrum.json';
const DEFAULT_POLL_MS = { active: 3_000, idle: 15_000 };
const STOP_WAIT_MS = 30_000;
const SHUTDOWN_WAIT_MS = 2_500;
const PROBE_EVERY_MS = 60_000;
const INDEX_SIZE_EVERY_MS = 10 * 60_000;
const RATE_WINDOW_MS = 5 * 60_000;
const RATE_MIN_SPAN_MS = 30_000;
const RESTART_DELAYS_MS = [5_000, 15_000, 45_000] as const;
const FAILURE_WINDOW_MS = 10 * 60_000;
const SHOWN_LINES = 40;
const PUBLISH_DELAY_MS = 250;
const NODE_ANSWER_WAIT_MS = 10 * 60_000;

const ServerSettingsSchema = z.object({
  nodeId: z.string(),
  /** Run whenever the node runs; false once the user stops the server. */
  enabled: z.boolean(),
  /** The index folder as chosen; its short form is used when Fulcrum cannot open this one. */
  dataDirectory: z.string(),
  ports: ElectrumServerPortsSchema,
  /** The block-notification port BTCortex added to the node's configuration. */
  zmqPort: z.number().int().positive().optional(),
  /** The Fulcrum BTCortex started last, to recognise it in a later session. */
  started: z.object({ version: z.string(), pid: z.number().int().positive() }).optional(),
  /** Access from other devices through Tor; the identity is kept when access is turned off, so the address stays. */
  onion: z
    .object({
      enabled: z.boolean(),
      serviceId: z.string().optional(),
      /** The onion service's private key, in BTCortex's DPAPI-protected vault. */
      keySecretId: z.string().optional(),
    })
    .optional(),
});
type ServerSettings = z.infer<typeof ServerSettingsSchema>;
const ElectrumSettingsSchema = z.object({ servers: z.array(ServerSettingsSchema) });

const MarkerSchema = z.object({ nodeId: z.string() });

interface ServerRuntime {
  nodeId: string;
  state: ElectrumServerState;
  waitingFor?: ElectrumWaitReason;
  progress?: number;
  pid?: number;
  version?: string;
  /** Present when this BTCortex session started Fulcrum. */
  process?: FulcrumProcess;
  startedAt?: string;
  stats?: FulcrumStats;
  info?: FulcrumInfo;
  probedAt?: number;
  indexBytes?: { at: number; value: number };
  samples: { at: number; height: number }[];
  error?: AppError;
  failures: number[];
  restartAt?: number;
  /** Restarts were given up after repeated failures; a start by the user clears it. */
  givenUp: boolean;
  stopping: boolean;
  /** Why the onion service is not published at the moment. */
  onionProblem?: string;
}

export interface ElectrumServiceOptions {
  /** Parent of the versioned Fulcrum folders. */
  runtimesDirectory: string;
  /** BTCortex's Electrum folder: Fulcrum's configuration and pid file for each node. */
  home: string;
  logsDirectory: string;
  downloadsDirectory: string;
  settings: Pick<SettingsStore, 'get' | 'set'>;
  nodes: Pick<NodeManager, 'list' | 'get' | 'rpc' | 'restart'>;
  config: Pick<NodeConfigService, 'get' | 'save'>;
  vault: Pick<SecretVault, 'reveal' | 'store' | 'remove'>;
  /** BTCortex's tor, which publishes servers as onion services. */
  tor?: Pick<TorService, 'status' | 'ensureRunning' | 'publishOnion' | 'removeOnion'>;
  jobs: Pick<JobManager, 'run'>;
  publish: (event: OrchestratorEvent) => void;
  logger: Logger;
  totalMemoryBytes: number;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Replaced in tests. */
  latestVersion?: () => Promise<string>;
  install?: (version: string, onProgress: (progress: InstallProgress) => void) => Promise<void>;
  processImageName?: (pid: number) => Promise<string | undefined>;
  measureVolume?: (path: string) => Promise<Volume>;
  pollMs?: { active: number; idle: number };
}

/** The log file of a node's Electrum server. */
export function fulcrumLogFile(logsDirectory: string, nodeId: string): string {
  return join(logsDirectory, `fulcrum-${nodeId}.log`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What BTCortex writes in a server's working folder: its configuration and Fulcrum's process file. */
const SERVER_FILES = ['fulcrum.conf', 'fulcrum.pid'] as const;

export class ElectrumService {
  private readonly runtimes = new Map<string, ServerRuntime>();
  private readonly genesis = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private readonly publishTimers = new Map<string, NodeJS.Timeout>();
  private readonly published = new Map<string, string>();
  private closing = false;

  constructor(private readonly options: ElectrumServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private failure(code: string, message: string, extra: Partial<AppError> = {}): AppFailure {
    return new AppFailure({ code, message, component: COMPONENT, dataRisk: 'none', recoveryActions: [], ...extra });
  }

  /** Starts, stops and checks run one at a time. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  // Settings

  private entries(): ServerSettings[] {
    return this.options.settings.get(SETTINGS_KEY, ElectrumSettingsSchema)?.servers ?? [];
  }

  private entry(nodeId: string): ServerSettings | undefined {
    return this.entries().find((server) => server.nodeId === nodeId);
  }

  private saveEntry(entry: ServerSettings): void {
    const others = this.entries().filter((server) => server.nodeId !== entry.nodeId);
    this.options.settings.set(SETTINGS_KEY, { servers: [...others, entry] });
  }

  private updateEntry(nodeId: string, change: Partial<ServerSettings>): void {
    const entry = this.entry(nodeId);
    if (entry) this.saveEntry({ ...entry, ...change });
  }

  private dropEntry(nodeId: string): void {
    this.options.settings.set(SETTINGS_KEY, { servers: this.entries().filter((server) => server.nodeId !== nodeId) });
  }

  private runtime(nodeId: string): ServerRuntime {
    let runtime = this.runtimes.get(nodeId);
    if (!runtime) {
      // Until the first check: a server that should run is waiting for it.
      const state = this.entry(nodeId)?.enabled ? 'waiting' : 'stopped';
      runtime = { nodeId, state, samples: [], failures: [], givenUp: false, stopping: false };
      this.runtimes.set(nodeId, runtime);
    }
    return runtime;
  }

  /** Forgets which Fulcrum process BTCortex started for the server. */
  private forgetStarted(nodeId: string): void {
    const entry = this.entry(nodeId);
    if (!entry?.started) return;
    const { started: _started, ...rest } = entry;
    this.saveEntry(rest);
  }

  private serverHome(nodeId: string): string {
    return join(this.options.home, nodeId);
  }

  private logFile(nodeId: string): string {
    return fulcrumLogFile(this.options.logsDirectory, nodeId);
  }

  /** How wallets on this computer reach the node's Electrum server, once it is set up. */
  connection(nodeId: string): ElectrumConnection | undefined {
    const entry = this.entry(nodeId);
    return entry ? connectionFor(entry.ports.electrum) : undefined;
  }

  /** Log files of the servers set up, for the log centre. */
  logSources(): { nodeId: string; path: string }[] {
    return this.entries().map((entry) => ({ nodeId: entry.nodeId, path: this.logFile(entry.nodeId) }));
  }

  // Installation

  private async newestInstalled(): Promise<FulcrumRuntime | undefined> {
    return (await listInstalledFulcrum(this.options.runtimesDirectory))[0];
  }

  /** Fulcrum versions running now, for the installed-software page. */
  runningVersions(): Map<string, string[]> {
    const versions = new Map<string, string[]>();
    for (const runtime of this.runtimes.values()) {
      if (runtime.pid === undefined || runtime.version === undefined) continue;
      versions.set(runtime.version, [...(versions.get(runtime.version) ?? []), runtime.nodeId]);
    }
    return versions;
  }

  private async installNewest(report: JobProgressReporter): Promise<string> {
    report({ stage: 'resolving', message: 'Checking the current Fulcrum release.' });
    const version = await (this.options.latestVersion ?? (() => fetchLatestFulcrumVersion(this.options.fetch)))();
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
        await installFulcrum({
          version: target,
          runtimesDirectory: this.options.runtimesDirectory,
          downloadsDirectory: this.options.downloadsDirectory,
          ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
          onProgress: progress,
        });
      });
    await install(version, onProgress);
    return version;
  }

  // Paths

  /**
   * A folder Fulcrum can use: the folder itself, or its 8.3 short form when
   * its path has characters Fulcrum's database cannot handle.
   */
  private async usablePath(path: string): Promise<string> {
    mkdirSync(path, { recursive: true });
    if (isFulcrumCompatiblePath(path)) return path;
    const short = await shortFolderPath(path);
    if (short !== undefined && isFulcrumCompatiblePath(short)) return short;
    throw this.failure(
      'electrum.path-unsupported',
      `Fulcrum cannot use the folder ${path}: its database needs a path with only basic Latin letters, digits and punctuation, and Windows keeps no short name for it.`,
      { recoveryActions: [{ id: 'choose-folder', label: 'Choose another folder for the index' }] },
    );
  }

  private marker(directory: string): z.infer<typeof MarkerSchema> | undefined {
    try {
      const parsed = MarkerSchema.safeParse(JSON.parse(readFileSync(join(directory, MARKER_FILE), 'utf8')));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  // Planning

  private async volumeOf(path: string): Promise<Volume | null> {
    try {
      return await (this.options.measureVolume ?? ((target: string) => measureVolume(target)))(path);
    } catch {
      return null;
    }
  }

  /** Ports no other server uses and nothing listens on, chosen once and kept. */
  private async choosePorts(nodeId: string, network: NodeProfile['network']): Promise<ElectrumServerPorts> {
    const taken = new Set(
      this.entries()
        .filter((entry) => entry.nodeId !== nodeId)
        .flatMap((entry) => [entry.ports.electrum, entry.ports.admin, entry.ports.stats]),
    );
    const pick = async (preferred: number, range: readonly [number, number]): Promise<number> => {
      if (!taken.has(preferred) && (await isLoopbackPortFree(preferred))) {
        taken.add(preferred);
        return preferred;
      }
      for (let port = range[0]; port <= range[1]; port += 1) {
        if (taken.has(port) || !(await isLoopbackPortFree(port))) continue;
        taken.add(port);
        return port;
      }
      throw this.failure('electrum.no-free-port', 'No free port was found for the Electrum server on this computer.');
    };
    const electrum = await pick(DEFAULT_ELECTRUM_PORTS[network], ELECTRUM_FALLBACK_PORTS);
    const admin = await pick(ADMIN_PORTS[0], ADMIN_PORTS);
    const stats = await pick(STATS_PORTS[0], STATS_PORTS);
    return { electrum, admin, stats };
  }

  private async chooseZmqPort(nodeId: string, network: NodeProfile['network']): Promise<number> {
    const taken = new Set(
      this.entries()
        .filter((entry) => entry.nodeId !== nodeId)
        .flatMap((entry) => (entry.zmqPort === undefined ? [] : [entry.zmqPort])),
    );
    const preferred = DEFAULT_ZMQ_PORTS[network];
    if (!taken.has(preferred) && (await chooseLoopbackPort(preferred, [preferred, preferred])) === preferred) {
      return preferred;
    }
    for (let port = ZMQ_FALLBACK_PORTS[0]; port <= ZMQ_FALLBACK_PORTS[1]; port += 1) {
      if (!taken.has(port) && (await isLoopbackPortFree(port))) return port;
    }
    throw this.failure('electrum.no-free-port', 'No free port was found for the node’s block notifications.');
  }

  /** The node's transaction index as the node reports it; `undefined` when it does not answer. */
  private async transactionIndexState(nodeId: string): Promise<'off' | 'building' | 'built' | undefined> {
    try {
      const txindex = (await this.options.nodes.rpc(nodeId).getIndexInfo())['txindex'];
      if (txindex === undefined) return 'off';
      return txindex.synced ? 'built' : 'building';
    } catch {
      return undefined;
    }
  }

  async plan(nodeId: string, chosenDirectory?: string): Promise<ElectrumSetupPlan> {
    const node = this.options.nodes.get(nodeId);
    const { profile } = node;
    const blockers: ElectrumPlanIssue[] = [];
    const warnings: ElectrumPlanIssue[] = [];
    const unavailable = unavailableReason(node);
    if (unavailable === 'implementation') {
      blockers.push({
        code: 'implementation',
        message:
          'BTCortex sets up Electrum servers for Bitcoin Core nodes. Whether Electrum wallets accept the chain of a Bitcoin Knots node is not established.',
      });
    } else if (unavailable === 'remote') {
      blockers.push({
        code: 'remote',
        message:
          'This node runs on another computer. An Electrum server belongs next to its node; set one up on that computer and connect wallets to it there.',
      });
    } else if (unavailable === 'node-unknown') {
      blockers.push({
        code: 'node-unknown',
        message:
          'The node has not answered yet, so BTCortex cannot check that it keeps all blocks. Start the node first.',
      });
    } else if (unavailable === 'pruned') {
      blockers.push({
        code: 'pruned',
        message:
          'This node keeps only recent blocks (it is pruned). An Electrum server needs every block, so it would need a full node with the whole block chain.',
      });
    }

    const existing = this.entry(nodeId);
    const dataDirectory =
      chosenDirectory ?? existing?.dataDirectory ?? defaultIndexDirectory(profile, this.options.home);
    const volume = await this.volumeOf(dataDirectory);
    const blockFileBytes = expectedBlockFileBytes(node);
    const indexBytesEstimate = estimateIndexBytes(blockFileBytes);
    const running = node.status.state === 'running' || node.status.state === 'starting';

    // The node's own settings: changed only for nodes BTCortex set up.
    const document = await this.options.config.get(nodeId).catch(() => undefined);
    const settings = document?.exists ? nodeElectrumSettings(document.text, profile.network) : undefined;
    const indexState = await this.transactionIndexState(nodeId);
    const needsTransactionIndex = settings ? !settings.transactionIndex : indexState === 'off';
    const nodeChanges: ElectrumSetupPlan['nodeChanges'] = [];
    if (profile.execution === 'managed') {
      if (!document?.editable) {
        blockers.push({
          code: 'config-read-only',
          message: document?.readOnlyReason ?? 'This node’s configuration cannot be changed from BTCortex.',
        });
      } else {
        if (needsTransactionIndex) nodeChanges.push({ key: 'txindex', value: '1' });
        // Block notifications only save Fulcrum a poll every two seconds: worth adding when
        // the node restarts anyway, not worth a restart of their own.
        if (!settings?.blockNotifications && (needsTransactionIndex || !running)) {
          const port = existing?.zmqPort ?? (await this.chooseZmqPort(nodeId, profile.network).catch(() => undefined));
          if (port !== undefined)
            nodeChanges.push({ key: 'zmqpubhashblock', value: `tcp://127.0.0.1:${String(port)}` });
        }
      }
    } else if (needsTransactionIndex && indexState !== 'built' && indexState !== 'building') {
      blockers.push({
        code: 'transaction-index-off',
        message:
          'Fulcrum needs the node’s transaction index. Add txindex=1 to this node’s own configuration and restart it; BTCortex does not change installations it did not set up.',
      });
    }
    const transactionIndexBytesEstimate = needsTransactionIndex ? estimateTransactionIndexBytes(blockFileBytes) : null;

    // The index folder: empty or BTCortex's own, and not inside the node's data.
    if (profile.dataDirectory && isWithin(dataDirectory, profile.dataDirectory)) {
      blockers.push({
        code: 'folder-inside-node',
        message: 'Choose a folder outside the node’s data directory for the index.',
      });
    } else if (existsSync(dataDirectory)) {
      const marker = this.marker(dataDirectory);
      const entries = readdirSync(dataDirectory).filter((name) => name !== MARKER_FILE);
      if (marker && marker.nodeId !== nodeId) {
        blockers.push({
          code: 'folder-in-use',
          message: 'This folder holds the index of another node’s Electrum server.',
        });
      } else if (!marker && entries.length > 0) {
        blockers.push({
          code: 'folder-not-empty',
          message: 'This folder already holds other files. Choose an empty folder, so the index never mixes with them.',
        });
      }
    }
    if (!isFulcrumCompatiblePath(dataDirectory)) {
      warnings.push({
        code: 'short-path',
        message:
          'The folder’s path has characters Fulcrum’s database cannot use, so BTCortex gives Fulcrum the folder’s short Windows name instead.',
      });
    }

    if (volume) {
      // The transaction index grows on the node's disk, which may be this one.
      const nodeOnThisVolume = profile.dataDirectory !== null && isWithin(profile.dataDirectory, volume.root);
      const needed =
        (indexBytesEstimate + (nodeOnThisVolume ? (transactionIndexBytesEstimate ?? 0) : 0)) * (1 + SPACE_HEADROOM);
      if (volume.freeBytes < needed) {
        blockers.push({
          code: 'disk-space',
          message: `The index needs about ${formatGb(needed)} with some room to spare, but ${volume.root} has ${formatGb(volume.freeBytes)} free. Choose a folder on a larger disk.`,
        });
      }
      if (!nodeOnThisVolume && transactionIndexBytesEstimate !== null && profile.dataDirectory !== null) {
        const nodeVolume = await this.volumeOf(profile.dataDirectory);
        if (nodeVolume && nodeVolume.freeBytes < transactionIndexBytesEstimate * (1 + SPACE_HEADROOM)) {
          blockers.push({
            code: 'node-disk-space',
            message: `Bitcoin Core’s transaction index needs about ${formatGb(transactionIndexBytesEstimate)} on ${nodeVolume.root}, which has ${formatGb(nodeVolume.freeBytes)} free.`,
          });
        }
      }
      if (volume.kind === 'hdd') {
        warnings.push({
          code: 'hard-disk',
          message: 'The index would be on a hard disk: indexing can take days there, against hours on an SSD.',
        });
      }
    }
    if (indexState === 'building' && !needsTransactionIndex) {
      warnings.push({
        code: 'transaction-index-building',
        message: 'The node is still building its transaction index; Fulcrum starts indexing when it is done.',
      });
    }
    if (needsTransactionIndex) {
      warnings.push({
        code: 'transaction-index',
        message:
          'Bitcoin Core first builds its transaction index, which takes hours on mainnet; Fulcrum starts indexing when it is done.',
      });
    }
    if (node.status.snapshot?.blockchain.initialBlockDownload) {
      warnings.push({
        code: 'node-synchronising',
        message: 'The node is still catching up with the network; Fulcrum starts once it has.',
      });
    }
    return {
      nodeId,
      dataDirectory,
      volume,
      indexBytesEstimate,
      transactionIndexBytesEstimate,
      nodeChanges,
      restartsNode: running && nodeChanges.length > 0,
      installsFulcrum: (await this.newestInstalled()) === undefined,
      blockers,
      warnings,
    };
  }

  /** For a node just set up as an Electrum back end: its server, in the default folder. */
  setUpForNewNode(nodeId: string): string {
    const { profile } = this.options.nodes.get(nodeId);
    return this.setUp(nodeId, defaultIndexDirectory(profile, this.options.home));
  }

  /** Sets up the node's Electrum server as a job; Fulcrum then starts once the node is ready. */
  setUp(nodeId: string, dataDirectory: string): string {
    const { profile } = this.options.nodes.get(nodeId);
    const job = this.options.jobs.run(
      'electrum.setup',
      `Set up an Electrum server for ${profile.name}`,
      async (report) => {
        await this.setUpNow(nodeId, dataDirectory, report);
        return { nodeId };
      },
      (error) => describeInstallationFailure(error, COMPONENT),
    );
    return job.id;
  }

  /** A node that has just started answers within moments; until then it cannot be checked. */
  private async waitForNodeAnswer(nodeId: string): Promise<void> {
    const deadline = Date.now() + NODE_ANSWER_WAIT_MS;
    while (this.options.nodes.get(nodeId).status.snapshot === undefined && Date.now() < deadline) {
      const { state } = this.options.nodes.get(nodeId).status;
      if (state === 'stopped' || state === 'failed') return;
      await delay(1_000);
    }
  }

  private async setUpNow(nodeId: string, dataDirectory: string, report: JobProgressReporter): Promise<void> {
    report({ stage: 'checking', message: 'Checking the node and the folder for the index.' });
    await this.waitForNodeAnswer(nodeId);
    const plan = await this.plan(nodeId, dataDirectory);
    const [blocker] = plan.blockers;
    if (blocker) {
      throw this.failure(`electrum.${blocker.code}`, blocker.message, {
        recoveryActions: [{ id: 'review-plan', label: 'Review the set-up' }],
      });
    }
    const { profile } = this.options.nodes.get(nodeId);
    if (plan.installsFulcrum) await this.installNewest(report);

    report({ stage: 'configuring', message: 'Preparing the folder for the index.' });
    await this.usablePath(dataDirectory);
    if (!this.marker(dataDirectory)) {
      await writeFile(
        join(dataDirectory, MARKER_FILE),
        `${JSON.stringify({ purpose: 'Fulcrum index for a BTCortex node', nodeId, createdAt: this.now().toISOString() }, null, 2)}\n`,
      );
    }
    const existing = this.entry(nodeId);
    const ports = existing?.ports ?? (await this.choosePorts(nodeId, profile.network));
    const zmq = plan.nodeChanges.find((change) => change.key === 'zmqpubhashblock');
    const zmqPort = zmq ? Number(new URL(zmq.value).port) : existing?.zmqPort;
    this.saveEntry({
      nodeId,
      enabled: true,
      dataDirectory,
      ports,
      ...(zmqPort === undefined ? {} : { zmqPort }),
      ...(existing?.started ? { started: existing.started } : {}),
    });
    const runtime = this.runtime(nodeId);
    runtime.givenUp = false;
    runtime.failures = [];

    if (plan.nodeChanges.length > 0) {
      report({ stage: 'configuring', message: 'Turning on the node’s transaction index and block notifications.' });
      const document = await this.options.config.get(nodeId);
      let text = document.text;
      for (const change of plan.nodeChanges) text = setOption(text, change.key, [change.value], profile.network);
      const saved = await this.options.config.save(nodeId, {
        text,
        revision: document.revision,
        // Confirmed with the plan: block notifications are published on this computer only.
        acceptedRisks: plan.nodeChanges.map((change) => change.key),
      });
      this.options.logger.info('Prepared a node for its Electrum server', { nodeId, changedKeys: saved.changedKeys });
      const node = this.options.nodes.get(nodeId);
      if (saved.changedKeys.length > 0 && (node.status.state === 'running' || node.status.state === 'starting')) {
        report({ stage: 'restarting', message: 'Restarting the node with the new settings.' });
        await this.options.nodes.restart(nodeId);
      }
    }
    report({
      stage: 'finished',
      message: 'The Electrum server is set up. It starts as soon as the node is ready and then indexes its blocks.',
    });
    this.schedule(0);
  }

  // Lifecycle

  /** Starts watching servers set up earlier, and finds the ones still running from an earlier session. */
  initialise(): void {
    void this.exclusive(async () => {
      for (const entry of this.entries()) {
        const runtime = this.runtime(entry.nodeId);
        const started = entry.started;
        if (!started || !isProcessAlive(started.pid)) continue;
        const image = await (this.options.processImageName ?? processImageName)(started.pid);
        if (image !== undefined && image !== 'fulcrum.exe') continue;
        runtime.pid = started.pid;
        runtime.version = started.version;
        runtime.state = 'starting';
        this.options.logger.info('Found the Electrum server BTCortex started earlier', {
          nodeId: entry.nodeId,
          pid: started.pid,
        });
      }
    })
      .catch((error: unknown) => {
        this.options.logger.warn('Electrum servers could not be checked at start', { error });
      })
      .finally(() => {
        this.schedule(0);
      });
    // Servers reachable through Tor need tor; it is started for them.
    for (const entry of this.entries()) {
      if (entry.onion?.enabled) void this.publishOnion(entry.nodeId).catch(() => undefined);
    }
  }

  // Access through Tor

  private onionId(nodeId: string): string {
    return `electrum:${nodeId}`;
  }

  /** Publishes the server as an onion service, with its earlier identity when it had one. */
  private async publishOnion(nodeId: string): Promise<void> {
    const runtime = this.runtime(nodeId);
    try {
      const tor = this.options.tor;
      if (!tor) throw this.failure('electrum.tor-unavailable', 'Tor is not available in this BTCortex.');
      if ((await tor.status()).installed === null) {
        throw this.failure('electrum.tor-not-installed', 'Set up Tor first: the server is reached through it.', {
          recoveryActions: [{ id: 'install-tor', label: 'Set up Tor' }],
        });
      }
      await tor.ensureRunning();
      const entry = this.requireEntry(nodeId);
      const { profile } = this.options.nodes.get(nodeId);
      const onion = entry.onion;
      const identity =
        onion?.keySecretId !== undefined && onion.serviceId !== undefined
          ? { privateKey: await this.options.vault.reveal(onion.keySecretId), serviceId: onion.serviceId }
          : undefined;
      const published = await tor.publishOnion({
        id: this.onionId(nodeId),
        ports: [
          { virtual: DEFAULT_ELECTRUM_PORTS[profile.network], target: `127.0.0.1:${String(entry.ports.electrum)}` },
        ],
        ...(identity ? { identity } : {}),
      });
      const keySecretId =
        onion?.keySecretId ??
        (await this.options.vault.store(
          `Onion service key of the Electrum server of ${profile.name}`,
          published.privateKey,
        ));
      this.updateEntry(nodeId, { onion: { enabled: true, serviceId: published.serviceId, keySecretId } });
      delete runtime.onionProblem;
    } catch (error) {
      runtime.onionProblem =
        error instanceof AppFailure ? error.error.message : 'Tor could not publish the server as an onion service.';
      this.options.logger.warn('The Electrum server could not be published as an onion service', { nodeId, error });
      throw error;
    } finally {
      this.schedulePublish(nodeId);
    }
  }

  /** Turns access from other devices through Tor on or off. */
  async setRemoteAccess(nodeId: string, enabled: boolean): Promise<ElectrumServerStatus> {
    const entry = this.requireEntry(nodeId);
    if (enabled) {
      this.updateEntry(nodeId, { onion: { ...entry.onion, enabled: true } });
      await this.publishOnion(nodeId);
    } else {
      this.updateEntry(nodeId, { onion: { ...entry.onion, enabled: false } });
      delete this.runtime(nodeId).onionProblem;
      await this.options.tor?.removeOnion(this.onionId(nodeId), entry.onion?.serviceId);
      this.schedulePublish(nodeId);
    }
    return this.status(nodeId);
  }

  /** Servers published through tor, which tor keeps serving while their nodes run. */
  torUsers(): TorUser[] {
    const users: TorUser[] = [];
    for (const entry of this.entries()) {
      if (!entry.onion?.enabled) continue;
      let profile: NodeProfile;
      try {
        profile = this.options.nodes.get(entry.nodeId).profile;
      } catch {
        continue;
      }
      users.push({
        id: entry.nodeId,
        name: `Electrum server of ${profile.name}`,
        running: this.runtimes.get(entry.nodeId)?.pid !== undefined,
        // The server keeps running after BTCortex closes when its node does.
        keepRunningOnExit: profile.execution !== 'managed' || profile.keepRunningOnExit,
        kind: 'electrum',
      });
    }
    return users;
  }

  private remoteAccess(entry: ServerSettings, profile: NodeProfile): ElectrumServerStatus['remoteAccess'] {
    const enabled = entry.onion?.enabled ?? false;
    const serviceId = entry.onion?.serviceId;
    const problem = this.runtimes.get(entry.nodeId)?.onionProblem;
    const addressKept = entry.onion?.keySecretId !== undefined;
    if (!enabled || serviceId === undefined) {
      return { enabled, onion: null, addressKept, ...(enabled && problem !== undefined ? { problem } : {}) };
    }
    const host = `${serviceId}.onion`;
    const port = DEFAULT_ELECTRUM_PORTS[profile.network];
    const server = `${host}:${String(port)}:t`;
    return {
      enabled,
      onion: { host, port, server, url: `tcp://${host}:${String(port)}`, qr: qrMatrix(server, 'M') },
      addressKept,
      ...(problem === undefined ? {} : { problem }),
    };
  }

  private schedule(ms: number): void {
    if (this.closing) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.exclusive(() => this.reconcileAll())
        .catch((error: unknown) => {
          this.options.logger.warn('Checking the Electrum servers failed', { error });
        })
        .finally(() => {
          this.schedule(this.nextDelay());
        });
    }, ms);
    this.timer.unref();
  }

  private nextDelay(): number {
    const poll = this.options.pollMs ?? DEFAULT_POLL_MS;
    const active = [...this.runtimes.values()].some(
      (runtime) =>
        runtime.state === 'starting' ||
        runtime.state === 'indexing' ||
        runtime.state === 'stopping' ||
        runtime.restartAt !== undefined ||
        (runtime.state === 'waiting' && runtime.waitingFor === 'transaction-index'),
    );
    return active ? poll.active : poll.idle;
  }

  private async reconcileAll(): Promise<void> {
    const nodes = new Map(this.options.nodes.list().map((node) => [node.profile.id, node]));
    for (const entry of this.entries()) {
      const node = nodes.get(entry.nodeId);
      const runtime = this.runtime(entry.nodeId);
      if (!node) {
        // The node was removed from BTCortex: its server goes too; the index folder stays.
        try {
          await this.discard(runtime, entry);
        } catch (error) {
          this.options.logger.warn('Removing the Electrum server of a removed node did not finish', {
            nodeId: entry.nodeId,
            error,
          });
        }
        this.options.logger.info('Removed the Electrum server of a node that is no longer registered', {
          nodeId: entry.nodeId,
          keptIndex: entry.dataDirectory,
        });
        continue;
      }
      try {
        await this.reconcile(runtime, entry, node);
      } catch (error) {
        this.options.logger.warn('Checking an Electrum server failed', { nodeId: entry.nodeId, error });
      }
      this.schedulePublish(entry.nodeId);
    }
  }

  private async reconcile(runtime: ServerRuntime, entry: ServerSettings, node: NodeWithStatus): Promise<void> {
    if (runtime.stopping) return;
    if (runtime.pid !== undefined) {
      if (isProcessAlive(runtime.pid)) {
        await this.observe(runtime, entry, node);
        return;
      }
      this.lost(runtime, entry, 'Fulcrum stopped unexpectedly.');
    }
    if (!entry.enabled) {
      if (runtime.state !== 'failed') this.setState(runtime, 'stopped');
      return;
    }
    if (runtime.givenUp) return;
    if (runtime.restartAt !== undefined && Date.now() < runtime.restartAt) return;
    delete runtime.restartAt;
    const waiting = await this.waitReason(node);
    if (waiting) {
      runtime.waitingFor = waiting.reason;
      if (waiting.progress === undefined) delete runtime.progress;
      else runtime.progress = waiting.progress;
      if (runtime.state !== 'failed') runtime.state = 'waiting';
      return;
    }
    try {
      await this.startNow(runtime, entry, node);
    } catch (error) {
      if (!(error instanceof AppFailure)) throw error;
      this.options.logger.warn('Fulcrum could not be started', { nodeId: entry.nodeId, code: error.error.code });
      this.backOff(runtime, entry);
    }
  }

  /** Schedules another attempt after a failure, or gives up after repeated ones. */
  private backOff(runtime: ServerRuntime, entry: ServerSettings): void {
    if (!entry.enabled) return;
    const now = Date.now();
    runtime.failures = [...runtime.failures.filter((at) => now - at < FAILURE_WINDOW_MS), now];
    const wait = RESTART_DELAYS_MS[runtime.failures.length - 1];
    if (wait === undefined) {
      runtime.givenUp = true;
      this.options.logger.warn('Fulcrum failed repeatedly; it is not started again automatically', {
        nodeId: entry.nodeId,
      });
      return;
    }
    runtime.restartAt = now + wait;
  }

  /** What must happen before Fulcrum can start, if anything. */
  private async waitReason(
    node: NodeWithStatus,
  ): Promise<{ reason: ElectrumWaitReason; progress?: number } | undefined> {
    if ((await this.newestInstalled()) === undefined) return { reason: 'installation' };
    const { state, snapshot } = node.status;
    if (state === 'unreachable' || state === 'unauthorised') return { reason: 'node-unreachable' };
    if (state !== 'running' || !snapshot) return { reason: 'node-stopped' };
    if (snapshot.blockchain.pruned) return { reason: 'node-pruned' };
    if (snapshot.blockchain.initialBlockDownload) {
      return { reason: 'node-synchronising', progress: Math.min(1, snapshot.blockchain.verificationProgress) };
    }
    let txindex: { synced: boolean; best_block_height: number } | undefined;
    try {
      txindex = (await this.options.nodes.rpc(node.profile.id).getIndexInfo())['txindex'];
    } catch {
      return { reason: 'node-unreachable' };
    }
    if (!txindex) return { reason: 'transaction-index-off' };
    if (!txindex.synced) {
      const blocks = snapshot.blockchain.blocks;
      return {
        reason: 'transaction-index',
        progress: blocks > 0 ? Math.min(1, txindex.best_block_height / blocks) : 0,
      };
    }
    return undefined;
  }

  private setState(runtime: ServerRuntime, state: ElectrumServerState): void {
    runtime.state = state;
    if (state !== 'waiting') {
      delete runtime.waitingFor;
      if (state !== 'indexing') delete runtime.progress;
    }
    this.schedulePublish(runtime.nodeId);
  }

  private async startNow(runtime: ServerRuntime, entry: ServerSettings, node: NodeWithStatus): Promise<void> {
    const { profile } = node;
    const installed = await this.newestCompatible(entry);
    if (!installed) return;
    const home = await this.usablePath(this.serverHome(profile.id));
    const dataDirectory = await this.usablePath(entry.dataDirectory);
    let cookieFile: string | undefined;
    let environment: Record<string, string> | undefined;
    if (profile.authentication.kind === 'cookie') {
      const cookie = profile.authentication.cookieFile;
      cookieFile = isFulcrumCompatiblePath(cookie)
        ? cookie
        : join(await this.usablePath(dirname(cookie)), basename(cookie));
    } else {
      const password = await this.options.vault.reveal(profile.authentication.secretId);
      environment = fulcrumCredentialsEnvironment({ username: profile.authentication.username, password });
    }
    for (const [purpose, port] of Object.entries(entry.ports)) {
      if (await isLoopbackPortFree(port)) continue;
      throw this.fail(
        runtime,
        this.failure(
          'electrum.port-in-use',
          `Port ${String(port)} is used by another program, so Fulcrum cannot start.`,
          {
            details: { port, purpose },
            recoveryActions: [{ id: 'start-electrum', label: 'Close the other program and start the server again' }],
          },
        ),
      );
    }
    const [configName, pidName] = SERVER_FILES;
    const configFile = join(home, configName);
    const pidFile = join(home, pidName);
    const databaseMemoryMiB = fulcrumDatabaseMemory(this.options.totalMemoryBytes);
    await writeFile(
      configFile,
      buildFulcrumConfig({
        dataDirectory,
        bitcoind: bitcoindAddress(profile),
        ...(cookieFile === undefined ? {} : { cookieFile }),
        ports: entry.ports,
        pidFile,
        ...(databaseMemoryMiB === undefined ? {} : { databaseMemoryMiB }),
      }),
    );
    await rm(pidFile, { force: true });
    mkdirSync(this.options.logsDirectory, { recursive: true });
    let started: FulcrumProcess;
    try {
      started = await startFulcrumProcess({
        executable: installed.executable,
        configFile,
        directory: dirname(installed.executable),
        logFile: this.logFile(profile.id),
        ...(environment ? { environment } : {}),
      });
    } catch (error) {
      throw this.fail(
        runtime,
        this.failure('electrum.launch-failed', 'Windows did not start Fulcrum.exe.', {
          likelyCause:
            'An antivirus or application-control policy blocked Fulcrum.exe, which its author does not code-sign, or the file was removed.',
          details: { reason: error instanceof Error ? error.message : String(error) },
          recoveryActions: [{ id: 'verify-installation', label: 'Check the installed files' }],
        }),
      );
    }
    runtime.pid = started.pid;
    runtime.process = started;
    runtime.version = installed.version;
    runtime.startedAt = this.now().toISOString();
    runtime.samples = [];
    delete runtime.stats;
    delete runtime.info;
    delete runtime.error;
    this.updateEntry(profile.id, { started: { version: installed.version, pid: started.pid } });
    this.setState(runtime, 'starting');
    this.options.logger.info('Started Fulcrum', { nodeId: profile.id, pid: started.pid, version: installed.version });
    void started.exited.then((exit) => {
      if (runtime.process !== started || runtime.stopping) return;
      void this.exclusive(() => {
        const current = this.entry(profile.id);
        if (runtime.process === started && current) {
          this.lost(
            runtime,
            current,
            `Fulcrum stopped unexpectedly${exit.code === null ? '' : ` (exit code ${String(exit.code)})`}.`,
          );
        }
        return Promise.resolve();
      });
    });
  }

  /** The newest installed Fulcrum with the same major version as the one used before: a new major may change the index. */
  private async newestCompatible(entry: ServerSettings): Promise<FulcrumRuntime | undefined> {
    const installed = await listInstalledFulcrum(this.options.runtimesDirectory);
    const major = entry.started?.version.split('.')[0];
    return (
      (major === undefined ? undefined : installed.find((runtime) => runtime.version.split('.')[0] === major)) ??
      installed[0]
    );
  }

  private fail(runtime: ServerRuntime, failure: AppFailure): AppFailure {
    runtime.error = failure.error;
    this.setState(runtime, 'failed');
    return failure;
  }

  /** Fulcrum went away without being asked to stop. */
  private lost(runtime: ServerRuntime, entry: ServerSettings, message: string): void {
    delete runtime.pid;
    delete runtime.process;
    delete runtime.info;
    delete runtime.stats;
    runtime.samples = [];
    if (this.closing) return;
    const lines = readFulcrumLogTail(this.logFile(entry.nodeId), 15);
    this.options.logger.warn('Fulcrum stopped unexpectedly', { nodeId: entry.nodeId, message, lastLines: lines });
    this.fail(
      runtime,
      this.failure('electrum.exited', message, {
        likelyCause: likelyCause(lines),
        details: { lastLines: lines },
        recoveryActions: [
          { id: 'open-logs', label: 'Open the Electrum server’s log' },
          { id: 'start-electrum', label: 'Start the server again' },
        ],
      }),
    );
    this.backOff(runtime, entry);
  }

  private async observe(runtime: ServerRuntime, entry: ServerSettings, node: NodeWithStatus): Promise<void> {
    const stats = await readFulcrumStats(entry.ports.stats, { timeoutMs: 3_000 }).catch(() => undefined);
    if (!stats) {
      // Still opening its database, or hung: the log says which.
      if (runtime.state !== 'starting') this.setState(runtime, 'starting');
      return;
    }
    runtime.stats = stats;
    const expected = NETWORK_PARAMETERS[node.profile.network].chainName;
    if (stats.chain !== null && stats.chain !== expected) {
      await this.stopNow(runtime, entry, STOP_WAIT_MS);
      throw this.fail(
        runtime,
        this.failure(
          'electrum.wrong-chain',
          `Fulcrum reached a node on "${stats.chain}" instead of "${expected}", so it was stopped.`,
          {
            dataRisk: 'possible',
            likelyCause: 'Another node now answers on this node’s RPC port.',
            recoveryActions: [{ id: 'review-profile', label: 'Check the node’s address' }],
          },
        ),
      );
    }
    const info = await readFulcrumInfo(entry.ports.admin, 3_000).catch(() => undefined);
    if (info) {
      runtime.info = info;
      runtime.samples = [];
      delete runtime.error;
      runtime.failures = [];
      if (Date.now() - (runtime.probedAt ?? 0) >= PROBE_EVERY_MS) await this.probe(runtime, entry, node);
      this.setState(runtime, 'ready');
    } else {
      delete runtime.info;
      const target = stats.targetHeight ?? node.status.snapshot?.blockchain.blocks ?? null;
      if (stats.indexedHeight !== null) {
        const now = Date.now();
        runtime.samples = [
          ...runtime.samples.filter((sample) => now - sample.at <= RATE_WINDOW_MS),
          { at: now, height: stats.indexedHeight },
        ];
      }
      runtime.progress = target && stats.indexedHeight !== null ? Math.min(1, stats.indexedHeight / target) : 0;
      this.setState(runtime, 'indexing');
    }
    await this.refreshIndexSize(runtime, entry);
  }

  /** Checks the Electrum port itself, and that Fulcrum follows this node's chain. */
  private async probe(runtime: ServerRuntime, entry: ServerSettings, node: NodeWithStatus): Promise<void> {
    runtime.probedAt = Date.now();
    try {
      const probe = await probeElectrumServer({ port: entry.ports.electrum, timeoutMs: 5_000 });
      const genesis = await this.nodeGenesis(node.profile.id);
      if (genesis !== undefined && probe.genesisHash !== null && probe.genesisHash !== genesis) {
        await this.stopNow(runtime, entry, STOP_WAIT_MS);
        throw this.fail(
          runtime,
          this.failure(
            'electrum.wrong-chain',
            'The Electrum server follows a different chain from its node, so it was stopped.',
            {
              dataRisk: 'possible',
              recoveryActions: [{ id: 'review-profile', label: 'Check the node’s address' }],
            },
          ),
        );
      }
    } catch (error) {
      if (error instanceof AppFailure) throw error;
      this.options.logger.warn('The Electrum port did not answer the health check', { nodeId: entry.nodeId, error });
    }
  }

  private async nodeGenesis(nodeId: string): Promise<string | undefined> {
    const known = this.genesis.get(nodeId);
    if (known !== undefined) return known;
    try {
      const hash = await this.options.nodes.rpc(nodeId).call<string>('getblockhash', [0]);
      this.genesis.set(nodeId, hash);
      return hash;
    } catch {
      return undefined;
    }
  }

  private async refreshIndexSize(runtime: ServerRuntime, entry: ServerSettings): Promise<void> {
    const now = Date.now();
    if (runtime.indexBytes && now - runtime.indexBytes.at < INDEX_SIZE_EVERY_MS) return;
    runtime.indexBytes = { at: now, value: await folderSize(entry.dataDirectory) };
  }

  private async waitForExit(runtime: ServerRuntime, pid: number, ms: number): Promise<boolean> {
    if (runtime.process) {
      return Promise.race([runtime.process.exited.then(() => true), delay(ms).then(() => false)]);
    }
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (!isProcessAlive(pid)) return true;
      await delay(200);
    }
    return !isProcessAlive(pid);
  }

  /**
   * Stops Fulcrum: through its admin port when it is open (once the index
   * has caught up), otherwise, or when that does not work, by ending it.
   */
  private async stopNow(runtime: ServerRuntime, entry: ServerSettings, waitMs: number): Promise<void> {
    const pid = runtime.pid;
    if (pid === undefined) return;
    runtime.stopping = true;
    this.setState(runtime, 'stopping');
    try {
      let graceful = false;
      try {
        await requestFulcrumStop(entry.ports.admin, 3_000);
        graceful = true;
      } catch {
        // The admin port opens only once the index has caught up.
      }
      if (!graceful || !(await this.waitForExit(runtime, pid, waitMs))) {
        if (graceful)
          this.options.logger.warn('Fulcrum did not stop when asked; ending it', { nodeId: entry.nodeId, pid });
        try {
          process.kill(pid);
        } catch {
          // Already gone.
        }
        await this.waitForExit(runtime, pid, 5_000);
      }
    } finally {
      runtime.stopping = false;
      delete runtime.pid;
      delete runtime.process;
      delete runtime.info;
      delete runtime.stats;
      runtime.samples = [];
      this.forgetStarted(entry.nodeId);
      this.setState(runtime, 'stopped');
    }
  }

  async start(nodeId: string): Promise<ElectrumServerStatus> {
    const entry = this.requireEntry(nodeId);
    this.updateEntry(nodeId, { enabled: true });
    const runtime = this.runtime(nodeId);
    runtime.givenUp = false;
    runtime.failures = [];
    delete runtime.restartAt;
    delete runtime.error;
    if (runtime.state === 'failed') this.setState(runtime, 'stopped');
    await this.exclusive(async () => {
      const node = this.options.nodes.get(nodeId);
      await this.reconcile(runtime, { ...entry, enabled: true }, node);
    });
    this.schedule(0);
    return this.status(nodeId);
  }

  async stop(nodeId: string): Promise<ElectrumServerStatus> {
    const entry = this.requireEntry(nodeId);
    this.updateEntry(nodeId, { enabled: false });
    const runtime = this.runtime(nodeId);
    delete runtime.restartAt;
    await this.exclusive(async () => {
      await this.stopNow(runtime, entry, STOP_WAIT_MS);
      // Also a server that failed or was waiting: stopped by the user, it stays stopped.
      delete runtime.error;
      this.setState(runtime, 'stopped');
    });
    return this.status(nodeId);
  }

  async remove(nodeId: string, deleteIndex: boolean): Promise<ElectrumRemoval> {
    const entry = this.requireEntry(nodeId);
    const runtime = this.runtime(nodeId);
    return this.exclusive(async () => {
      const deleting = deleteIndex && existsSync(entry.dataDirectory);
      // Only a folder BTCortex created for this very server is deleted, which is checked before anything changes.
      if (deleting && this.marker(entry.dataDirectory)?.nodeId !== nodeId) {
        throw this.failure(
          'electrum.index-not-ours',
          'The index folder does not carry BTCortex’s mark for this server, so it was left as it is.',
          { details: { folder: entry.dataDirectory } },
        );
      }
      const deletedBytes = await this.discard(runtime, entry, deleting);
      this.options.logger.info('Removed an Electrum server', { nodeId, deletedIndex: deleteIndex, deletedBytes });
      this.schedulePublish(nodeId);
      return { deletedBytes, keptDirectory: deleteIndex ? null : entry.dataDirectory };
    });
  }

  /** When its node is removed from BTCortex: the server goes too, and its index folder stays where it is. */
  async forgetNode(nodeId: string): Promise<string | null> {
    if (!this.entry(nodeId)) return null;
    const { keptDirectory } = await this.remove(nodeId, false);
    return keptDirectory !== null && existsSync(keptDirectory) ? keptDirectory : null;
  }

  /**
   * Stops the server and forgets it: its onion address (the service withdrawn, the key deleted), the
   * index when asked, Fulcrum's own files, and last its settings, so that a step that fails can be
   * tried again. Returns the size of the deleted index.
   */
  private async discard(runtime: ServerRuntime, entry: ServerSettings, deleteIndex = false): Promise<number> {
    await this.stopNow(runtime, entry, STOP_WAIT_MS);
    if (entry.onion?.serviceId !== undefined) {
      await this.options.tor?.removeOnion(this.onionId(entry.nodeId), entry.onion.serviceId);
    }
    if (entry.onion?.keySecretId !== undefined) this.options.vault.remove(entry.onion.keySecretId);
    let deletedBytes = 0;
    if (deleteIndex && existsSync(entry.dataDirectory)) {
      deletedBytes = await folderSize(entry.dataDirectory);
      await rm(entry.dataDirectory, { recursive: true, force: true, maxRetries: 3 });
    }
    // Only Fulcrum's own files: the index of a node BTCortex did not set up is kept in this folder by default.
    const home = this.serverHome(entry.nodeId);
    for (const file of SERVER_FILES) await rm(join(home, file), { recursive: true, force: true, maxRetries: 3 });
    await rmdir(home).catch(() => undefined);
    this.dropEntry(entry.nodeId);
    this.runtimes.delete(entry.nodeId);
    this.published.delete(entry.nodeId);
    return deletedBytes;
  }

  /** Before BTCortex stops a node at the user's request: its Electrum server stops first, and starts again with it. */
  async beforeNodeStop(profile: NodeProfile, restart: boolean): Promise<void> {
    if (restart) return;
    const entry = this.entry(profile.id);
    const runtime = this.runtimes.get(profile.id);
    if (!entry || runtime?.pid === undefined) return;
    await this.exclusive(() => this.stopNow(runtime, entry, STOP_WAIT_MS));
  }

  /** After a Fulcrum update: running servers move to the newest compatible version. */
  async restartRunning(): Promise<void> {
    await this.exclusive(async () => {
      for (const entry of this.entries()) {
        const runtime = this.runtimes.get(entry.nodeId);
        if (runtime?.pid === undefined) continue;
        const newest = await this.newestCompatible(entry);
        if (!newest || newest.version === runtime.version) continue;
        await this.stopNow(runtime, entry, STOP_WAIT_MS);
      }
    });
    this.schedule(0);
  }

  /**
   * When BTCortex closes: servers of nodes that keep running stay up; the
   * others stop before their nodes do.
   */
  async shutdown(): Promise<void> {
    this.closing = true;
    clearTimeout(this.timer);
    for (const timer of this.publishTimers.values()) clearTimeout(timer);
    const stops: Promise<unknown>[] = [];
    for (const entry of this.entries()) {
      const runtime = this.runtimes.get(entry.nodeId);
      const pid = runtime?.pid;
      if (!runtime || pid === undefined) continue;
      let profile: NodeProfile | undefined;
      try {
        profile = this.options.nodes.get(entry.nodeId).profile;
      } catch {
        profile = undefined;
      }
      if (profile && (profile.execution !== 'managed' || profile.keepRunningOnExit)) continue;
      stops.push(
        (async () => {
          try {
            await requestFulcrumStop(entry.ports.admin, 1_000);
          } catch {
            try {
              process.kill(pid);
            } catch {
              // Already gone.
            }
          }
          await this.waitForExit(runtime, pid, SHUTDOWN_WAIT_MS);
        })(),
      );
    }
    await Promise.all(stops);
  }

  // Status

  private requireEntry(nodeId: string): ServerSettings {
    const entry = this.entry(nodeId);
    if (!entry) {
      throw this.failure('electrum.not-set-up', 'This node has no Electrum server yet.', {
        recoveryActions: [{ id: 'set-up-electrum', label: 'Set up an Electrum server' }],
      });
    }
    return entry;
  }

  private recentLines(nodeId: string): ElectrumLogLine[] {
    const lines: ElectrumLogLine[] = [];
    for (const line of readFulcrumLogTail(this.logFile(nodeId), SHOWN_LINES)) {
      const parsed = parseFulcrumLogLine(line);
      if (parsed) lines.push({ time: parsed.time, severity: parsed.severity, message: parsed.message });
    }
    return lines;
  }

  private blocksPerSecond(runtime: ServerRuntime): number | null {
    const first = runtime.samples[0];
    const last = runtime.samples.at(-1);
    if (!first || !last || last.at - first.at < RATE_MIN_SPAN_MS) return null;
    return Math.max(0, (last.height - first.height) / ((last.at - first.at) / 1000));
  }

  private statusFor(node: NodeWithStatus): ElectrumServerStatus {
    const { profile } = node;
    const unavailable = unavailableReason(node);
    const entry = this.entry(profile.id);
    const base = {
      nodeId: profile.id,
      nodeName: profile.name,
      network: profile.network,
      ...(unavailable === undefined ? {} : { unavailableReason: unavailable }),
    };
    if (!entry) {
      return {
        ...base,
        state: 'not-set-up',
        enabled: false,
        dataDirectory: null,
        ports: null,
        indexing: null,
        server: null,
        indexBytes: null,
        connection: null,
        remoteAccess: { enabled: false, onion: null },
        runningVersion: null,
        pid: null,
        startedAt: null,
        recentLines: [],
      };
    }
    const runtime = this.runtime(profile.id);
    const info = runtime.info;
    return {
      ...base,
      state: runtime.state,
      ...(runtime.state === 'waiting' && runtime.waitingFor ? { waitingFor: runtime.waitingFor } : {}),
      ...(runtime.progress === undefined ? {} : { progress: runtime.progress }),
      enabled: entry.enabled,
      dataDirectory: entry.dataDirectory,
      ports: entry.ports,
      indexing:
        runtime.state === 'indexing'
          ? {
              indexedHeight: runtime.stats?.indexedHeight ?? null,
              targetHeight: runtime.stats?.targetHeight ?? node.status.snapshot?.blockchain.blocks ?? null,
              blocksPerSecond: this.blocksPerSecond(runtime),
            }
          : null,
      server: info
        ? {
            version: info.version,
            height: info.height,
            clients: info.clients,
            uptime: info.uptime,
            ...(info.memoryBytes === undefined ? {} : { memoryBytes: info.memoryBytes }),
          }
        : null,
      indexBytes: runtime.indexBytes?.value ?? null,
      connection: connectionFor(entry.ports.electrum),
      remoteAccess: this.remoteAccess(entry, profile),
      runningVersion: runtime.pid === undefined ? null : (runtime.version ?? null),
      pid: runtime.pid ?? null,
      startedAt: runtime.pid === undefined ? null : (runtime.startedAt ?? null),
      ...(runtime.error ? { error: runtime.error } : {}),
      recentLines: this.recentLines(profile.id),
    };
  }

  status(nodeId: string): ElectrumServerStatus {
    return this.statusFor(this.options.nodes.get(nodeId));
  }

  async overview(): Promise<ElectrumOverview> {
    const newest = await this.newestInstalled();
    return {
      installed: newest ? { version: newest.version, verifiedAt: newest.verification.verifiedAt } : null,
      servers: this.options.nodes.list().map((node) => this.statusFor(node)),
    };
  }

  private schedulePublish(nodeId: string): void {
    if (this.closing || this.publishTimers.has(nodeId)) return;
    const timer = setTimeout(() => {
      this.publishTimers.delete(nodeId);
      let status: ElectrumServerStatus;
      try {
        status = this.status(nodeId);
      } catch {
        return;
      }
      const { recentLines: _lines, ...comparable } = status;
      const key = JSON.stringify(comparable);
      if (this.published.get(nodeId) === key) return;
      this.published.set(nodeId, key);
      this.options.publish({ type: 'electrum.status', at: this.now().toISOString(), payload: status });
    }, PUBLISH_DELAY_MS);
    timer.unref();
    this.publishTimers.set(nodeId, timer);
  }
}

function formatGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
}
