import { nodeSeries } from '@btcortex/contracts';
import type {
  ElectrumOverview,
  ElectrumServerState,
  NodeImplementation,
  NodeLifecycleState,
  NodePrivacy,
  NodeWithStatus,
  ServiceAction,
  ServiceHealth,
  ServiceInstanceState,
  ServiceRequirement,
  TorStatus,
} from '@btcortex/contracts';
import { localDataDirectory } from '../nodes/local-files';
import type { ServiceAdapter } from './service-adapter';
import type { ModuleInstance, ServiceModule } from './service-module';

// The integration modules whose instances BTCortex runs (specification
// sections 24.1 and 29): Bitcoin nodes, Electrum servers and tor. Each wraps
// the catalogue adapter of its integration and adds what orchestration needs —
// its instances, what each needs, and the lifecycle operations of the service
// that owns it. Readiness stays with those services: a node starts tor itself
// when its routing needs it, and an Electrum server waits for its node.

export const TOR_INSTANCE = 'tor';
export const nodeInstance = (nodeId: string) => `node:${nodeId}`;
export const electrumInstance = (nodeId: string) => `electrum:${nodeId}`;

function idAfter(prefix: string, instanceId: string): string {
  if (!instanceId.startsWith(prefix)) throw new Error(`${instanceId} is not one of this module’s instances.`);
  return instanceId.slice(prefix.length);
}

const NODE_STATES: Record<NodeLifecycleState, ServiceInstanceState> = {
  starting: 'starting',
  running: 'running',
  stopping: 'stopping',
  stopped: 'stopped',
  unreachable: 'failed',
  unauthorised: 'failed',
  failed: 'failed',
  unknown: 'unknown',
};

function nodeHealth(node: NodeWithStatus): ServiceHealth {
  switch (node.status.state) {
    case 'running':
      return node.status.snapshot?.blockchain.initialBlockDownload ? 'working' : 'healthy';
    case 'starting':
    case 'stopping':
      return 'working';
    case 'stopped':
      return 'inactive';
    case 'unreachable':
    case 'unauthorised':
      return 'attention';
    case 'failed':
      return 'failed';
    case 'unknown':
      return 'unknown';
  }
}

function nodeSummary(node: NodeWithStatus): string {
  const { status } = node;
  const chain = status.snapshot?.blockchain;
  if (status.state === 'running' && chain) {
    return chain.initialBlockDownload
      ? `Synchronising: ${String(Math.floor(chain.verificationProgress * 100))} %, block ${String(chain.blocks)}.`
      : `Synchronised at block ${String(chain.blocks)}.`;
  }
  if (status.detail) return status.detail;
  const words: Record<NodeLifecycleState, string> = {
    starting: 'Starting.',
    running: 'Running.',
    stopping: 'Stopping.',
    stopped: 'Stopped.',
    unreachable: 'Not answering.',
    unauthorised: 'Refuses BTCortex’s credentials.',
    failed: 'Failed.',
    unknown: 'Not checked yet.',
  };
  return words[status.state];
}

/** What a node needs of BTCortex's tor, from how its routing is set. */
export function torRequirement(privacy: Pick<NodePrivacy, 'mode' | 'onionService'> | null): ServiceRequirement | null {
  if (privacy === null) return null;
  if (privacy.mode === 'all-traffic' || privacy.mode === 'tor-only') {
    return { id: TOR_INSTANCE, hard: true, reason: 'routes its connections through Tor' };
  }
  if (privacy.onionService === true)
    return { id: TOR_INSTANCE, hard: true, reason: 'publishes its onion service through Tor' };
  if (privacy.mode === 'onion-peers')
    return { id: TOR_INSTANCE, hard: false, reason: 'reaches onion peers through Tor' };
  return null;
}

export interface NodeModuleOptions {
  adapter: ServiceAdapter;
  implementation: NodeImplementation;
  name: string;
  nodes: () => NodeWithStatus[];
  privacy: (nodeId: string) => Promise<Pick<NodePrivacy, 'mode' | 'onionService'>>;
  lifecycle: {
    start(nodeId: string): Promise<void>;
    stop(nodeId: string): Promise<void>;
    restart(nodeId: string): Promise<void>;
  };
}

/** Bitcoin nodes of one implementation: managed ones started and stopped, others shown as they are. */
export function nodeModule(options: NodeModuleOptions): ServiceModule {
  const { adapter } = options;
  // BTCortex sets up and updates Bitcoin Core nodes; others it connects to.
  const setUpByBtcortex = options.implementation === 'bitcoin-core';
  return {
    ...adapter,
    state: () => adapter.state(),
    name: options.name,
    permissions: setUpByBtcortex
      ? ['processes', 'files', 'network', 'node-rpc', 'credentials']
      : ['node-rpc', 'credentials'],
    dependencies: [{ id: 'tor', optional: true, reason: 'Routes a node’s connections through Tor when chosen.' }],
    documentation: { document: 'NODE_MANAGEMENT', section: '' },
    updates: setUpByBtcortex ? 'bitcoin-core' : null,
    configuration: { route: '/nodes', summary: 'Each node’s bitcoin.conf, checked before it is saved and backed up.' },
    async instances(): Promise<ModuleInstance[]> {
      const nodes = options.nodes().filter((node) => node.profile.implementation === options.implementation);
      return Promise.all(
        nodes.map(async (node): Promise<ModuleInstance> => {
          const { profile, status } = node;
          const managed = profile.execution === 'managed';
          const tor = torRequirement(await options.privacy(profile.id).catch(() => null));
          const actions: ServiceAction[] = !managed
            ? []
            : status.state === 'running'
              ? ['stop', 'restart']
              : status.state === 'stopped' || status.state === 'failed'
                ? ['start']
                : [];
          return {
            id: nodeInstance(profile.id),
            name: profile.name,
            route: `/nodes/${profile.id}`,
            state: NODE_STATES[status.state],
            health: nodeHealth(node),
            summary: managed ? nodeSummary(node) : `${nodeSummary(node)} BTCortex does not start or stop this node.`,
            actions,
            requires: tor ? [tor] : [],
            logSources: [
              ...(localDataDirectory(profile) === undefined ? [] : [`node:${profile.id}:debug`]),
              ...(managed ? [`node:${profile.id}:console`] : []),
            ],
            metrics: [nodeSeries('node.peers', profile.id), nodeSeries('node.size', profile.id)],
          };
        }),
      );
    },
    async run(instanceId: string, action: ServiceAction): Promise<void> {
      const nodeId = idAfter('node:', instanceId);
      if (action === 'start') await options.lifecycle.start(nodeId);
      else if (action === 'stop') await options.lifecycle.stop(nodeId);
      else await options.lifecycle.restart(nodeId);
    },
  };
}

const wallets = (count: number) => (count === 1 ? '1 wallet' : `${String(count)} wallets`);

const ELECTRUM_STATES: Record<ElectrumServerState, ServiceInstanceState> = {
  'not-set-up': 'stopped',
  waiting: 'waiting',
  starting: 'starting',
  indexing: 'running',
  ready: 'running',
  stopping: 'stopping',
  stopped: 'stopped',
  failed: 'failed',
};

export interface ElectrumModuleOptions {
  adapter: ServiceAdapter;
  overview: () => Promise<ElectrumOverview>;
  lifecycle: { start(nodeId: string): Promise<unknown>; stop(nodeId: string): Promise<unknown> };
}

/** Fulcrum, one Electrum server per node. */
export function electrumModule(options: ElectrumModuleOptions): ServiceModule {
  const { adapter } = options;
  return {
    ...adapter,
    state: () => adapter.state(),
    name: 'Fulcrum',
    permissions: ['processes', 'files', 'network', 'node-rpc', 'credentials'],
    dependencies: [
      { id: 'bitcoin-core', optional: false, reason: 'Indexes the blockchain of a node on this computer.' },
      { id: 'tor', optional: true, reason: 'Publishes an onion service for wallets elsewhere.' },
    ],
    documentation: { document: 'USER_GUIDE', section: 'electrum-servers' },
    updates: 'fulcrum',
    configuration: {
      route: '/electrum',
      summary: 'BTCortex writes Fulcrum’s configuration; remote access is chosen per server.',
    },
    async instances(): Promise<ModuleInstance[]> {
      const overview = await options.overview();
      return overview.servers
        .filter((server) => server.state !== 'not-set-up' && server.unavailableReason === undefined)
        .map((server): ModuleInstance => {
          const state = ELECTRUM_STATES[server.state];
          const actions: ServiceAction[] =
            server.state === 'ready'
              ? ['stop', 'restart']
              : server.state === 'stopped' || server.state === 'failed'
                ? ['start']
                : server.state === 'stopping'
                  ? []
                  : ['stop'];
          return {
            id: electrumInstance(server.nodeId),
            name: `Electrum server of ${server.nodeName}`,
            route: '/electrum',
            state,
            health:
              server.state === 'ready'
                ? 'healthy'
                : server.state === 'failed'
                  ? 'failed'
                  : server.state === 'stopped'
                    ? 'inactive'
                    : 'working',
            summary:
              server.state === 'ready'
                ? `Ready at block ${String(server.server?.height ?? 0)}, ${wallets(server.server?.clients ?? 0)} connected.`
                : server.state === 'indexing'
                  ? `Indexing${server.progress === undefined ? '' : `: ${String(Math.floor(server.progress * 100))} %`}.`
                  : server.state === 'waiting'
                    ? 'Waiting for its node.'
                    : server.state === 'failed'
                      ? (server.error?.message ?? 'Failed.')
                      : server.state === 'stopped'
                        ? 'Stopped. Once started here, it runs with its node again.'
                        : server.state === 'starting'
                          ? 'Starting.'
                          : 'Stopping.',
            actions,
            requires: [
              { id: nodeInstance(server.nodeId), hard: true, reason: 'reads the blockchain from its node' },
              ...(server.remoteAccess.enabled
                ? [
                    {
                      id: TOR_INSTANCE,
                      hard: false,
                      reason: 'is reached by wallets elsewhere through its onion service',
                    },
                  ]
                : []),
            ],
            logSources: [electrumInstance(server.nodeId)],
            metrics: [],
          };
        });
    },
    async run(instanceId: string, action: ServiceAction): Promise<void> {
      const nodeId = idAfter('electrum:', instanceId);
      if (action === 'stop' || action === 'restart') await options.lifecycle.stop(nodeId);
      if (action === 'start' || action === 'restart') await options.lifecycle.start(nodeId);
    },
  };
}

export interface TorModuleOptions {
  adapter: ServiceAdapter;
  status: () => Promise<TorStatus>;
  lifecycle: { start(): Promise<unknown>; stop(): Promise<unknown>; restart(): Promise<unknown> };
}

/** BTCortex's own tor. */
export function torModule(options: TorModuleOptions): ServiceModule {
  const { adapter } = options;
  return {
    ...adapter,
    state: () => adapter.state(),
    name: 'Tor',
    permissions: ['processes', 'files', 'network', 'tor'],
    dependencies: [],
    documentation: { document: 'PRIVACY_AND_TOR', section: '' },
    updates: 'tor',
    configuration: {
      route: '/tor',
      summary: 'BTCortex writes tor’s configuration; only whether it starts with BTCortex is chosen.',
    },
    async instances(): Promise<ModuleInstance[]> {
      const status = await options.status();
      const installed = status.state !== 'not-installed';
      const states: Record<TorStatus['state'], ServiceInstanceState> = {
        'not-installed': 'stopped',
        stopped: 'stopped',
        starting: 'starting',
        running: 'running',
        stopping: 'stopping',
        failed: 'failed',
      };
      const bootstrapped = (status.bootstrap?.progress ?? 0) >= 100;
      return [
        {
          id: TOR_INSTANCE,
          name: 'Tor',
          route: '/tor',
          state: states[status.state],
          health: !installed
            ? 'inactive'
            : status.state === 'running'
              ? bootstrapped
                ? 'healthy'
                : 'working'
              : status.state === 'failed'
                ? 'failed'
                : status.state === 'stopped'
                  ? 'inactive'
                  : 'working',
          summary: !installed
            ? 'Not installed: it can be installed on the Tor & Privacy page.'
            : status.state === 'running'
              ? bootstrapped
                ? 'Connected to the Tor network.'
                : `Connecting to the Tor network: ${String(status.bootstrap?.progress ?? 0)} %.`
              : status.state === 'stopped'
                ? 'Stopped.'
                : status.state === 'failed'
                  ? 'Failed to start.'
                  : status.state === 'starting'
                    ? 'Starting.'
                    : 'Stopping.',
          actions: !installed
            ? []
            : status.state === 'running'
              ? ['stop', 'restart']
              : status.state === 'stopped' || status.state === 'failed'
                ? ['start']
                : [],
          requires: [],
          logSources: ['tor'],
          metrics: [],
        },
      ];
    },
    async run(_instanceId: string, action: ServiceAction): Promise<void> {
      if (action === 'start') await options.lifecycle.start();
      else if (action === 'stop') await options.lifecycle.stop();
      else await options.lifecycle.restart();
    },
  };
}
