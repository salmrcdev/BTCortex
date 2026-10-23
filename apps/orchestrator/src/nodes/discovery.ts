import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import {
  BITCOIN_NETWORKS,
  BitcoinConfig,
  effectiveScalar,
  interpretBoolean,
  resolveEffective,
} from '@btcortex/bitcoin-config';
import { DiscoveredNodeSchema } from '@btcortex/contracts';
import type { DiscoveredNode, NodeProfile } from '@btcortex/contracts';
import {
  configFilePath,
  cookieFilePath,
  defaultRpcEndpoint,
  detectExistingInstallations,
  networkDirectory,
  processImageName,
  readRunningPid,
} from '@btcortex/integration-bitcoin-core';
import type { DetectionEnvironment } from '@btcortex/integration-bitcoin-core';
import { localDataDirectory } from './local-files';

// Zero-touch connection to Bitcoin Core that is already on this computer
// (specification sections 5.1 and 25). Everything BTCortex needs — the RPC
// port, the cookie, whether RPC is on at all — is read from the data
// directory, its bitcoin.conf and settings.json, which are never modified.

export interface DiscoveredConnection extends DiscoveredNode {
  cookieFile: string;
}

export interface DiscoveryOptions {
  env?: DetectionEnvironment;
  /** Injected in tests; defaults to looking the process up with tasklist. */
  imageName?: (pid: number) => Promise<string | undefined>;
}

function samePath(a: string | undefined, b: string): boolean {
  return a !== undefined && resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function asSwitch(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return interpretBoolean(value);
  return undefined;
}

/**
 * Whether RPC is on. Precedence follows Bitcoin Core: settings.json (written
 * by the window's options) beats bitcoin.conf, and without either, bitcoind
 * serves RPC while bitcoin-qt does not.
 */
function rpcServerState(
  settings: Record<string, unknown> | undefined,
  configured: string | undefined,
  program: DiscoveredNode['program'],
): DiscoveredNode['rpcServer'] {
  const fromSettings = asSwitch(settings?.['server']);
  if (fromSettings !== undefined) return fromSettings ? 'on' : 'off';
  if (configured !== undefined) return interpretBoolean(configured) ? 'on' : 'off';
  if (program === 'bitcoind') return 'on';
  if (program === 'bitcoin-qt') return 'off';
  return 'unknown';
}

export async function discoverLocalNodes(
  registered: readonly NodeProfile[],
  options: DiscoveryOptions = {},
): Promise<DiscoveredConnection[]> {
  const imageName = options.imageName ?? processImageName;
  const report = await detectExistingInstallations(options.env);
  const found: DiscoveredConnection[] = [];

  for (const directory of report.dataDirectories) {
    let config = BitcoinConfig.empty();
    try {
      config = BitcoinConfig.parse(await readFile(configFilePath(directory.path), 'utf8'));
    } catch {
      // No bitcoin.conf: Bitcoin Core's defaults apply.
    }
    for (const network of BITCOIN_NETWORKS) {
      const pid = readRunningPid(directory.path, network);
      const hasChainData = directory.networksWithChainData.includes(network);
      if (pid === undefined && !hasChainData) continue;

      const effective = resolveEffective(config, network);
      const port = Number.parseInt(effectiveScalar(effective, 'rpcport') ?? '', 10);
      const customCookie = effectiveScalar(effective, 'rpccookiefile');
      const cookieFile =
        customCookie === undefined || customCookie === ''
          ? cookieFilePath(directory.path, network)
          : isAbsolute(customCookie)
            ? customCookie
            : join(networkDirectory(directory.path, network), customCookie);
      const image = pid === undefined ? undefined : await imageName(pid);
      const program: DiscoveredNode['program'] =
        image === 'bitcoind.exe' ? 'bitcoind' : image === 'bitcoin-qt.exe' ? 'bitcoin-qt' : 'unknown';
      const settings = await readJson(join(networkDirectory(directory.path, network), 'settings.json'));
      const registeredAs = registered.find(
        (profile) =>
          profile.network === network &&
          (samePath(localDataDirectory(profile), directory.path) ||
            (profile.authentication.kind === 'cookie' && samePath(profile.authentication.cookieFile, cookieFile))),
      )?.id;

      found.push({
        dataDirectory: directory.path,
        network,
        source: directory.source,
        running: pid !== undefined,
        hasChainData,
        walletFiles: directory.walletFiles,
        program,
        rpcServer: rpcServerState(settings, effectiveScalar(effective, 'server'), program),
        rpcEndpoint: defaultRpcEndpoint(
          network,
          Number.isInteger(port) && port > 0 && port < 65_536 ? port : undefined,
        ),
        authentication: effectiveScalar(effective, 'rpcpassword') === undefined ? 'cookie' : 'password-in-config',
        ...(registeredAs === undefined ? {} : { registeredAs }),
        cookieFile,
      });
    }
  }
  return found;
}

/**
 * The RPC user name and password set in a node's bitcoin.conf, read only when
 * the user agreed to connect with them. They never reach the interface.
 */
export async function readConfiguredPassword(
  dataDirectory: string,
  network: DiscoveredNode['network'],
): Promise<{ username: string; password: string } | undefined> {
  let config;
  try {
    config = BitcoinConfig.parse(await readFile(configFilePath(dataDirectory), 'utf8'));
  } catch {
    return undefined;
  }
  const effective = resolveEffective(config, network);
  const password = effectiveScalar(effective, 'rpcpassword');
  return password === undefined ? undefined : { username: effectiveScalar(effective, 'rpcuser') ?? '', password };
}

/** What the interface may see: the contract's fields only, so the cookie's location stays here. */
export function publicView(connection: DiscoveredConnection): DiscoveredNode {
  return DiscoveredNodeSchema.parse(connection);
}
