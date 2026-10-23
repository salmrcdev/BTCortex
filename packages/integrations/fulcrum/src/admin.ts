import { lineRpcRequest } from './line-rpc';

// Fulcrum's admin interface (docs/research/notes/electrum-indexers-explorers.md
// §3.5): newline-delimited JSON-RPC 2.0 on a loopback port, without
// authentication, opened together with the Electrum ports once the index has
// caught up with the node. BTCortex uses it for a graceful stop and for the
// figures of a running server; FulcrumAdmin.exe is not needed.

export interface FulcrumInfo {
  /** For example "Fulcrum 2.1.4". */
  version: string;
  /** The node's chain as Fulcrum names it: main, test, testnet4, signet or regtest. */
  chain: string;
  height: number;
  genesisHash: string;
  clients: number;
  /** For example "3.2 hours". */
  uptime: string;
  pid: number;
  /** Resident memory, when reported. */
  memoryBytes?: number;
  subscriptions?: number;
  transactionsSent?: number;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseFulcrumInfo(result: unknown): FulcrumInfo {
  const info = record(result);
  const { version, chain, height, genesis_hash: genesisHash, pid } = info;
  if (
    typeof version !== 'string' ||
    typeof chain !== 'string' ||
    typeof height !== 'number' ||
    typeof genesisHash !== 'string' ||
    typeof pid !== 'number'
  ) {
    throw new Error('Fulcrum answered "getinfo" with an unexpected shape.');
  }
  const memory = optionalNumber(record(info['memory_usage'])['physical_kb']);
  const subscriptions = optionalNumber(info['subscriptions']);
  const transactionsSent = optionalNumber(info['txs_sent']);
  return {
    version,
    chain,
    height,
    genesisHash,
    clients: optionalNumber(info['clients_connected']) ?? 0,
    uptime: typeof info['uptime'] === 'string' ? info['uptime'] : '',
    pid,
    ...(memory === undefined ? {} : { memoryBytes: memory * 1024 }),
    ...(subscriptions === undefined ? {} : { subscriptions }),
    ...(transactionsSent === undefined ? {} : { transactionsSent }),
  };
}

export async function readFulcrumInfo(adminPort: number, timeoutMs = 5_000): Promise<FulcrumInfo> {
  return parseFulcrumInfo(await lineRpcRequest({ port: adminPort, timeoutMs }, 'getinfo'));
}

/** Asks Fulcrum to shut down gracefully; it answers `true` and then exits. */
export async function requestFulcrumStop(adminPort: number, timeoutMs = 5_000): Promise<void> {
  const answer = await lineRpcRequest({ port: adminPort, timeoutMs }, 'stop');
  if (answer !== true) throw new Error('Fulcrum did not accept the stop request.');
}
