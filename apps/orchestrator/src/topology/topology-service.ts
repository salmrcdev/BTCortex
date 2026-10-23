import { NETWORK_PARAMETERS } from '@btcortex/bitcoin-config';
import { endpointParts, isLoopbackHost } from '@btcortex/contracts';
import type {
  ElectrumOverview,
  ElectrumServerState,
  I2pRouterStatus,
  LightningConnectionWithStatus,
  LightningState,
  NodeLifecycleState,
  NodePrivacy,
  NodeWithStatus,
  ServiceHealth,
  SparrowConnectionVia,
  SparrowStatus,
  Topology,
  TopologyElement,
  TopologyLink,
  TorStatus,
} from '@btcortex/contracts';

// The network topology (specification section 10.2): built from the live
// state of every node, its routing as Bitcoin Core reports it, tor, the
// Electrum servers, Sparrow's configured server, the Lightning connections
// and the I2P router nodes use, so that it changes as soon as any of them
// does. Nothing is
// drawn that BTCortex has not seen: an LND node's own Bitcoin back end, for
// example, is not shown, because BTCortex does not know it.

const LIGHTNING_PORT = 9735;

const NODE_HEALTH: Record<NodeLifecycleState, ServiceHealth> = {
  running: 'healthy',
  starting: 'working',
  stopping: 'working',
  stopped: 'inactive',
  unreachable: 'attention',
  unauthorised: 'attention',
  failed: 'failed',
  unknown: 'unknown',
};

const ELECTRUM_HEALTH: Record<ElectrumServerState, ServiceHealth> = {
  'not-set-up': 'unknown',
  waiting: 'working',
  starting: 'working',
  indexing: 'working',
  ready: 'healthy',
  stopping: 'working',
  stopped: 'inactive',
  failed: 'failed',
};

const ELECTRUM_WORDS: Record<ElectrumServerState, string> = {
  'not-set-up': 'not set up',
  waiting: 'waiting for the node',
  starting: 'starting',
  indexing: 'indexing',
  ready: 'ready',
  stopping: 'stopping',
  stopped: 'stopped',
  failed: 'stopped unexpectedly',
};

const LIGHTNING_HEALTH: Record<LightningState, ServiceHealth> = {
  checking: 'working',
  ready: 'healthy',
  syncing: 'working',
  locked: 'attention',
  unreachable: 'attention',
  unauthorised: 'attention',
  failed: 'failed',
};

export interface TopologyServiceOptions {
  nodes: () => NodeWithStatus[];
  privacy: (nodeId: string) => Promise<NodePrivacy>;
  tor: () => Promise<TorStatus>;
  /** The I2P router on this computer; drawn only for nodes that use it. */
  i2p?: () => Promise<I2pRouterStatus>;
  electrum: () => Promise<ElectrumOverview>;
  sparrow: {
    summary(): Promise<{ installed: string | null; running: boolean }>;
    status(nodeId: string, via: SparrowConnectionVia): Promise<SparrowStatus>;
  };
  lightning: () => LightningConnectionWithStatus[];
  version: string;
  now?: () => Date;
}

/** Bitcoin Core's own version from its user agent, for example "/Satoshi:31.1.0/" → 31.1.0. */
function nodeVersion(node: NodeWithStatus): string | null {
  const agent = node.status.snapshot?.network.subversion;
  const match = agent ? /Satoshi:([\d.]+)/.exec(agent) : null;
  return match?.[1] ?? node.profile.runtimeVersion;
}

export class TopologyService {
  constructor(private readonly options: TopologyServiceOptions) {}

  async topology(): Promise<Topology> {
    const elements = new Map<string, TopologyElement>();
    const links: TopologyLink[] = [];
    const add = (element: TopologyElement) => elements.set(element.id, element);
    const link = (entry: Omit<TopologyLink, 'id'>) =>
      links.push({ ...entry, id: `${entry.from}->${entry.to}:${entry.protocol}` });

    add({
      id: 'btcortex',
      kind: 'btcortex',
      label: 'BTCortex',
      detail: `Version ${this.options.version}`,
      health: 'healthy',
      route: '/',
      layer: 0,
    });

    const tor = await this.options.tor().catch(() => undefined);
    const torRunning = tor?.state === 'running';
    const torConnected = torRunning && (tor.bootstrap?.progress ?? 0) >= 100;
    const ensureTor = () => {
      if (!tor || elements.has('tor')) return;
      add({
        id: 'tor',
        kind: 'tor',
        label: 'tor',
        detail: `${tor.installed ? `Tor ${tor.installed.torVersion ?? tor.installed.version}` : 'tor'} · ${torConnected ? 'connected' : torRunning ? 'connecting' : tor.state}`,
        health: torConnected ? 'healthy' : torRunning ? 'working' : tor.state === 'failed' ? 'failed' : 'inactive',
        route: '/tor',
        layer: 3,
      });
      add({
        id: 'tor-network',
        kind: 'tor-network',
        label: 'Tor network',
        detail: 'Relays run by volunteers',
        health: torConnected ? 'healthy' : 'unknown',
        route: null,
        layer: 4,
      });
      link({
        from: 'tor',
        to: 'tor-network',
        protocol: 'Tor',
        port: null,
        protection: 'tor',
        active: torConnected,
        detail: torConnected ? 'Circuits built' : 'Not connected',
      });
    };
    let router: I2pRouterStatus | undefined;
    const ensureI2p = async () => {
      if (elements.has('i2p-router')) return;
      router = await this.options.i2p?.().catch(() => undefined);
      const available = router?.available === true;
      add({
        id: 'i2p-router',
        kind: 'i2p-router',
        label: 'I2P router',
        detail: available
          ? `${router?.program ?? 'I2P router'} · SAM ${router?.samVersion ?? '?'}`
          : router
            ? 'Not answering'
            : 'Not known',
        health: available ? 'healthy' : router ? 'failed' : 'unknown',
        route: '/tor',
        layer: 3,
      });
      add({
        id: 'i2p-network',
        kind: 'i2p-network',
        label: 'I2P network',
        detail: 'Routers of other I2P users',
        health: available ? 'healthy' : 'unknown',
        route: null,
        layer: 4,
      });
      link({
        from: 'i2p-router',
        to: 'i2p-network',
        protocol: 'I2P',
        port: null,
        protection: 'i2p',
        active: available,
        detail: available ? 'Run by the user, not by BTCortex' : 'The router does not answer',
      });
    };
    const ensureBitcoinNetwork = () => {
      if (elements.has('bitcoin-network')) return;
      add({
        id: 'bitcoin-network',
        kind: 'bitcoin-network',
        label: 'Bitcoin network',
        detail: 'Other nodes',
        health: 'unknown',
        route: null,
        layer: 4,
      });
    };

    const sparrowInstalled = (await this.options.sparrow.summary().catch(() => undefined))?.installed != null;
    const electrum = await this.options.electrum().catch(() => undefined);

    for (const node of this.options.nodes()) {
      const { profile, status } = node;
      const id = `node:${profile.id}`;
      const running = status.state === 'running';
      const snapshot = status.snapshot;
      const version = nodeVersion(node);
      const implementation = profile.implementation === 'bitcoin-knots' ? 'Bitcoin Knots' : 'Bitcoin Core';
      add({
        id,
        kind: 'bitcoin-node',
        label: profile.name,
        detail: `${implementation}${version ? ` ${version}` : ''} · ${NETWORK_PARAMETERS[profile.network].label}`,
        health: running && snapshot?.blockchain.initialBlockDownload ? 'working' : NODE_HEALTH[status.state],
        route: `/nodes/${profile.id}`,
        layer: 2,
      });

      const { hostname } = endpointParts(profile.rpcEndpoint);
      const local = isLoopbackHost(hostname);
      const rpcPort = Number(new URL(profile.rpcEndpoint).port) || NETWORK_PARAMETERS[profile.network].rpcPort;
      link({
        from: 'btcortex',
        to: id,
        protocol: 'RPC',
        port: rpcPort,
        protection: local ? 'loopback' : profile.rpcEndpoint.startsWith('https:') ? 'tls' : 'clear',
        active: running,
        detail:
          profile.authentication.kind === 'cookie' ? 'Signed in with the cookie file' : 'Signed in with a password',
      });

      const privacy = await this.options.privacy(profile.id).catch(() => undefined);
      const mode = privacy?.mode ?? 'off';
      const peers = snapshot?.network.connections;
      if (mode !== 'tor-only') {
        ensureBitcoinNetwork();
        link({
          from: id,
          to: 'bitcoin-network',
          protocol: 'Bitcoin P2P',
          port: NETWORK_PARAMETERS[profile.network].p2pPort,
          protection: 'clear',
          active: running && snapshot?.network.networkActive === true,
          detail:
            profile.network === 'regtest'
              ? 'Regtest has no network'
              : peers === undefined
                ? 'Peers not known'
                : `${String(peers)} ${peers === 1 ? 'peer' : 'peers'} in all`,
        });
      }
      if (mode !== 'off' && tor) {
        ensureTor();
        link({
          from: id,
          to: 'tor',
          protocol: 'SOCKS5',
          port: tor.ports.socks,
          protection: 'loopback',
          active: running && torRunning,
          detail:
            mode === 'tor-only'
              ? 'Every connection, to onion peers only'
              : mode === 'all-traffic'
                ? 'Every connection'
                : mode === 'onion-peers'
                  ? 'Connections to onion peers'
                  : 'As set in bitcoin.conf',
        });
        if (privacy?.onionService) {
          link({
            from: 'tor',
            to: id,
            protocol: 'Onion service',
            port: null,
            protection: 'tor',
            active: running && torConnected && privacy.onionAddress !== null,
            detail: privacy.onionAddress ?? 'Not published yet',
          });
        }
      }
      if (privacy?.i2p) {
        await ensureI2p();
        const samPort = Number((router?.samAddress ?? '').split(':').at(-1)) || null;
        link({
          from: id,
          to: 'i2p-router',
          protocol: 'SAM',
          port: samPort,
          protection: 'loopback',
          active: running && router?.available === true,
          detail: 'Connections to I2P peers, each from a new I2P address',
        });
      }

      const server = electrum?.servers.find((candidate) => candidate.nodeId === profile.id);
      if (server && server.state !== 'not-set-up') {
        const serverId = `electrum:${profile.id}`;
        const clients = server.server?.clients;
        add({
          id: serverId,
          kind: 'electrum-server',
          label: `Electrum server of ${profile.name}`,
          detail: `Fulcrum${server.runningVersion ? ` ${server.runningVersion}` : ''} · ${ELECTRUM_WORDS[server.state]}${
            server.state === 'indexing' && server.progress !== undefined
              ? ` ${String(Math.floor(server.progress * 100))} %`
              : ''
          }${clients === undefined ? '' : ` · ${String(clients)} ${clients === 1 ? 'wallet' : 'wallets'}`}`,
          health: ELECTRUM_HEALTH[server.state],
          route: '/electrum',
          layer: 1,
        });
        const serverRunning = ['starting', 'indexing', 'ready'].includes(server.state);
        link({
          from: serverId,
          to: id,
          protocol: 'RPC',
          port: rpcPort,
          protection: 'loopback',
          active: serverRunning && running,
          detail: 'Reads blocks and transactions',
        });
        if (server.remoteAccess.enabled && tor) {
          ensureTor();
          link({
            from: 'tor',
            to: serverId,
            protocol: 'Onion service',
            port: server.ports?.electrum ?? null,
            protection: 'tor',
            active: serverRunning && torConnected,
            detail: server.remoteAccess.onion?.host ?? 'Not published yet',
          });
        }
        if (sparrowInstalled) {
          const sparrow = await this.options.sparrow.status(profile.id, 'electrum').catch(() => undefined);
          if (sparrow?.connection.usesThisNode) {
            this.addSparrow(add, sparrow);
            link({
              from: 'sparrow',
              to: serverId,
              protocol: 'Electrum protocol',
              port: server.ports?.electrum ?? null,
              protection: 'loopback',
              active: sparrow.running && server.state === 'ready',
              detail: 'Sparrow’s server for this network',
            });
          }
        }
      }
      if (sparrowInstalled) {
        const sparrow = await this.options.sparrow.status(profile.id, 'node').catch(() => undefined);
        if (sparrow?.connection.usesThisNode) {
          this.addSparrow(add, sparrow);
          link({
            from: 'sparrow',
            to: id,
            protocol: 'RPC',
            port: rpcPort,
            protection: local ? 'loopback' : 'clear',
            active: sparrow.running && running,
            detail: 'Sparrow’s server for this network',
          });
        }
      }
    }

    for (const { connection, status } of this.options.lightning()) {
      const id = `lightning:${connection.id}`;
      const name = status.alias ?? connection.name;
      add({
        id,
        kind: 'lightning-node',
        label: name,
        detail: `LND${status.version ? ` ${status.version.split(' ')[0] ?? ''}` : ''} · ${String(status.activeChannels)} active ${status.activeChannels === 1 ? 'channel' : 'channels'}`,
        health: LIGHTNING_HEALTH[status.state],
        route: `/lightning?connection=${connection.id}`,
        layer: 1,
      });
      const port = Number(connection.restAddress.split(':').at(-1)) || null;
      link({
        from: 'btcortex',
        to: id,
        protocol: 'REST',
        port,
        protection: connection.via === 'tor' ? 'tor' : 'tls',
        active: status.state !== 'unreachable' && status.state !== 'failed',
        detail: `With a ${connection.macaroon.access} macaroon`,
      });
      if (!elements.has('lightning-network')) {
        add({
          id: 'lightning-network',
          kind: 'lightning-network',
          label: 'Lightning network',
          detail: 'Other Lightning nodes',
          health: 'unknown',
          route: null,
          layer: 4,
        });
      }
      link({
        from: id,
        to: 'lightning-network',
        protocol: 'Lightning P2P',
        port: LIGHTNING_PORT,
        protection: 'unknown',
        active: status.state === 'ready' && status.peers > 0,
        detail: `${String(status.peers)} ${status.peers === 1 ? 'peer' : 'peers'}`,
      });
    }

    // The Bitcoin network is healthy when some node reaches it.
    const network = elements.get('bitcoin-network');
    if (network && links.some((entry) => entry.to === 'bitcoin-network' && entry.active)) {
      elements.set('bitcoin-network', { ...network, health: 'healthy' });
    }
    return {
      checkedAt: (this.options.now?.() ?? new Date()).toISOString(),
      elements: [...elements.values()],
      links,
    };
  }

  private addSparrow(add: (element: TopologyElement) => void, sparrow: SparrowStatus): void {
    add({
      id: 'sparrow',
      kind: 'wallet',
      label: 'Sparrow',
      detail: `${sparrow.installed ? `Sparrow ${sparrow.installed.version}` : 'Sparrow'} · ${sparrow.running ? 'open' : 'closed'}`,
      health: sparrow.running ? 'healthy' : 'inactive',
      route: null,
      layer: 0,
    });
  }
}
