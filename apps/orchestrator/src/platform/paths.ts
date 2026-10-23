import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DATA_FOLDER_NAME, DEV_DATA_FOLDER_NAME } from '@btcortex/contracts';

/**
 * Directories owned by BTCortex. Nodes created by BTCortex get their own data
 * directory under `nodes`; existing nodes keep theirs wherever the operator
 * put them, and BTCortex never moves or deletes blockchain data implicitly.
 */
export interface AppPaths {
  root: string;
  logs: string;
  database: string;
  downloads: string;
  /** Verified, versioned runtimes, for example `installations/bitcoin-core/31.1`. */
  installations: string;
  /** Data directories of nodes created by BTCortex. */
  nodes: string;
  /** Files BTCortex writes for the user to keep or share, such as diagnostic bundles. */
  exports: string;
  temporary: string;
}

export interface PathEnvironment {
  /** Explicit override, used for portable mode and tests. */
  BTCORTEX_DATA_DIR?: string | undefined;
  /** Set to "1" by development builds so that test data never mixes with real data. */
  BTCORTEX_DEVELOPMENT?: string | undefined;
  LOCALAPPDATA?: string | undefined;
  XDG_DATA_HOME?: string | undefined;
}

export function isDevelopmentMode(env: PathEnvironment = process.env): boolean {
  return env.BTCORTEX_DEVELOPMENT === '1';
}

export function resolveAppPaths(
  env: PathEnvironment = process.env,
  platform: NodeJS.Platform = process.platform,
): AppPaths {
  const folder = isDevelopmentMode(env) ? DEV_DATA_FOLDER_NAME : DATA_FOLDER_NAME;
  let root: string;
  if (env.BTCORTEX_DATA_DIR) {
    root = resolve(env.BTCORTEX_DATA_DIR);
  } else if (platform === 'win32') {
    root = join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), folder);
  } else {
    root = join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), folder);
  }
  return {
    root,
    logs: join(root, 'logs'),
    database: join(root, 'btcortex.db'),
    downloads: join(root, 'downloads'),
    installations: join(root, 'installations'),
    nodes: join(root, 'nodes'),
    exports: join(root, 'exports'),
    temporary: join(root, 'tmp'),
  };
}

export function ensureAppDirectories(paths: AppPaths): void {
  for (const directory of [
    paths.root,
    paths.logs,
    paths.downloads,
    paths.installations,
    paths.nodes,
    paths.exports,
    paths.temporary,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
}

export function bitcoinCoreRuntimes(paths: AppPaths): string {
  return join(paths.installations, 'bitcoin-core');
}

/** Bitcoin Knots runtimes, kept apart from Bitcoin Core's: the two follow different chains. */
export function bitcoinKnotsRuntimes(paths: AppPaths): string {
  return join(paths.installations, 'bitcoin-knots');
}

/** Where the Electrum copy BTCortex installed keeps its wallets; BTCortex's backups do not include them. */
export function electrumWalletsFolder(paths: Pick<AppPaths, 'root'>): string {
  return join(paths.root, 'electrum-wallets');
}
