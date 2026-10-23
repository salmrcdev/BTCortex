import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BITCOIN_NETWORKS } from '@btcortex/bitcoin-config';
import type { BitcoinNetwork } from '@btcortex/bitcoin-config';
import type { DetectionReport } from '@btcortex/contracts';
import { configFilePath, networkDirectory } from './datadir';
import { readRunningPid } from './process';

// Read-only discovery of existing Bitcoin Core and Knots installations
// (docs/research/notes/full-nodes-core.md §5.9). Nothing is created, written,
// locked or started: findings only feed the set-up plan.

const execFileAsync = promisify(execFile);

export interface DetectionEnvironment {
  APPDATA?: string | undefined;
  LOCALAPPDATA?: string | undefined;
  ProgramFiles?: string | undefined;
}

/** Reads one registry value with reg.exe; undefined when absent. */
export async function readRegistryValue(key: string, value: string): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', value], {
      windowsHide: true,
      timeout: 10_000,
    });
    const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().startsWith(value));
    const match = line ? /REG_(?:SZ|EXPAND_SZ)\s+(.*)$/.exec(line.trim()) : null;
    const found = match?.[1]?.trim();
    return found === '' ? undefined : found;
  } catch {
    return undefined;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function countWalletFiles(directory: string): number {
  const walletsDirectory = join(directory, 'wallets');
  let count = existsSync(join(directory, 'wallet.dat')) ? 1 : 0;
  if (!isDirectory(walletsDirectory)) return count;
  if (existsSync(join(walletsDirectory, 'wallet.dat'))) count += 1;
  for (const entry of readdirSync(walletsDirectory, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(walletsDirectory, entry.name, 'wallet.dat'))) count += 1;
  }
  return count;
}

export function inspectDataDirectory(path: string): {
  hasConfigFile: boolean;
  networksWithChainData: BitcoinNetwork[];
  walletFiles: number;
  nodeRunning: boolean;
} {
  const networksWithChainData: BitcoinNetwork[] = [];
  let walletFiles = 0;
  let nodeRunning = false;
  for (const network of BITCOIN_NETWORKS) {
    const directory = networkDirectory(path, network);
    if (isDirectory(join(directory, 'blocks')) || isDirectory(join(directory, 'chainstate')))
      networksWithChainData.push(network);
    walletFiles += countWalletFiles(directory);
    if (readRunningPid(path, network) !== undefined) nodeRunning = true;
  }
  return { hasConfigFile: existsSync(configFilePath(path)), networksWithChainData, walletFiles, nodeRunning };
}

export async function detectExistingInstallations(env: DetectionEnvironment = process.env): Promise<DetectionReport> {
  const candidates: { path: string; source: DetectionReport['dataDirectories'][number]['source'] }[] = [];
  if (env.APPDATA) candidates.push({ path: join(env.APPDATA, 'Bitcoin'), source: 'roaming-app-data' });
  if (env.LOCALAPPDATA) candidates.push({ path: join(env.LOCALAPPDATA, 'Bitcoin'), source: 'local-app-data' });
  const custom = await readRegistryValue('HKCU\\Software\\Bitcoin\\Bitcoin-Qt', 'strDataDir');
  if (custom) candidates.push({ path: custom, source: 'registry' });

  const seen = new Set<string>();
  const dataDirectories: DetectionReport['dataDirectories'] = [];
  for (const candidate of candidates) {
    const key = candidate.path.toLowerCase();
    if (seen.has(key) || !isDirectory(candidate.path)) continue;
    seen.add(key);
    dataDirectories.push({ path: candidate.path, source: candidate.source, ...inspectDataDirectory(candidate.path) });
  }

  const installations: DetectionReport['installations'] = [];
  for (const product of ['Bitcoin Core', 'Bitcoin Knots'] as const) {
    const path = await readRegistryValue(`HKCU\\SOFTWARE\\${product}`, 'Path');
    if (!path) continue;
    const version = await readRegistryValue(
      `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${product}`,
      'DisplayVersion',
    );
    installations.push({ path, product, source: 'registry', ...(version ? { version } : {}) });
  }
  if (env.ProgramFiles) {
    const programFiles = join(env.ProgramFiles, 'Bitcoin');
    const daemon = join(programFiles, 'daemon', 'bitcoind.exe');
    if (
      existsSync(daemon) &&
      !installations.some((installation) => installation.path.toLowerCase() === programFiles.toLowerCase())
    ) {
      installations.push({ path: programFiles, product: 'unknown', source: 'program-files' });
    }
  }

  return { dataDirectories, installations };
}
