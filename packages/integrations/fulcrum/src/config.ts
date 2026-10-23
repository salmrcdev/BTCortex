import { isAbsolute } from 'node:path';

// Fulcrum's configuration file, written by BTCortex before every start
// (docs/research/notes/electrum-indexers-explorers.md §3.3). Every listener
// is bound to loopback: Fulcrum's own default for the Electrum port is
// 0.0.0.0, which would expose it to the local network and trigger a firewall
// prompt. Peer discovery and announcements stay off, because they would make
// outbound connections to public servers and advertise this one, and UPnP
// stays off. RPC passwords never go in the file: Fulcrum reads them from the
// RPCUSER and RPCPASSWORD environment variables, and hides them in its stats.

export interface FulcrumPorts {
  /** Plain TCP for Electrum wallets. */
  electrum: number;
  /** Fulcrum's admin JSON-RPC (stop, getinfo); available once the index has caught up. */
  admin: number;
  /** The `/stats` HTTP endpoint, available from start-up. */
  stats: number;
}

export interface FulcrumConfigOptions {
  /** Fulcrum's database folder; ASCII only, see `isFulcrumCompatiblePath`. */
  dataDirectory: string;
  /** The node's RPC interface. */
  bitcoind: { host: string; port: number; tls?: boolean };
  /** The node's cookie file; without it, credentials travel in `fulcrumEnvironment`. */
  cookieFile?: string;
  ports: FulcrumPorts;
  pidFile: string;
  /** RocksDB's memory budget; Fulcrum chooses min(2048 MiB, 25 % of RAM) when omitted. */
  databaseMemoryMiB?: number;
}

export class FulcrumConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FulcrumConfigError';
  }
}

/**
 * Whether Fulcrum can use this path: RocksDB, which stores the index, cannot
 * create folders whose path has characters outside ASCII on Windows (tested
 * with 2.1.4), and `#` starts a comment in the configuration file.
 */
export function isFulcrumCompatiblePath(path: string): boolean {
  return /^[\x20-\x7e]+$/.test(path) && !path.includes('#');
}

function value(name: string, text: string): string {
  if (text !== text.trim() || /[\r\n#]/.test(text) || text === '') {
    throw new FulcrumConfigError(`The value for Fulcrum's "${name}" setting cannot be written to its configuration.`);
  }
  return text;
}

function path(name: string, text: string): string {
  if (!isAbsolute(text)) throw new FulcrumConfigError(`Fulcrum's "${name}" must be an absolute path.`);
  return value(name, text);
}

function port(name: string, number: number): string {
  if (!Number.isInteger(number) || number < 1 || number > 65_535) {
    throw new FulcrumConfigError(`${String(number)} is not a valid port for Fulcrum's "${name}".`);
  }
  return String(number);
}

export function buildFulcrumConfig(options: FulcrumConfigOptions): string {
  if (!isFulcrumCompatiblePath(options.dataDirectory)) {
    throw new FulcrumConfigError(
      `Fulcrum cannot keep its index in ${options.dataDirectory}: the path must use only basic Latin letters, digits and punctuation, without "#".`,
    );
  }
  const lines = [
    '# Managed by BTCortex. It writes this file again before each start, so changes here do not last.',
    `datadir = ${path('datadir', options.dataDirectory)}`,
    `bitcoind = ${value('bitcoind', options.bitcoind.host)}:${port('bitcoind', options.bitcoind.port)}`,
    ...(options.bitcoind.tls ? ['bitcoind_tls = true'] : []),
    ...(options.cookieFile ? [`rpccookie = ${path('rpccookie', options.cookieFile)}`] : []),
    `tcp = 127.0.0.1:${port('tcp', options.ports.electrum)}`,
    `admin = 127.0.0.1:${port('admin', options.ports.admin)}`,
    `stats = 127.0.0.1:${port('stats', options.ports.stats)}`,
    'peering = false',
    'announce = false',
    'upnp = false',
    'ts_format = utc',
    `pidfile = ${path('pidfile', options.pidFile)}`,
  ];
  if (options.databaseMemoryMiB !== undefined) {
    if (!Number.isInteger(options.databaseMemoryMiB) || options.databaseMemoryMiB < 64) {
      throw new FulcrumConfigError(`${String(options.databaseMemoryMiB)} MiB is too little memory for Fulcrum.`);
    }
    lines.push(`db_mem = ${String(options.databaseMemoryMiB)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Environment variables for a node that uses a user name and password instead of a cookie. */
export function fulcrumCredentialsEnvironment(credentials: {
  username: string;
  password: string;
}): Record<string, string> {
  return { RPCUSER: credentials.username, RPCPASSWORD: credentials.password };
}

/**
 * The memory budget BTCortex gives Fulcrum's database: Fulcrum's own default
 * (min(2048 MiB, 25 % of RAM)) on computers with 16 GB or more, and less on
 * smaller ones, where the node's own cache needs the room
 * (docs/research/notes/electrum-indexers-explorers.md §3.7).
 */
export function fulcrumDatabaseMemory(totalMemoryBytes: number): number | undefined {
  const gib = totalMemoryBytes / 1024 ** 3;
  if (gib >= 15.5) return undefined;
  if (gib >= 7.5) return 1024;
  return 512;
}
