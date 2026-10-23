import { createHash } from 'node:crypto';
import type { Socket } from 'node:net';
import { LineRpcConnection } from './line-rpc';

// A health probe for any Electrum server over plain TCP
// (docs/research/notes/electrum-indexers-explorers.md §14): `server.version`
// first (mandatory from protocol 1.6, once per connection), then the
// server's features and the current chain tip. The genesis hash tells which
// chain the server follows, so a server on the wrong network is noticed.

export const ELECTRUM_CLIENT_NAME = 'BTCortex';
/** The protocol range BTCortex speaks; Fulcrum 2.1 offers 1.4 to 1.6. */
export const ELECTRUM_PROTOCOL_RANGE = ['1.4', '1.6'] as const;

export interface ElectrumProbe {
  /** For example "Fulcrum 2.1.4". */
  serverVersion: string;
  /** The negotiated protocol version. */
  protocolVersion: string;
  genesisHash: string | null;
  height: number;
  /** The block asked for with `blockAt`, when one was. */
  block?: { height: number; hash: string };
}

export interface ElectrumProbeOptions {
  port: number;
  host?: string;
  timeoutMs?: number;
  /** A connection the caller made — over TLS or through Tor — instead of plain TCP. */
  socket?: () => Promise<Socket>;
  /** Also read the hash of the block at this height, chosen once the server's tip is known. */
  blockAt?: (serverHeight: number) => number | undefined;
}

/** A block's hash from its 80-byte header: double SHA-256, shown byte-reversed. */
export function blockHashOfHeader(headerHex: string): string {
  const header = Buffer.from(headerHex, 'hex');
  if (header.length !== 80) throw new Error('A block header is 80 bytes long.');
  const once = createHash('sha256').update(header).digest();
  return Buffer.from(createHash('sha256').update(once).digest()).reverse().toString('hex');
}

export async function probeElectrumServer(options: ElectrumProbeOptions): Promise<ElectrumProbe> {
  const connection = await LineRpcConnection.open({
    port: options.port,
    host: options.host ?? '127.0.0.1',
    timeoutMs: options.timeoutMs ?? 10_000,
    ...(options.socket ? { socket: options.socket } : {}),
  });
  try {
    const version = await connection.request('server.version', [ELECTRUM_CLIENT_NAME, [...ELECTRUM_PROTOCOL_RANGE]]);
    if (!Array.isArray(version) || typeof version[0] !== 'string' || typeof version[1] !== 'string') {
      throw new Error('The server answered "server.version" with an unexpected shape.');
    }
    const features = await connection.request<{ genesis_hash?: unknown } | null>('server.features');
    const tip = await connection.request<{ height?: unknown } | null>('blockchain.headers.subscribe');
    if (typeof tip?.height !== 'number') {
      throw new Error('The server answered "blockchain.headers.subscribe" without a height.');
    }
    const at = options.blockAt?.(tip.height);
    let block: ElectrumProbe['block'];
    if (at !== undefined) {
      const header = await connection.request('blockchain.block.header', [at]);
      if (typeof header !== 'string')
        throw new Error('The server answered "blockchain.block.header" without a header.');
      block = { height: at, hash: blockHashOfHeader(header) };
    }
    return {
      serverVersion: version[0],
      protocolVersion: version[1],
      genesisHash: typeof features?.genesis_hash === 'string' ? features.genesis_hash : null,
      height: tip.height,
      ...(block ? { block } : {}),
    };
  } finally {
    connection.close();
  }
}

export interface ScripthashSummary {
  balance: { confirmedSats: number; unconfirmedSats: number };
  /** Oldest first, as the server lists it; unconfirmed entries have height 0 or -1. */
  history: { txid: string; height: number; feeSats?: number }[];
  unspent: { txid: string; vout: number; valueSats: number; height: number }[];
}

const TXID = /^[0-9a-f]{64}$/;

function historyEntry(value: unknown): ScripthashSummary['history'][number] | undefined {
  const entry = value as { tx_hash?: unknown; height?: unknown; fee?: unknown } | null;
  if (typeof entry?.tx_hash !== 'string' || !TXID.test(entry.tx_hash) || typeof entry.height !== 'number') {
    return undefined;
  }
  return {
    txid: entry.tx_hash,
    height: entry.height,
    ...(typeof entry.fee === 'number' ? { feeSats: entry.fee } : {}),
  };
}

function unspentEntry(value: unknown): ScripthashSummary['unspent'][number] | undefined {
  const entry = value as { tx_hash?: unknown; tx_pos?: unknown; value?: unknown; height?: unknown } | null;
  if (
    typeof entry?.tx_hash !== 'string' ||
    !TXID.test(entry.tx_hash) ||
    typeof entry.tx_pos !== 'number' ||
    typeof entry.value !== 'number' ||
    typeof entry.height !== 'number'
  ) {
    return undefined;
  }
  return { txid: entry.tx_hash, vout: entry.tx_pos, valueSats: entry.value, height: entry.height };
}

/** A script's balance, history and unspent coins from an Electrum server (protocol 1.4). */
export async function readScripthash(
  options: ElectrumProbeOptions & { scripthash: string },
): Promise<ScripthashSummary> {
  if (!/^[0-9a-f]{64}$/.test(options.scripthash)) throw new Error('The script hash is malformed.');
  const connection = await LineRpcConnection.open({
    port: options.port,
    host: options.host ?? '127.0.0.1',
    timeoutMs: options.timeoutMs ?? 30_000,
    ...(options.socket ? { socket: options.socket } : {}),
  });
  try {
    await connection.request('server.version', [ELECTRUM_CLIENT_NAME, [...ELECTRUM_PROTOCOL_RANGE]]);
    const balance = await connection.request<{ confirmed?: unknown; unconfirmed?: unknown } | null>(
      'blockchain.scripthash.get_balance',
      [options.scripthash],
    );
    const history = await connection.request('blockchain.scripthash.get_history', [options.scripthash]);
    const unspent = await connection.request('blockchain.scripthash.listunspent', [options.scripthash]);
    return {
      balance: {
        confirmedSats: typeof balance?.confirmed === 'number' ? balance.confirmed : 0,
        unconfirmedSats: typeof balance?.unconfirmed === 'number' ? balance.unconfirmed : 0,
      },
      history: (Array.isArray(history) ? history : []).flatMap((entry) => historyEntry(entry) ?? []),
      unspent: (Array.isArray(unspent) ? unspent : []).flatMap((entry) => unspentEntry(entry) ?? []),
    };
  } finally {
    connection.close();
  }
}
