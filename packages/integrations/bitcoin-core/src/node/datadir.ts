import { join } from 'node:path';
import type { BitcoinNetwork } from '@btcortex/bitcoin-config';
import { NETWORK_PARAMETERS } from '@btcortex/bitcoin-config';

// File locations inside a Bitcoin Core data directory
// (docs/research/notes/full-nodes-core.md §5.2, §5.3). Everything except
// bitcoin.conf lives in the network subdirectory.

export function networkDirectory(dataDirectory: string, network: BitcoinNetwork): string {
  const subdirectory = NETWORK_PARAMETERS[network].subdirectory;
  return subdirectory === '' ? dataDirectory : join(dataDirectory, subdirectory);
}

export function configFilePath(dataDirectory: string): string {
  return join(dataDirectory, 'bitcoin.conf');
}

export function cookieFilePath(dataDirectory: string, network: BitcoinNetwork): string {
  return join(networkDirectory(dataDirectory, network), '.cookie');
}

export function pidFilePath(dataDirectory: string, network: BitcoinNetwork): string {
  return join(networkDirectory(dataDirectory, network), 'bitcoind.pid');
}

export function debugLogPath(dataDirectory: string, network: BitcoinNetwork): string {
  return join(networkDirectory(dataDirectory, network), 'debug.log');
}

/** Early start-up errors go to the console; BTCortex keeps them in this file. */
export function consoleLogPath(dataDirectory: string, network: BitcoinNetwork): string {
  return join(networkDirectory(dataDirectory, network), 'btcortex-console.log');
}

export function defaultRpcEndpoint(network: BitcoinNetwork, port = NETWORK_PARAMETERS[network].rpcPort): string {
  return `http://127.0.0.1:${port}`;
}
