import { basename, dirname, join, parse, relative, resolve } from 'node:path';
import {
  BitcoinConfig,
  CHAIN_SIZE_ESTIMATES,
  effectiveScalar,
  INDEX_SIZE_RATIOS,
  interpretBoolean,
  resolveEffective,
} from '@btcortex/bitcoin-config';
import type { BitcoinNetwork } from '@btcortex/bitcoin-config';
import { endpointParts, isLoopbackHost } from '@btcortex/contracts';
import type {
  BitcoinNetworkId,
  ElectrumConnection,
  ElectrumUnavailableReason,
  NodeProfile,
  NodeWithStatus,
} from '@btcortex/contracts';

// The pure parts of running an Electrum server for a node: whether the node
// can have one, where its index goes by default, how much room it needs, and
// which node settings it relies on (docs/research/notes/electrum-indexers-explorers.md
// §3.2 and §3.7).

const MIN_INDEX_BYTES = 512 * 1024 * 1024;
/** Room to keep free on the volume beyond the estimate. */
export const SPACE_HEADROOM = 0.2;

/** The usual Electrum ports for mainnet and testnet, and BTCortex's choices for the other networks. */
export const DEFAULT_ELECTRUM_PORTS: Record<BitcoinNetworkId, number> = {
  mainnet: 50001,
  testnet3: 60001,
  testnet4: 40001,
  signet: 60601,
  regtest: 60401,
};
export const ELECTRUM_FALLBACK_PORTS: readonly [number, number] = [50011, 50099];
export const ADMIN_PORTS: readonly [number, number] = [50100, 50149];
export const STATS_PORTS: readonly [number, number] = [50150, 50199];
/** Bitcoin Core's documentation uses 28332 for block notifications. */
export const DEFAULT_ZMQ_PORTS: Record<BitcoinNetworkId, number> = {
  mainnet: 28332,
  testnet3: 28342,
  testnet4: 28352,
  signet: 28362,
  regtest: 28372,
};
export const ZMQ_FALLBACK_PORTS: readonly [number, number] = [28400, 28499];

/** Why the node cannot have an Electrum server on this computer, if it cannot. */
export function unavailableReason(node: NodeWithStatus): ElectrumUnavailableReason | undefined {
  const { profile } = node;
  if (profile.implementation !== 'bitcoin-core') return 'implementation';
  if (!isLoopbackHost(endpointParts(profile.rpcEndpoint).hostname)) return 'remote';
  const snapshot = node.status.snapshot;
  if (!snapshot) return 'node-unknown';
  if (snapshot.blockchain.pruned) return 'pruned';
  return undefined;
}

/**
 * Where the index goes unless the user chooses otherwise: next to the data
 * directory of a node BTCortex set up (so on the disk chosen for the node),
 * otherwise in BTCortex's own folder.
 */
export function defaultIndexDirectory(profile: NodeProfile, electrumHome: string): string {
  if (profile.execution === 'managed' && profile.dataDirectory) {
    const name = basename(profile.dataDirectory) || 'node';
    return join(dirname(profile.dataDirectory), `${name}-electrum`);
  }
  return join(electrumHome, profile.id, 'index');
}

/**
 * The block files a node will hold once synchronised: what it holds now, or
 * the network's expected size while it is still catching up.
 */
export function expectedBlockFileBytes(node: NodeWithStatus): number {
  const blockchain = node.status.snapshot?.blockchain;
  const now = blockchain?.sizeOnDiskBytes ?? 0;
  return blockchain?.initialBlockDownload === false
    ? now
    : Math.max(now, CHAIN_SIZE_ESTIMATES[node.profile.network].blocksBytes);
}

/** Estimated size of Fulcrum's index for a node whose block files take `blockFileBytes` (an estimate). */
export function estimateIndexBytes(blockFileBytes: number): number {
  return Math.max(MIN_INDEX_BYTES, Math.round(blockFileBytes * INDEX_SIZE_RATIOS.electrumIndex));
}

/** Estimated size of Bitcoin Core's transaction index (an estimate). */
export function estimateTransactionIndexBytes(blockFileBytes: number): number {
  return Math.round(blockFileBytes * INDEX_SIZE_RATIOS.transactionIndex);
}

/** True when `inner` is `outer` or lies inside it (case-insensitively, as on Windows). */
export function isWithin(inner: string, outer: string): boolean {
  const path = relative(resolve(outer).toLowerCase(), resolve(inner).toLowerCase());
  return path === '' || (!path.startsWith('..') && parse(path).root === '');
}

export interface NodeElectrumSettings {
  transactionIndex: boolean;
  /** The block-notification endpoint, if the node publishes one. */
  blockNotifications: string | undefined;
}

/** What the node's bitcoin.conf says about the settings Fulcrum relies on. */
export function nodeElectrumSettings(text: string, network: BitcoinNetwork): NodeElectrumSettings {
  const effective = resolveEffective(BitcoinConfig.parse(text), network);
  const txindex = effectiveScalar(effective, 'txindex');
  const notifications = effective.get('zmqpubhashblock');
  return {
    transactionIndex: txindex !== undefined && !effective.get('txindex')?.negated && interpretBoolean(txindex),
    blockNotifications: notifications?.negated ? undefined : effectiveScalar(effective, 'zmqpubhashblock'),
  };
}

export function connectionFor(port: number): ElectrumConnection {
  return {
    host: '127.0.0.1',
    port,
    protocol: 'tcp',
    server: `127.0.0.1:${String(port)}:t`,
    url: `tcp://127.0.0.1:${String(port)}`,
  };
}

/** The node's RPC interface as host and port, the form Fulcrum wants. */
export function bitcoindAddress(profile: NodeProfile): { host: string; port: number; tls: boolean } {
  const url = new URL(profile.rpcEndpoint);
  const tls = url.protocol === 'https:';
  const port = url.port === '' ? (tls ? 443 : 80) : Number(url.port);
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port, tls };
}

/** What Fulcrum's last lines say about why it stopped. */
export function likelyCause(lines: readonly string[]): string {
  const text = lines.join('\n');
  if (/txindex/i.test(text)) return 'The node’s transaction index is not available to Fulcrum.';
  if (/(listen|bind)[^\n]*(fail|error|could not|unable|in use)|address already in use/i.test(text)) {
    return 'Another program already uses one of the Electrum server’s ports.';
  }
  if (/no space left|not enough (disk )?space|disk full/i.test(text)) return 'The disk with the index is full.';
  if (/corrupt/i.test(text)) return 'Fulcrum found its index damaged.';
  if (/Error opening fulc2_db|IO error|Permission denied|Access is denied/i.test(text)) {
    return 'Fulcrum could not open the folder that holds its index.';
  }
  if (/(bitcoind|BitcoinD)[^\n]*(refused|auth|401|lost|unable)/i.test(text)) {
    return 'Fulcrum could not talk to the node.';
  }
  return 'Fulcrum stopped without saying why; its last lines are attached.';
}
