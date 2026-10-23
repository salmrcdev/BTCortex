import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NETWORK_PARAMETERS } from '@btcortex/bitcoin-config';
import {
  BitcoinRpcClient,
  BitcoinRpcError,
  CookieFileError,
  cookieCredentials,
  RpcTransportError,
  staticCredentials,
} from '@btcortex/bitcoin-rpc';
import type { CredentialProvider } from '@btcortex/bitcoin-rpc';
import { AppFailure } from '@btcortex/contracts';
import type {
  NodeLifecycleState,
  NodeProfile,
  NodeStatus,
  NodeWithStatus,
  OrchestratorEvent,
  MetricsPoint,
  RpcStatistic,
} from '@btcortex/contracts';
import {
  configFilePath,
  findInstalledRuntime,
  isProcessAlive,
  processImageName,
  readConsoleTail,
  readRunningPid,
  startBitcoind,
  SyncEstimator,
  takeSnapshot,
} from '@btcortex/integration-bitcoin-core';
import { findInstalledKnots } from '@btcortex/integration-bitcoin-knots';
import { redactString } from '@btcortex/core';
import type { Logger } from '../logging/logger';
import type { SecretVault } from '../vault/vault';
import { describeNodeError, nodeComponent } from './node-errors';
import type { NodeRepository } from './repository';
import { MetricsHistory } from './metrics-history';
import { RpcStatistics } from './rpc-statistics';

// Lifecycle and monitoring of registered nodes. Each node has one polling
// loop; the interval adapts to the node's state (specification section 32:
// avoid excessive polling, back off on failure, never overlap requests).

const POLL_STARTING_MS = 2_000;
const POLL_SYNCHRONISING_MS = 5_000;
const POLL_SYNCHRONISED_MS = 15_000;
const POLL_STOPPED_MS = 15_000;
const BACKOFF_INITIAL_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;
const RPC_TIMEOUT_MS = 15_000;

interface NodeRuntime {
  profile: NodeProfile;
  client: BitcoinRpcClient;
  estimator: SyncEstimator;
  status: NodeStatus;
  timer: NodeJS.Timeout | undefined;
  polling: boolean;
  backoffMs: number;
  /** Set while a stop request is in progress. */
  stopping: boolean;
  /** The last check got an answer from RPC (including a warm-up error). */
  answering: boolean;
  /** Set by `restart`: start the node again as soon as it has shut down. */
  restartPending: boolean;
  /** One-shot arguments for that next start, such as a confirmed `-reindex`. */
  restartArguments: readonly MaintenanceArgument[];
  /** bitcoin.conf as it was when BTCortex last started the node; unknown for nodes started elsewhere. */
  appliedConfig: string | undefined;
  statistics: RpcStatistics;
  history: MetricsHistory;
  /** The process BTCortex launched, followed until bitcoind writes its own pid file. */
  launchedPid: number | undefined;
  /** A pid from the pid file already confirmed to be bitcoind. */
  verifiedPid: number | undefined;
  /** When the current stop request was made, to notice one Bitcoin Core never carried out. */
  stopRequestedAt: number | undefined;
  /** The last start failed; its explanation stays until the user acts. */
  startFailed: boolean;
}

/** One-shot start arguments BTCortex may pass, each only after explicit confirmation. */
export const MAINTENANCE_ARGUMENTS = ['-reindex', '-reindex-chainstate'] as const;
export type MaintenanceArgument = (typeof MAINTENANCE_ARGUMENTS)[number];

export interface StartOptions {
  /** Passed to this start only, never written to bitcoin.conf. */
  oneShotArguments?: readonly MaintenanceArgument[];
}

/** A stop request is considered lost if the node still answers this long afterwards. */
const STOP_DEADLINE_MS = 2 * 60_000;

function managedPaths(profile: NodeProfile): { dataDirectory: string; runtimeVersion: string } {
  if (profile.execution !== 'managed' || !profile.dataDirectory || !profile.runtimeVersion) {
    throw new AppFailure({
      code: 'nodes.not-managed',
      message: 'BTCortex can only start nodes it installed itself.',
      component: nodeComponent(profile),
      dataRisk: 'none',
      likelyCause: 'This node runs outside BTCortex, which only connects to it.',
      recoveryActions: [{ id: 'start-externally', label: 'Start the node with the program that manages it' }],
    });
  }
  return { dataDirectory: profile.dataDirectory, runtimeVersion: profile.runtimeVersion };
}

function readConfigText(dataDirectory: string): string {
  const path = configFilePath(dataDirectory);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

export interface NodeManagerOptions {
  repository: NodeRepository;
  vault: SecretVault;
  runtimesDirectory: string;
  /** Bitcoin Knots runtimes, for the Knots nodes BTCortex set up. */
  knotsRuntimesDirectory?: string;
  publish: (event: OrchestratorEvent) => void;
  logger: Logger;
  now?: () => Date;
  /** Looks up a process's executable name; replaced in tests. */
  processImageName?: (pid: number) => Promise<string | undefined>;
  /**
   * Runs before a managed node starts, with the bitcoin.conf it is about to
   * read; throwing stops the start. Starts tor for nodes that route through it.
   */
  beforeStart?: (profile: NodeProfile, configText: string) => Promise<void>;
  /**
   * Runs before BTCortex asks a node to stop; `restart` is true when it
   * starts again right afterwards. Stops the node's Electrum server first
   * (wallets, then Fulcrum, then bitcoind). A failure does not stop the stop.
   */
  beforeStop?: (profile: NodeProfile, restart: boolean) => Promise<void>;
}

export class NodeManager {
  private readonly nodes = new Map<string, NodeRuntime>();
  private readonly now: () => Date;
  private closed = false;

  constructor(private readonly options: NodeManagerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** Loads every stored profile and starts monitoring it. */
  initialise(): void {
    for (const profile of this.options.repository.list()) this.track(profile);
  }

  list(): NodeWithStatus[] {
    return [...this.nodes.values()].map((runtime) => ({ profile: runtime.profile, status: runtime.status }));
  }

  get(nodeId: string): NodeWithStatus {
    const runtime = this.require(nodeId);
    return { profile: runtime.profile, status: runtime.status };
  }

  /** Starts monitoring a newly registered profile. */
  track(profile: NodeProfile): void {
    if (this.nodes.has(profile.id)) return;
    const client = new BitcoinRpcClient({
      endpoint: profile.rpcEndpoint,
      credentials: this.credentialsFor(profile),
      timeoutMs: RPC_TIMEOUT_MS,
    });
    const statistics = new RpcStatistics();
    client.onCall((call) => {
      statistics.record(call);
    });
    const runtime: NodeRuntime = {
      profile,
      client,
      statistics,
      history: new MetricsHistory(),
      estimator: new SyncEstimator(),
      status: { nodeId: profile.id, state: 'unknown', checkedAt: this.now().toISOString() },
      timer: undefined,
      polling: false,
      backoffMs: BACKOFF_INITIAL_MS,
      stopping: false,
      answering: false,
      restartPending: false,
      restartArguments: [],
      appliedConfig: undefined,
      launchedPid: undefined,
      verifiedPid: undefined,
      stopRequestedAt: undefined,
      startFailed: false,
    };
    this.nodes.set(profile.id, runtime);
    this.schedule(runtime, 0);
  }

  /** Whether the node's RPC interface answered the most recent check. */
  isAnswering(nodeId: string): boolean {
    return this.require(nodeId).answering;
  }

  /** Per-minute samples since BTCortex started monitoring the node (at most a day). */
  metrics(nodeId: string): MetricsPoint[] {
    return this.require(nodeId).history.list();
  }

  /** Counts and durations of every RPC call BTCortex made to the node. */
  rpcStatistics(nodeId: string): RpcStatistic[] {
    return this.require(nodeId).statistics.list();
  }

  /** The node's RPC client, for services that act on the node (peers, console). */
  rpc(nodeId: string): BitcoinRpcClient {
    return this.require(nodeId).client;
  }

  /** The bitcoin.conf the running node was started with, if BTCortex started it in this session. */
  appliedConfig(nodeId: string): string | undefined {
    return this.require(nodeId).appliedConfig;
  }

  /** Replaces a tracked node's profile, for example after it moved to another Bitcoin Core version. */
  updateProfile(profile: NodeProfile): void {
    this.require(profile.id).profile = profile;
  }

  /**
   * Chooses whether a managed node starts when BTCortex starts and keeps
   * running after BTCortex quits (specification section 32). Its Electrum
   * server and tor follow it.
   */
  configureLifecycle(
    nodeId: string,
    change: { keepRunningOnExit?: boolean; startWithBtcortex?: boolean },
  ): NodeProfile {
    const runtime = this.require(nodeId);
    const { profile } = runtime;
    if (profile.execution !== 'managed') {
      throw new AppFailure({
        code: 'nodes.not-managed',
        message: 'BTCortex starts and stops only the nodes it set up; this one keeps to the program that runs it.',
        component: nodeComponent(profile),
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
    const policy = {
      keepRunningOnExit: change.keepRunningOnExit ?? profile.keepRunningOnExit,
      startWithBtcortex: change.startWithBtcortex ?? profile.startWithBtcortex,
    };
    const updated = this.options.repository.setLifecycle(nodeId, policy, this.now().toISOString()) ?? {
      ...profile,
      ...policy,
    };
    runtime.profile = updated;
    this.options.logger.info('Changed when a node starts and stops', { nodeId, ...policy });
    return updated;
  }

  /** Starts the managed nodes chosen to start with BTCortex; called once everything else is ready. */
  async startChosenNodes(): Promise<void> {
    const chosen = [...this.nodes.values()].filter(
      (runtime) => runtime.profile.execution === 'managed' && runtime.profile.startWithBtcortex,
    );
    for (const runtime of chosen) {
      try {
        await this.start(runtime.profile.id);
      } catch (error) {
        this.options.logger.warn('A node chosen to start with BTCortex did not start', {
          nodeId: runtime.profile.id,
          error,
        });
      }
    }
  }

  untrack(nodeId: string): void {
    const runtime = this.nodes.get(nodeId);
    if (!runtime) return;
    if (runtime.timer) clearTimeout(runtime.timer);
    this.nodes.delete(nodeId);
  }

  async start(nodeId: string, options: StartOptions = {}): Promise<void> {
    const runtime = this.require(nodeId);
    const { profile } = runtime;
    const { dataDirectory, runtimeVersion } = managedPaths(profile);
    const network = profile.network;
    if (this.closed) return;
    if (await this.managedProcessRunning(runtime)) {
      this.schedule(runtime, 0);
      return;
    }
    // A Knots node runs only Knots and a Core node only Core: they follow different chains.
    const knots = profile.implementation === 'bitcoin-knots';
    const product = knots ? 'Bitcoin Knots' : 'Bitcoin Core';
    const runtimesDirectory = knots ? this.options.knotsRuntimesDirectory : this.options.runtimesDirectory;
    const installed =
      runtimesDirectory === undefined
        ? undefined
        : knots
          ? await findInstalledKnots(runtimesDirectory, runtimeVersion)
          : await findInstalledRuntime(runtimesDirectory, runtimeVersion);
    // BTCortex may have begun to close while the runtime was being located.
    if (this.isClosed()) return;
    if (!installed) {
      throw new AppFailure({
        code: 'nodes.runtime-missing',
        message: `The verified ${product} ${runtimeVersion} runtime for this node is missing.`,
        component: nodeComponent(profile),
        dataRisk: 'none',
        likelyCause: 'The runtime folder was deleted or moved.',
        details: { expectedIn: join(runtimesDirectory ?? '', runtimeVersion) },
        recoveryActions: [{ id: 'reinstall-runtime', label: `Reinstall ${product} for this node` }],
      });
    }
    const configText = readConfigText(dataDirectory);
    await this.options.beforeStart?.(profile, configText);
    if (this.isClosed()) return;
    runtime.appliedConfig = configText;
    const extraArguments = (options.oneShotArguments ?? []).filter((argument) =>
      (MAINTENANCE_ARGUMENTS as readonly string[]).includes(argument),
    );
    const started = startBitcoind({ bitcoind: installed.bitcoind, dataDirectory, network, extraArguments });
    this.options.logger.info('Started bitcoind', { nodeId, pid: started.pid, arguments: started.arguments });
    runtime.launchedPid = started.pid;
    runtime.verifiedPid = undefined;
    runtime.startFailed = false;
    runtime.stopping = false;
    runtime.stopRequestedAt = undefined;
    runtime.estimator.reset();
    this.update(runtime, { state: 'starting', detail: `Starting ${product}…` });
    this.schedule(runtime, POLL_STARTING_MS);
  }

  /** Requests a graceful shutdown through RPC; the poll loop reports when it has stopped. */
  async stop(nodeId: string): Promise<void> {
    const runtime = this.require(nodeId);
    if (runtime.profile.execution !== 'managed') {
      // A node on another computer, or one the user runs here: whoever runs it stops it.
      throw new AppFailure({
        code: 'nodes.not-managed',
        message: 'BTCortex stops only the nodes it set up itself.',
        component: nodeComponent(runtime.profile),
        dataRisk: 'none',
        likelyCause: 'This node runs outside BTCortex, which only connects to it.',
        recoveryActions: [{ id: 'stop-externally', label: 'Stop the node with the program that runs it' }],
      });
    }
    // A shutdown is already under way: a second request would fail and undo the first one's bookkeeping.
    if (runtime.stopping) return;
    runtime.stopping = true;
    runtime.stopRequestedAt = this.now().getTime();
    this.update(runtime, { state: 'stopping', detail: 'Writing the database to disk before stopping…' });
    try {
      await this.options.beforeStop?.(runtime.profile, runtime.restartPending);
    } catch (error) {
      this.options.logger.warn('Preparing a node to stop failed; stopping it anyway', { nodeId, error });
    }
    try {
      await runtime.client.stop();
    } catch (error) {
      // A request that timed out may still be carried out; the poll loop finds out either way.
      if (!(error instanceof RpcTransportError && error.failure === 'timeout')) {
        runtime.stopping = false;
        runtime.restartPending = false;
        runtime.restartArguments = [];
        runtime.stopRequestedAt = undefined;
      }
      throw new AppFailure(describeNodeError(runtime.profile, error));
    }
    this.schedule(runtime, POLL_STARTING_MS);
  }

  /** Stops a managed node gracefully; the poll loop starts it again once it has shut down. */
  async restart(nodeId: string, options: StartOptions = {}): Promise<void> {
    const runtime = this.require(nodeId);
    managedPaths(runtime.profile);
    runtime.restartArguments = options.oneShotArguments ?? [];
    if (runtime.stopping) {
      // Already shutting down: start again once it has.
      runtime.restartPending = true;
      return;
    }
    if (runtime.status.state === 'stopped' || runtime.status.state === 'failed') {
      runtime.restartArguments = [];
      await this.start(nodeId, options);
      return;
    }
    runtime.restartPending = true;
    await this.stop(nodeId);
  }

  /** Called when BTCortex exits: stops polling and stops managed nodes whose policy says so. */
  async shutdown(): Promise<void> {
    this.closed = true;
    const stops: Promise<unknown>[] = [];
    for (const runtime of this.nodes.values()) {
      if (runtime.timer) clearTimeout(runtime.timer);
      runtime.restartPending = false;
      runtime.restartArguments = [];
      if (
        runtime.profile.execution === 'managed' &&
        !runtime.profile.keepRunningOnExit &&
        (runtime.status.state === 'running' || runtime.status.state === 'starting')
      ) {
        // bitcoind finishes its own shutdown after receiving `stop`; there is no need to wait here. A node
        // still warming up may refuse the request; it is still worth asking.
        stops.push(runtime.client.stop({ timeoutMs: 3_000 }).catch(() => undefined));
      }
    }
    await Promise.all(stops);
  }

  /** Read through a method, so that a check after an await sees the current value. */
  private isClosed(): boolean {
    return this.closed;
  }

  /** Whether a managed node's bitcoind runs now, whatever its last RPC answer was. */
  async isProcessRunning(nodeId: string): Promise<boolean> {
    return (await this.managedProcessRunning(this.require(nodeId))) === true;
  }

  /**
   * Whether a managed node's bitcoind runs: its pid file, once confirmed to name
   * bitcoind (Windows reuses process numbers, so a stale file can name another
   * program), or the process BTCortex just launched, until it writes that file.
   */
  private async managedProcessRunning(runtime: NodeRuntime): Promise<boolean | undefined> {
    const { profile } = runtime;
    if (profile.execution !== 'managed' || !profile.dataDirectory) return undefined;
    const pid = readRunningPid(profile.dataDirectory, profile.network);
    if (pid !== undefined) {
      if (pid === runtime.verifiedPid || pid === runtime.launchedPid) return true;
      const image = await (this.options.processImageName ?? processImageName)(pid);
      // Without an answer (another platform, a failed lookup) the pid file is trusted as before.
      if (image === undefined || image === 'bitcoind.exe') {
        runtime.verifiedPid = pid;
        return true;
      }
    }
    return runtime.launchedPid !== undefined && isProcessAlive(runtime.launchedPid);
  }

  private credentialsFor(profile: NodeProfile): CredentialProvider {
    if (profile.authentication.kind === 'cookie') return cookieCredentials(profile.authentication.cookieFile);
    const { username, secretId } = profile.authentication;
    let cached: Promise<CredentialProvider> | undefined;
    const vault = this.options.vault;
    const resolve = () => {
      cached ??= vault.reveal(secretId).then((password) => staticCredentials({ username, password }));
      return cached;
    };
    return {
      description: `user ${username}`,
      get: async () => (await resolve()).get(),
      invalidate: () => {
        cached = undefined;
      },
    };
  }

  private require(nodeId: string): NodeRuntime {
    const runtime = this.nodes.get(nodeId);
    if (!runtime) {
      throw new AppFailure({
        code: 'nodes.not-found',
        message: 'This node is not registered in BTCortex.',
        component: 'Node profiles',
        dataRisk: 'none',
        recoveryActions: [{ id: 'refresh', label: 'Refresh the list of nodes' }],
      });
    }
    return runtime;
  }

  private schedule(runtime: NodeRuntime, delayMs: number): void {
    if (this.closed) return;
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.timer = setTimeout(() => void this.poll(runtime), delayMs);
    runtime.timer.unref();
  }

  private update(
    runtime: NodeRuntime,
    change: Omit<Partial<NodeStatus>, 'nodeId'> & { state: NodeLifecycleState },
  ): void {
    const status: NodeStatus = {
      nodeId: runtime.profile.id,
      state: change.state,
      checkedAt: this.now().toISOString(),
      ...(change.detail === undefined ? {} : { detail: change.detail }),
      // Keep the last snapshot visible (marked stale by checkedAt) while the node is unreachable.
      ...((change.snapshot ?? runtime.status.snapshot) ? { snapshot: change.snapshot ?? runtime.status.snapshot } : {}),
      ...(change.syncEstimate === undefined ? {} : { syncEstimate: change.syncEstimate }),
      ...(change.error === undefined ? {} : { error: change.error }),
      ...(change.processRunning === undefined ? {} : { processRunning: change.processRunning }),
    };
    runtime.status = status;
    this.options.publish({ type: 'node.status', at: status.checkedAt, payload: status });
  }

  private async poll(runtime: NodeRuntime): Promise<void> {
    if (runtime.polling || this.closed || !this.nodes.has(runtime.profile.id)) return;
    runtime.polling = true;
    let nextDelay = POLL_SYNCHRONISED_MS;
    const { profile } = runtime;
    const managedRunning = await this.managedProcessRunning(runtime);
    try {
      const snapshot = await takeSnapshot(runtime.client, this.now);
      runtime.answering = true;
      runtime.backoffMs = BACKOFF_INITIAL_MS;
      const expectedChain = NETWORK_PARAMETERS[profile.network].chainName;
      if (snapshot.blockchain.chain !== expectedChain) {
        // Never let a profile meant for one network operate on another (specification section 5.4).
        this.update(runtime, {
          state: 'failed',
          ...(managedRunning === undefined ? {} : { processRunning: managedRunning }),
          error: {
            code: 'nodes.network-mismatch',
            message: `This node runs on "${snapshot.blockchain.chain}", but the profile expects "${expectedChain}". BTCortex will not use it until this is resolved.`,
            component: nodeComponent(profile),
            dataRisk: 'possible',
            likelyCause: 'The node’s configuration or the RPC address points to a different network.',
            details: { endpoint: profile.rpcEndpoint },
            recoveryActions: [{ id: 'review-profile', label: 'Check the node’s address and configuration' }],
          },
        });
        nextDelay = POLL_STOPPED_MS;
        return;
      }
      runtime.history.record(snapshot);
      runtime.estimator.record({
        atMs: Date.parse(snapshot.takenAt),
        verificationProgress: snapshot.blockchain.verificationProgress,
        blocks: snapshot.blockchain.blocks,
      });
      const estimate = snapshot.blockchain.initialBlockDownload ? runtime.estimator.estimate() : undefined;
      if (
        runtime.stopping &&
        runtime.stopRequestedAt !== undefined &&
        this.now().getTime() - runtime.stopRequestedAt > STOP_DEADLINE_MS
      ) {
        // Bitcoin Core still answers long after the request: it never received it.
        this.options.logger.warn('A stop request was not carried out', { nodeId: profile.id });
        runtime.stopping = false;
        runtime.restartPending = false;
        runtime.restartArguments = [];
        runtime.stopRequestedAt = undefined;
      }
      if (runtime.stopping) {
        this.update(runtime, { state: 'stopping', detail: 'Writing the database to disk before stopping…', snapshot });
        nextDelay = POLL_STARTING_MS;
      } else {
        this.update(runtime, { state: 'running', snapshot, ...(estimate ? { syncEstimate: estimate } : {}) });
        nextDelay = snapshot.blockchain.initialBlockDownload ? POLL_SYNCHRONISING_MS : POLL_SYNCHRONISED_MS;
      }
    } catch (error) {
      nextDelay = this.handlePollError(runtime, error, managedRunning);
    } finally {
      runtime.polling = false;
      this.schedule(runtime, nextDelay);
    }
  }

  private handlePollError(runtime: NodeRuntime, error: unknown, managedRunning: boolean | undefined): number {
    const { profile } = runtime;
    runtime.answering = error instanceof BitcoinRpcError;
    if (error instanceof BitcoinRpcError && error.isWarmingUp) {
      this.update(runtime, { state: runtime.stopping ? 'stopping' : 'starting', detail: error.message });
      return POLL_STARTING_MS;
    }
    const notListening =
      error instanceof CookieFileError || (error instanceof RpcTransportError && error.failure === 'unreachable');

    if (notListening && profile.execution === 'managed') {
      if (managedRunning) {
        // The process exists but RPC is not up yet (or is going down).
        this.update(runtime, {
          state: runtime.stopping ? 'stopping' : 'starting',
          detail: runtime.stopping ? 'Stopping…' : 'Waiting for Bitcoin Core to accept connections…',
        });
        return POLL_STARTING_MS;
      }
      // The process is gone.
      runtime.launchedPid = undefined;
      runtime.verifiedPid = undefined;
      runtime.stopRequestedAt = undefined;
      const wasStarting = runtime.status.state === 'starting' && !runtime.stopping;
      runtime.stopping = false;
      if (wasStarting && profile.dataDirectory) {
        runtime.startFailed = true;
        // The process exited during start-up: report what it printed.
        // Parse errors quote the offending bitcoin.conf line, which may hold a password.
        const tail = readConsoleTail(profile.dataDirectory, profile.network, 10).map((line) => redactString(line));
        this.update(runtime, {
          state: 'failed',
          error: {
            code: 'bitcoin-core.start-failed',
            message: 'Bitcoin Core stopped while starting.',
            component: nodeComponent(profile),
            dataRisk: 'unknown',
            likelyCause: tail.at(-1) ?? 'Bitcoin Core exited without an explanation.',
            details: { consoleOutput: tail },
            recoveryActions: [
              { id: 'open-logs', label: 'Open the node log' },
              { id: 'start-node', label: 'Try starting it again' },
            ],
          },
        });
        return POLL_STOPPED_MS;
      }
      runtime.appliedConfig = undefined;
      if (runtime.restartPending) {
        runtime.restartPending = false;
        const oneShotArguments = runtime.restartArguments;
        runtime.restartArguments = [];
        this.options.logger.info('Starting the node again after a restart request', {
          nodeId: profile.id,
          oneShotArguments,
        });
        this.start(profile.id, { oneShotArguments }).catch((failure: unknown) => {
          runtime.startFailed = true;
          this.update(runtime, {
            state: 'failed',
            error: failure instanceof AppFailure ? failure.error : describeNodeError(profile, failure),
          });
        });
        return POLL_STARTING_MS;
      }
      // A failed start keeps its explanation until the user acts.
      if (runtime.startFailed) return POLL_STOPPED_MS;
      this.update(runtime, { state: 'stopped' });
      return POLL_STOPPED_MS;
    }

    const described = describeNodeError(profile, error);
    const state: NodeLifecycleState =
      described.code === 'bitcoin-core.unauthorised'
        ? 'unauthorised'
        : described.code === 'bitcoin-core.unreachable' || described.code === 'bitcoin-core.timeout'
          ? 'unreachable'
          : 'failed';
    if (state === 'failed') this.options.logger.warn('Node check failed', { nodeId: profile.id, error });
    this.update(runtime, {
      state,
      error: described,
      ...(managedRunning === undefined ? {} : { processRunning: managedRunning }),
    });
    const delay = runtime.backoffMs;
    runtime.backoffMs = Math.min(runtime.backoffMs * 2, BACKOFF_MAX_MS);
    return delay;
  }
}
