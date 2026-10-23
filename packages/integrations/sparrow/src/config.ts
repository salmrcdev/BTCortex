import { randomUUID } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BitcoinNetworkId } from '@btcortex/contracts';

// Safe pre-configuration of Sparrow's connection to a Bitcoin Core node, or
// to the Electrum server BTCortex runs next to it
// (docs/research/notes/wallets-hardware.md §3.3–3.7, §6.2). Only the
// connection keys are written; every other key (wallets, preferences, proxy)
// is preserved. Sparrow rewrites the whole file whenever it changes a setting,
// so this must only run while Sparrow is closed. Sparrow connects to Electrum
// servers on local addresses directly even when it is set to use a proxy
// (ElectrumServer.getTransport), so a server on this computer works with
// Sparrow's Tor setting on.

export type SparrowNetwork = 'mainnet' | 'testnet' | 'testnet4' | 'signet' | 'regtest';

const SPARROW_NETWORKS: Record<BitcoinNetworkId, SparrowNetwork> = {
  mainnet: 'mainnet',
  testnet3: 'testnet',
  testnet4: 'testnet4',
  signet: 'signet',
  regtest: 'regtest',
};

/** Sparrow's per-network subfolder (`Network.getHome()`); mainnet uses the root. */
const NETWORK_FOLDERS: Record<BitcoinNetworkId, string> = {
  mainnet: '',
  testnet3: 'testnet3',
  testnet4: 'testnet4',
  signet: 'signet',
  regtest: 'regtest',
};

/** Marker files created by "Restart in …"; they override the -n flag. */
const NETWORK_MARKERS: { file: string; network: BitcoinNetworkId }[] = [
  { file: 'network-testnet', network: 'testnet3' },
  { file: 'network-testnet4', network: 'testnet4' },
  { file: 'network-signet', network: 'signet' },
];

export function sparrowNetworkArgument(network: BitcoinNetworkId): SparrowNetwork {
  return SPARROW_NETWORKS[network];
}

export function sparrowHome(env: { APPDATA?: string | undefined } = process.env): string {
  if (!env.APPDATA) throw new Error('The APPDATA folder is not known, so Sparrow’s settings cannot be located.');
  return join(env.APPDATA, 'Sparrow');
}

export function sparrowConfigPath(home: string, network: BitcoinNetworkId): string {
  const folder = NETWORK_FOLDERS[network];
  return folder === '' ? join(home, 'config') : join(home, folder, 'config');
}

/** Networks forced by marker files; a non-empty list means `-n mainnet` would be ignored. */
export function activeNetworkMarkers(home: string): BitcoinNetworkId[] {
  return NETWORK_MARKERS.filter((marker) => existsSync(join(home, marker.file))).map((marker) => marker.network);
}

/**
 * Moves the marker files of the given networks aside, so that Sparrow honours
 * the network flag again. The files are renamed rather than deleted, so the
 * user's earlier choice can be restored.
 */
export async function setAsideNetworkMarkers(
  home: string,
  networks: readonly BitcoinNetworkId[],
  now: () => Date = () => new Date(),
): Promise<string[]> {
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const backups: string[] = [];
  for (const marker of NETWORK_MARKERS) {
    const path = join(home, marker.file);
    if (!networks.includes(marker.network) || !existsSync(path)) continue;
    const backup = `${path}.btcortex-${stamp}.bak`;
    await rename(path, backup);
    backups.push(backup);
  }
  return backups;
}

export interface CoreConnectionTarget {
  /** For example `http://127.0.0.1:8332`. */
  rpcEndpoint: string;
  /** The node's root data directory (Sparrow appends the network folder for the cookie). */
  dataDirectory: string;
}

/** The Electrum server BTCortex runs for a node, for example `tcp://127.0.0.1:50001`. */
export interface ElectrumConnectionTarget {
  electrumUrl: string;
}

export type SparrowConnectionTarget = CoreConnectionTarget | ElectrumConnectionTarget;

/** The name Sparrow shows for the server BTCortex sets up. */
export const SPARROW_SERVER_ALIAS = 'BTCortex';

export interface ExistingServer {
  serverType: string;
  server: string | undefined;
}

export interface ConnectionPlan {
  /** Keys BTCortex will write. */
  changes: Record<string, string | boolean>;
  /** Keys BTCortex will remove, such as the certificate of an earlier encrypted server. */
  removals: string[];
  /** Sparrow already uses this node exactly; nothing needs to change. */
  alreadyConfigured: boolean;
  /** A different server the user configured; replacing it needs their explicit consent. */
  conflict: ExistingServer | undefined;
  /** Conditions worth telling the user about. */
  notes: ('proxy-enabled' | 'first-use')[];
}

type SparrowConfig = Record<string, unknown>;

function stringValue(config: SparrowConfig, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' ? value : undefined;
}

/** Strips the optional `|alias` suffix Sparrow stores with server URLs. */
function serverUrl(value: string | undefined): string | undefined {
  return value?.split('|')[0];
}

function sameLocation(a: string | undefined, b: string): boolean {
  return a?.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
}

/** The server the user configured, if it is not the given one. */
function otherServer(
  existing: SparrowConfig,
  isTarget: (serverType: string | undefined) => boolean,
): ExistingServer | undefined {
  const serverType = stringValue(existing, 'serverType');
  if (isTarget(serverType)) return undefined;
  if (serverType === 'BITCOIN_CORE') return { serverType, server: serverUrl(stringValue(existing, 'coreServer')) };
  if (serverType === 'ELECTRUM_SERVER')
    return { serverType, server: serverUrl(stringValue(existing, 'electrumServer')) };
  if (serverType === 'PUBLIC_ELECTRUM_SERVER') {
    return { serverType, server: serverUrl(stringValue(existing, 'publicElectrumServer')) };
  }
  return undefined;
}

function planElectrumConnection(existing: SparrowConfig | undefined, target: ElectrumConnectionTarget): ConnectionPlan {
  const changes: Record<string, string | boolean> = {
    mode: 'ONLINE',
    serverType: 'ELECTRUM_SERVER',
    electrumServer: `${target.electrumUrl}|${SPARROW_SERVER_ALIAS}`,
  };
  if (!existing) return { changes, removals: [], alreadyConfigured: false, conflict: undefined, notes: ['first-use'] };
  const notes: ConnectionPlan['notes'] = existing['useProxy'] === true ? ['proxy-enabled'] : [];
  // A certificate is for an encrypted server; Sparrow refuses to connect when the file named is gone.
  const removals = typeof existing['electrumServerCert'] === 'string' ? ['electrumServerCert'] : [];
  const usesTarget = (serverType: string | undefined) =>
    serverType === 'ELECTRUM_SERVER' && serverUrl(stringValue(existing, 'electrumServer')) === target.electrumUrl;
  const alreadyConfigured =
    usesTarget(stringValue(existing, 'serverType')) &&
    removals.length === 0 &&
    stringValue(existing, 'mode') === 'ONLINE';
  return {
    changes,
    removals,
    alreadyConfigured,
    conflict: alreadyConfigured ? undefined : otherServer(existing, usesTarget),
    notes,
  };
}

export function planSparrowConnection(
  existing: SparrowConfig | undefined,
  target: SparrowConnectionTarget,
): ConnectionPlan {
  if ('electrumUrl' in target) return planElectrumConnection(existing, target);
  const changes: Record<string, string | boolean> = {
    mode: 'ONLINE',
    serverType: 'BITCOIN_CORE',
    coreServer: target.rpcEndpoint,
    coreAuthType: 'COOKIE',
    coreDataDir: target.dataDirectory,
    // The legacy-wallet path needs RPCs Bitcoin Core 30 removed.
    useLegacyCoreWallet: false,
  };
  const notes: ConnectionPlan['notes'] = [];
  if (!existing) return { changes, removals: [], alreadyConfigured: false, conflict: undefined, notes: ['first-use'] };
  if (existing['useProxy'] === true) notes.push('proxy-enabled');

  const serverType = stringValue(existing, 'serverType');
  const coreServer = serverUrl(stringValue(existing, 'coreServer'));
  const alreadyConfigured =
    serverType === 'BITCOIN_CORE' &&
    coreServer === target.rpcEndpoint &&
    stringValue(existing, 'coreAuthType') === 'COOKIE' &&
    sameLocation(stringValue(existing, 'coreDataDir'), target.dataDirectory) &&
    existing['useLegacyCoreWallet'] !== true &&
    stringValue(existing, 'mode') === 'ONLINE';
  if (alreadyConfigured) return { changes, removals: [], alreadyConfigured, conflict: undefined, notes };

  let conflict: ExistingServer | undefined;
  if (serverType === 'BITCOIN_CORE') {
    const sameNode =
      coreServer === target.rpcEndpoint && sameLocation(stringValue(existing, 'coreDataDir'), target.dataDirectory);
    if (!sameNode) conflict = { serverType, server: coreServer };
  } else if (serverType === 'ELECTRUM_SERVER') {
    conflict = { serverType, server: serverUrl(stringValue(existing, 'electrumServer')) };
  } else if (serverType === 'PUBLIC_ELECTRUM_SERVER') {
    conflict = { serverType, server: serverUrl(stringValue(existing, 'publicElectrumServer')) };
  }
  return { changes, removals: [], alreadyConfigured: false, conflict, notes };
}

export async function readSparrowConfig(path: string): Promise<SparrowConfig | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as SparrowConfig)
      : undefined;
  } catch {
    // Sparrow itself replaces an unreadable file with defaults; the original is backed up before writing.
    return undefined;
  }
}

/**
 * Merges the changes into the existing file, keeping every other key, after
 * backing the original up next to it. Written to a temporary file of its own,
 * flushed to disk and renamed, so Sparrow never sees a half-written file and
 * two writes never share a temporary file.
 */
export async function writeSparrowConfig(
  path: string,
  existing: SparrowConfig | undefined,
  changes: Record<string, string | boolean>,
  now: () => Date = () => new Date(),
  removals: readonly string[] = [],
): Promise<{ backup: string | undefined }> {
  await mkdir(dirname(path), { recursive: true });
  let backup: string | undefined;
  if (existsSync(path)) {
    backup = `${path}.btcortex-${now().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.bak`;
    await copyFile(path, backup, constants.COPYFILE_EXCL);
  }
  const merged: SparrowConfig = { ...(existing ?? {}), ...changes };
  for (const key of removals) Reflect.deleteProperty(merged, key);
  const temporary = `${path}.btcortex-${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(merged, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return { backup };
}
