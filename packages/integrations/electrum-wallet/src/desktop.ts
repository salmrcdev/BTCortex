import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { BitcoinNetworkId } from '@btcortex/contracts';

// Electrum on this computer (docs/research/notes/wallets-hardware.md §4.2–4.4):
// an installed copy is found through the keys its installer writes; nothing
// is changed in it. Electrum is started with the user's own server on the
// command line (`--oneserver --server`), which applies to that session only,
// is never written to Electrum's settings and locks the server in its
// dialogue, so Electrum's configuration file is never edited.

const execFileAsync = promisify(execFile);

const NETWORK_FLAGS: Record<BitcoinNetworkId, string | undefined> = {
  mainnet: undefined,
  testnet3: '--testnet',
  testnet4: '--testnet4',
  signet: '--signet',
  regtest: '--regtest',
};

/**
 * The arguments that start Electrum on the node's network with only the given
 * server, for example `127.0.0.1:50001:t`, and, for BTCortex's own copy, in a
 * data folder of its own (`--dir`).
 */
export function electrumArguments(network: BitcoinNetworkId, server: string, dataFolder?: string): string[] {
  if (!/^[^\s:]+:\d{1,5}:[ts]$/.test(server)) throw new Error(`"${server}" is not an Electrum server address.`);
  if (dataFolder !== undefined && !isAbsolute(dataFolder)) throw new Error(`"${dataFolder}" is not a full path.`);
  const flag = NETWORK_FLAGS[network];
  return [
    ...(flag ? [flag] : []),
    ...(dataFolder === undefined ? [] : ['--dir', dataFolder]),
    '--oneserver',
    '--server',
    server,
  ];
}

/** Lines of `reg query` output: `    DisplayVersion    REG_SZ    4.7.2`. The value names are not translated, the default value's is. */
export function parseRegistryValues(output: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(.+?)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/.exec(line);
    if (match?.[1] && match[2] !== undefined) values.set(match[1].trim(), match[2].trim());
  }
  return values;
}

async function registryValues(key: string): Promise<Map<string, string>> {
  if (process.platform !== 'win32') return new Map();
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', key], { windowsHide: true, timeout: 10_000 });
    return parseRegistryValues(stdout);
  } catch {
    return new Map();
  }
}

/** The program file in an Electrum installation folder (never the `-debug` one). */
export function electrumExecutableIn(directory: string, version: string | undefined): string | undefined {
  const named = version ? join(directory, `electrum-${version}.exe`) : undefined;
  if (named && existsSync(named)) return named;
  try {
    const found = readdirSync(directory).find((name) => /^electrum-[\d.]+\.exe$/i.test(name));
    return found ? join(directory, found) : undefined;
  } catch {
    return undefined;
  }
}

export interface InstalledElectrum {
  version: string | null;
  directory: string;
  executable: string;
}

/** An Electrum installed with its own installer, for this user or for everyone. */
export async function findInstalledElectrumApplication(): Promise<InstalledElectrum | undefined> {
  const uninstallKeys = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Electrum',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Electrum',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Electrum',
  ];
  for (const key of uninstallKeys) {
    const values = await registryValues(key);
    const uninstaller = values.get('UninstallString');
    if (!uninstaller) continue;
    const directory = dirname(uninstaller.replace(/^"|"$/g, ''));
    const version = values.get('DisplayVersion') ?? null;
    const executable = electrumExecutableIn(directory, version ?? undefined);
    if (executable) return { version, directory, executable };
  }
  return undefined;
}

/** Electrum's own data folder for this Windows user, where its wallets live. */
export function electrumDataFolder(env: { APPDATA?: string | undefined } = process.env): string | undefined {
  return env.APPDATA ? join(env.APPDATA, 'Electrum') : undefined;
}

/** Whether any Electrum runs; tasklist's CSV rows start with the quoted image name. */
export async function isElectrumRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const { stdout } = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 15_000 });
  return stdout.split(/\r?\n/).some((line) => /^"electrum[^"]*\.exe"/i.test(line));
}

/** Starts Electrum detached from BTCortex: it is the user's application. */
export function launchElectrum(executable: string, args: readonly string[]): number {
  const child = spawn(executable, [...args], {
    cwd: dirname(executable),
    detached: true,
    stdio: 'ignore',
    shell: false,
  });
  if (child.pid === undefined) throw new Error(`Electrum could not be started from ${executable}.`);
  child.unref();
  return child.pid;
}
