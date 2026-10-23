import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { LndNetwork } from './api';
import { formatRestAddress, parseRestAddress } from './rest';

// An LND already installed on this computer (docs/research/notes/lightning.md,
// section 2.2), found where LND keeps its files on Windows: %LOCALAPPDATA%\Lnd,
// with lnd.conf, tls.cert and data\chain\bitcoin\<network>\*.macaroon. Only
// read: BTCortex never changes another program's configuration here.

/**
 * lnd.conf is an INI file whose keys carry their own namespace
 * (`bitcoin.mainnet=true` under `[Bitcoin]`), so sections only group them.
 * Comments start with `;` or `#`; keys may repeat (`restlisten`).
 */
export function parseLndConfig(text: string): Map<string, string[]> {
  const config = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    const equals = trimmed.indexOf('=');
    const key = (equals < 0 ? trimmed : trimmed.slice(0, equals)).trim().toLowerCase();
    const value = equals < 0 ? 'true' : trimmed.slice(equals + 1).trim();
    config.set(key, [...(config.get(key) ?? []), value]);
  }
  return config;
}

export function configFlag(config: Map<string, string[]>, key: string): boolean | undefined {
  const value = config.get(key)?.at(-1)?.toLowerCase();
  if (value === undefined) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return undefined;
}

/** As LND does: `~` is the home folder and `$NAME` or `${NAME}` an environment variable. */
export function expandLndPath(path: string, base: string, env: NodeJS.ProcessEnv = process.env): string {
  const expanded = path
    .replace(/^~(?=$|[\\/])/, homedir())
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced?: string, bare?: string) => {
      return env[braced ?? bare ?? ''] ?? '';
    });
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
}

const NETWORKS: readonly LndNetwork[] = ['mainnet', 'testnet', 'testnet4', 'signet', 'regtest', 'simnet'];
export type MacaroonKind = 'admin' | 'readonly' | 'invoice';
const MACAROON_KINDS: readonly MacaroonKind[] = ['readonly', 'invoice', 'admin'];

/** Where REST listens, as an address to connect to: a wildcard listener is reached on this computer. */
export function restAddressToConnect(listen: string): string {
  const endpoint = parseRestAddress(listen.startsWith(':') ? `0.0.0.0${listen}` : listen);
  const wildcard = endpoint.host === '0.0.0.0' || endpoint.host === '::';
  return formatRestAddress(wildcard ? { host: '127.0.0.1', port: endpoint.port } : endpoint);
}

export interface LocalLnd {
  lndDirectory: string;
  configFile: string | null;
  /** From lnd.conf, or the only network LND has data for. */
  network: LndNetwork | null;
  /** Networks LND has data for. */
  networks: LndNetwork[];
  /** Null when lnd.conf switches REST off. */
  restAddress: string | null;
  tlsCertificatePath: string;
  tlsCertificateFound: boolean;
  /** For `network`, the macaroons that exist, the least powerful first. */
  macaroons: { kind: MacaroonKind; path: string }[];
}

export interface FindLocalLndOptions {
  env?: NodeJS.ProcessEnv;
  /** For tests. */
  exists?: (path: string) => boolean;
  read?: (path: string) => string;
}

export function defaultLndDirectory(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const base = env['LOCALAPPDATA'] ?? env['APPDATA'];
  return base === undefined ? undefined : join(base, 'Lnd');
}

export function findLocalLnd(options: FindLocalLndOptions = {}): LocalLnd | undefined {
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const read = options.read ?? ((path: string) => readFileSync(path, 'utf8'));
  const lndDirectory = defaultLndDirectory(env);
  if (lndDirectory === undefined || !exists(lndDirectory)) return undefined;

  const configPath = join(lndDirectory, 'lnd.conf');
  let config = new Map<string, string[]>();
  let configFile: string | null = null;
  if (exists(configPath)) {
    try {
      config = parseLndConfig(read(configPath));
      configFile = configPath;
    } catch {
      // Unreadable: LND's defaults apply as far as BTCortex can tell.
    }
  }
  const setting = (key: string) => config.get(key)?.at(-1);
  const path = (key: string, fallback: string) => {
    const value = setting(key);
    return value === undefined || value === '' ? fallback : expandLndPath(value, lndDirectory, env);
  };

  const dataDirectory = path('datadir', join(lndDirectory, 'data'));
  const chainDirectory = join(dataDirectory, 'chain', 'bitcoin');
  const networks = NETWORKS.filter((network) => exists(join(chainDirectory, network)));
  const configured = NETWORKS.filter((network) => configFlag(config, `bitcoin.${network}`) === true);
  const network =
    configured.length === 1 ? (configured[0] ?? null) : networks.length === 1 ? (networks[0] ?? null) : null;

  let restAddress: string | null = null;
  if (configFlag(config, 'norest') !== true) {
    try {
      restAddress = restAddressToConnect(setting('restlisten') ?? 'localhost:8080');
    } catch {
      restAddress = null;
    }
  }

  const tlsCertificatePath = path('tlscertpath', join(lndDirectory, 'tls.cert'));
  const macaroons =
    network === null
      ? []
      : MACAROON_KINDS.map((kind) => ({
          kind,
          path: path(`${kind}macaroonpath`, join(chainDirectory, network, `${kind}.macaroon`)),
        })).filter((macaroon) => exists(macaroon.path));

  return {
    lndDirectory,
    configFile,
    network,
    networks,
    restAddress,
    tlsCertificatePath,
    tlsCertificateFound: exists(tlsCertificatePath),
    macaroons,
  };
}
