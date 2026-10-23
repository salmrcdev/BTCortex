import { z } from 'zod';
import { BitcoinRpcError } from '@btcortex/bitcoin-rpc';
import type { BitcoinRpcClient } from '@btcortex/bitcoin-rpc';
import { AppFailure, isLoopbackHost } from '@btcortex/contracts';
import type { NetworkOverview, PeerEvent, PeerSummary } from '@btcortex/contracts';
import { listPeers } from '@btcortex/integration-bitcoin-core';
import type { Logger } from '../logging/logger';
import { describeNodeError, nodeComponent } from './node-errors';
import type { NodeManager } from './node-manager';

// Network and peer management (specification section 5.8): who the node is
// connected to, manual connections, bans, and a short history of connections
// and disconnections, kept in memory only.

const HISTORY_LIMIT = 200;
const BACKGROUND_REFRESH_MS = 60_000;
/** Bitcoin Core's answers to a peer request it will not carry out (already added, not found, …). */
const REFUSALS = new Set([-23, -24, -29, -30]);

const AddedNodesSchema = z.array(z.looseObject({ addednode: z.string(), connected: z.boolean() }));
const BannedSchema = z.array(z.looseObject({ address: z.string(), ban_created: z.number(), banned_until: z.number() }));

export interface PeerServiceOptions {
  nodes: Pick<NodeManager, 'get' | 'list' | 'rpc'>;
  logger: Logger;
  now?: () => Date;
}

/** setban takes an address or subnet without a port. */
export function banTarget(input: string): string {
  const text = input.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?(\/\d+)?$/.exec(text);
  if (bracketed) return `${bracketed[1] ?? ''}${bracketed[2] ?? ''}`;
  // One colon means host:port; IPv6 addresses have several.
  if (!text.includes('/') && text.split(':').length === 2) return text.slice(0, text.indexOf(':'));
  return text;
}

function refuseBan(target: string): string | undefined {
  const [host = '', mask] = target.split('/');
  if (isLoopbackHost(host)) {
    return 'Every incoming Tor and I2P connection arrives from this computer’s own address, so banning it would cut the node off from those networks.';
  }
  if (host === '0.0.0.0' || host === '::' || mask === '0') return 'That would ban every address.';
  return undefined;
}

export class PeerService {
  private readonly events = new Map<string, PeerEvent[]>();
  private readonly known = new Map<string, Map<number, PeerSummary>>();
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: PeerServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** Keeps the connection history going while nobody looks at the peers. */
  start(): void {
    this.timer = setInterval(() => void this.refreshRunningNodes(), BACKGROUND_REFRESH_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async peers(nodeId: string): Promise<PeerSummary[]> {
    const peers = await this.withNode(nodeId, (client) => listPeers(client));
    this.record(nodeId, peers);
    return peers;
  }

  /** Newest first. */
  history(nodeId: string): PeerEvent[] {
    this.options.nodes.get(nodeId);
    return [...(this.events.get(nodeId) ?? [])].reverse();
  }

  async network(nodeId: string): Promise<NetworkOverview> {
    return this.withNode(nodeId, async (client) => {
      const [info, added, banned] = await Promise.all([
        client.getNetworkInfo(),
        client.call('getaddednodeinfo').then((value) => AddedNodesSchema.parse(value)),
        client.call('listbanned').then((value) => BannedSchema.parse(value)),
      ]);
      return {
        networkActive: info.networkactive,
        connectionsIn: info.connections_in,
        connectionsOut: info.connections_out,
        networks: info.networks.map((network) => ({
          name: network.name,
          reachable: network.reachable,
          limited: network.limited,
          ...(network.proxy === '' ? {} : { proxy: network.proxy }),
        })),
        localAddresses: info.localaddresses.map(({ address, port, score }) => ({ address, port, score })),
        added: added.map((entry) => ({ address: entry.addednode, connected: entry.connected })),
        banned: banned.map((entry) => ({
          address: entry.address,
          bannedUntil: entry.banned_until,
          createdAt: entry.ban_created,
        })),
      };
    });
  }

  async disconnect(nodeId: string, peerId: number): Promise<void> {
    await this.withNode(nodeId, (client) => client.call('disconnectnode', ['', peerId]));
  }

  async connect(nodeId: string, address: string, keep: boolean): Promise<void> {
    await this.withNode(nodeId, (client) => client.call('addnode', [address, keep ? 'add' : 'onetry']));
  }

  async forget(nodeId: string, address: string): Promise<void> {
    await this.withNode(nodeId, (client) => client.call('addnode', [address, 'remove']));
  }

  async ban(nodeId: string, input: string, durationSeconds: number): Promise<void> {
    const target = banTarget(input);
    const refusal = refuseBan(target);
    if (refusal !== undefined) {
      throw new AppFailure({
        code: 'peers.ban-refused',
        message: refusal,
        component: nodeComponent(this.options.nodes.get(nodeId).profile),
        dataRisk: 'none',
        recoveryActions: [{ id: 'choose-address', label: 'Ban a specific address instead' }],
      });
    }
    await this.withNode(nodeId, (client) => client.call('setban', [target, 'add', durationSeconds]));
    this.options.logger.info('Banned an address', { nodeId, target, durationSeconds });
  }

  async unban(nodeId: string, input: string): Promise<void> {
    await this.withNode(nodeId, (client) => client.call('setban', [banTarget(input), 'remove']));
  }

  async clearBans(nodeId: string): Promise<void> {
    await this.withNode(nodeId, (client) => client.call('clearbanned'));
  }

  private record(nodeId: string, peers: readonly PeerSummary[]): void {
    const current = new Map(peers.map((peer) => [peer.id, peer]));
    const previous = this.known.get(nodeId);
    this.known.set(nodeId, current);
    // The first look only sets the baseline; reporting every existing peer as new would be noise.
    if (!previous) return;
    const at = this.now();
    const log = this.events.get(nodeId) ?? [];
    const event = (kind: PeerEvent['kind'], peer: PeerSummary): PeerEvent => ({
      at: at.toISOString(),
      kind,
      peerId: peer.id,
      address: peer.address,
      network: peer.network,
      inbound: peer.inbound,
      ...(peer.connectionType === undefined ? {} : { connectionType: peer.connectionType }),
      ...(kind === 'disconnected'
        ? { durationSeconds: Math.max(0, Math.round(at.getTime() / 1000 - peer.connectedSince)) }
        : {}),
    });
    for (const [id, peer] of previous) if (!current.has(id)) log.push(event('disconnected', peer));
    for (const [id, peer] of current) if (!previous.has(id)) log.push(event('connected', peer));
    this.events.set(nodeId, log.slice(-HISTORY_LIMIT));
  }

  private async refreshRunningNodes(): Promise<void> {
    for (const { profile, status } of this.options.nodes.list()) {
      if (status.state !== 'running') continue;
      try {
        await this.peers(profile.id);
      } catch {
        // The monitor reports node problems; a missed history sample is harmless.
      }
    }
  }

  private async withNode<T>(nodeId: string, action: (client: BitcoinRpcClient) => Promise<T>): Promise<T> {
    const { profile } = this.options.nodes.get(nodeId);
    try {
      return await action(this.options.nodes.rpc(nodeId));
    } catch (error) {
      if (error instanceof AppFailure) throw error;
      if (error instanceof BitcoinRpcError && REFUSALS.has(error.code)) {
        throw new AppFailure({
          code: 'peers.refused',
          message: error.message.replace(/^Error:\s*/, ''),
          component: nodeComponent(profile),
          dataRisk: 'none',
          recoveryActions: [],
        });
      }
      throw new AppFailure(describeNodeError(profile, error));
    }
  }
}
