import type { BitcoinNetwork } from '@btcortex/bitcoin-config';
import { AppFailure } from '@btcortex/contracts';
import type {
  AppError,
  ConfigurePrivacyResult,
  NodePrivacy,
  NodePrivacyChange,
  NodeProfile,
} from '@btcortex/contracts';
import type { I2pRouterService } from '../i2p/i2p-router';
import type { Logger } from '../logging/logger';
import { chooseLoopbackPort } from '../platform/ports';
import type { TorService, TorUser } from '../tor/tor-service';
import type { NodeConfigService } from './config-service';
import { nodeComponent } from './node-errors';
import type { NodeManager } from './node-manager';
import { applyPrivacy, configuredPrivacy, DEFAULT_ONION_PORTS, PRIVACY_KEYS, torEndpoints } from './privacy';
import type { ConfiguredPrivacy } from './privacy';

// How nodes reach their peers, and routing them through BTCortex's tor
// (specification section 10: Bitcoin Core routing integration, onion services,
// privacy warnings). Only nodes BTCortex set up are changed; their
// bitcoin.conf is edited through the configuration service, so a backup is
// kept and the same safety checks apply, and the node restarts with the new
// routing. A node that routes through Tor gets tor started before it starts.
// I2P peers come through an I2P router the user runs; BTCortex only points
// the node at it, once it answers.

const PRIVATE_BROADCAST_FROM = { major: 31, minor: 1 };

export interface PrivacyServiceOptions {
  nodes: Pick<NodeManager, 'list' | 'get' | 'rpc' | 'restart' | 'appliedConfig'>;
  config: Pick<NodeConfigService, 'get' | 'save'>;
  tor: Pick<TorService, 'ports' | 'fixedPorts' | 'ensureRunning' | 'status'>;
  i2p: Pick<I2pRouterService, 'status'>;
  logger: Logger;
}

function samePrivacy(left: ConfiguredPrivacy, right: ConfiguredPrivacy): boolean {
  return (
    left.mode === right.mode &&
    left.onionService === right.onionService &&
    left.onionPort === right.onionPort &&
    left.privateBroadcast === right.privateBroadcast &&
    left.i2p === right.i2p
  );
}

function atLeast31_1(version: string | null | undefined): boolean {
  const [major = 0, minor = 0] = (version ?? '').split('.').map(Number);
  return (
    major > PRIVATE_BROADCAST_FROM.major ||
    (major === PRIVATE_BROADCAST_FROM.major && minor >= PRIVATE_BROADCAST_FROM.minor)
  );
}

/** Bitcoin Core 31.0's private broadcasting could reveal the sender's address; 31.1 fixed it. */
export function privateBroadcastSupported(profile: NodeProfile, liveVersion: number | undefined): boolean {
  if (profile.implementation !== 'bitcoin-core') return false;
  if (profile.execution === 'managed') return atLeast31_1(profile.runtimeVersion);
  return liveVersion !== undefined && liveVersion >= 310_100;
}

export class PrivacyService {
  constructor(private readonly options: PrivacyServiceOptions) {}

  private failure(profile: NodeProfile, error: Pick<AppError, 'code' | 'message'> & Partial<AppError>): AppFailure {
    return new AppFailure({ component: nodeComponent(profile), dataRisk: 'none', recoveryActions: [], ...error });
  }

  private endpoints() {
    return torEndpoints(this.options.tor.ports());
  }

  private privateBroadcastSupported(profile: NodeProfile, liveVersion: number | undefined): boolean {
    return privateBroadcastSupported(profile, liveVersion);
  }

  async overview(nodeId: string): Promise<NodePrivacy> {
    const node = this.options.nodes.get(nodeId);
    const { profile } = node;
    const tor = this.endpoints();
    const document = await this.options.config.get(nodeId);
    const configured = configuredPrivacy(document.text, profile.network, tor);

    let networks: NodePrivacy['networks'] = [];
    let onionAddress: string | null = null;
    let liveVersion: number | undefined;
    if (node.status.state === 'running') {
      try {
        const info = await this.options.nodes.rpc(nodeId).getNetworkInfo();
        networks = info.networks.map(({ name, reachable, proxy }) => ({ name, reachable, proxy }));
        onionAddress = info.localaddresses.find((local) => local.address.endsWith('.onion'))?.address ?? null;
        liveVersion = info.version;
      } catch (error) {
        this.options.logger.debug('Network information unavailable for the privacy view', { nodeId, error });
      }
    }
    const applied = this.options.nodes.appliedConfig(nodeId);
    const restartRequired =
      node.status.state === 'running' &&
      applied !== undefined &&
      !samePrivacy(configuredPrivacy(applied, profile.network, tor), configured);

    let readOnlyReason: string | undefined;
    if (profile.execution !== 'managed') {
      readOnlyReason =
        'BTCortex changes how a node connects only for nodes it set up. Existing installations stay as they are.';
    } else if (!document.editable) {
      readOnlyReason = document.readOnlyReason ?? 'This node’s configuration cannot be changed from BTCortex.';
    }
    return {
      mode: configured.mode,
      onionService: configured.onionService,
      onionAddress,
      privateBroadcast: configured.privateBroadcast,
      privateBroadcastSupported: this.privateBroadcastSupported(profile, liveVersion),
      manageable: readOnlyReason === undefined,
      ...(readOnlyReason === undefined ? {} : { readOnlyReason }),
      networks,
      restartRequired,
      i2p: configured.i2p,
    };
  }

  /** A free local port for the onion service that no other node's onion service uses either. */
  private async onionPortFor(nodeId: string, network: BitcoinNetwork): Promise<number> {
    const tor = this.endpoints();
    const taken = new Set<number>();
    for (const { profile } of this.options.nodes.list()) {
      if (profile.id === nodeId) continue;
      const document = await this.options.config.get(profile.id).catch(() => undefined);
      const port = document ? configuredPrivacy(document.text, profile.network, tor).onionPort : undefined;
      if (port !== undefined) taken.add(port);
    }
    const preferred = DEFAULT_ONION_PORTS[network];
    for (let port = preferred; port < preferred + 50; port += 1) {
      if (taken.has(port)) continue;
      if ((await chooseLoopbackPort(port, [port, port])) === port) return port;
    }
    throw new AppFailure({
      code: 'privacy.no-free-port',
      message: 'No free local port was found for the onion service.',
      component: 'Tor',
      dataRisk: 'none',
      recoveryActions: [],
    });
  }

  async configure(nodeId: string, change: NodePrivacyChange): Promise<ConfigurePrivacyResult> {
    const node = this.options.nodes.get(nodeId);
    const { profile } = node;
    if (profile.execution !== 'managed') {
      throw this.failure(profile, {
        code: 'privacy.not-managed',
        message:
          'BTCortex changes how a node connects only for nodes it set up. Existing installations stay as they are.',
      });
    }
    if (change.privateBroadcast && change.mode !== 'off' && !this.privateBroadcastSupported(profile, undefined)) {
      throw this.failure(profile, {
        code: 'privacy.private-broadcast-unsupported',
        message: 'Private broadcasting needs Bitcoin Core 31.1 or later on this node.',
        recoveryActions: [{ id: 'open-software', label: 'Move the node to a newer Bitcoin Core' }],
      });
    }
    if (change.mode !== 'off' && (await this.options.tor.status()).installed === null) {
      throw this.failure(profile, {
        code: 'privacy.tor-not-installed',
        message: 'Set up Tor first; this node would then connect through it.',
        recoveryActions: [{ id: 'install-tor', label: 'Set up Tor' }],
      });
    }
    const document = await this.options.config.get(nodeId);
    if (!document.editable) {
      throw this.failure(profile, {
        code: 'config.read-only',
        message: document.readOnlyReason ?? 'This configuration cannot be changed from BTCortex.',
      });
    }
    // tor's ports are settled before the node is pointed at them, even if tor has never run.
    const tor = change.mode === 'off' ? this.endpoints() : torEndpoints(await this.options.tor.fixedPorts());
    const current = configuredPrivacy(document.text, profile.network, tor);
    const i2p = change.i2p ?? current.i2p;
    if (i2p && !current.i2p) {
      const router = await this.options.i2p.status(true);
      if (!router.available) {
        throw this.failure(profile, {
          code: 'privacy.i2p-router-missing',
          message: `No I2P router answers on ${router.samAddress}, so the node would have no I2P peers.`,
          ...(router.error === null ? {} : { likelyCause: router.error }),
          recoveryActions: [{ id: 'open-tor', label: 'Open Tor & Privacy' }],
        });
      }
    }
    const wantsOnion = change.onionService && change.mode !== 'off';
    const onionPort = wantsOnion ? (current.onionPort ?? (await this.onionPortFor(nodeId, profile.network))) : 0;
    const text = applyPrivacy(document.text, profile.network, { ...change, i2p }, tor, onionPort);
    const saved = await this.options.config.save(nodeId, {
      text,
      revision: document.revision,
      // Confirmed by the user: these change what the network can learn about this computer.
      acceptedRisks: [...PRIVACY_KEYS],
    });
    const running = node.status.state === 'running' || node.status.state === 'starting';
    const restarting = running && saved.changedKeys.length > 0;
    this.options.logger.info('Changed how a node connects', {
      nodeId,
      mode: change.mode,
      onionService: wantsOnion,
      privateBroadcast: change.privateBroadcast,
      i2p,
      changedKeys: saved.changedKeys,
    });
    // The node manager starts tor first when the new configuration needs it.
    if (restarting) await this.options.nodes.restart(nodeId);
    return { changedKeys: saved.changedKeys, restarting };
  }

  /** Nodes whose configuration routes through BTCortex's tor. */
  async nodesUsingTor(): Promise<TorUser[]> {
    const tor = this.endpoints();
    const users: TorUser[] = [];
    for (const { profile, status } of this.options.nodes.list()) {
      const document = await this.options.config.get(profile.id).catch(() => undefined);
      if (!document?.exists || !configuredPrivacy(document.text, profile.network, tor).usesTor) continue;
      users.push({
        id: profile.id,
        name: profile.name,
        running: status.state === 'running' || status.state === 'starting',
        // BTCortex never stops a node it did not set up.
        keepRunningOnExit: profile.execution !== 'managed' || profile.keepRunningOnExit,
      });
    }
    return users;
  }

  /**
   * Before a node starts: when its configuration needs tor, tor is started
   * first. A node that would have no connections without tor does not start
   * when tor cannot; one that only adds onion peers starts anyway.
   */
  async prepareStart(profile: NodeProfile, configText: string | undefined): Promise<void> {
    if (configText === undefined) return;
    const configured = configuredPrivacy(configText, profile.network, this.endpoints());
    if (configured.i2p) {
      // I2P adds peers; without the router the node still starts, with the others.
      const router = await this.options.i2p.status();
      if (!router.available) {
        this.options.logger.warn('No I2P router answers; the node starts without its I2P peers', {
          nodeId: profile.id,
          samAddress: router.samAddress,
          error: router.error,
        });
      }
    }
    if (!configured.usesTor) return;
    try {
      await this.options.tor.ensureRunning();
    } catch (error) {
      const required =
        configured.mode === 'all-traffic' || configured.mode === 'tor-only' || configured.onionService === true;
      if (!required) {
        this.options.logger.warn('tor could not be started; the node starts without its onion peers', {
          nodeId: profile.id,
          error,
        });
        return;
      }
      throw this.failure(profile, {
        code: 'privacy.tor-unavailable',
        message: `${profile.name} connects through Tor, but tor could not be started, so the node was not started either.`,
        ...(error instanceof AppFailure
          ? { likelyCause: error.error.message, details: { tor: error.error.code } }
          : {}),
        recoveryActions: [{ id: 'open-tor', label: 'Open Tor & Privacy' }],
      });
    }
  }
}
