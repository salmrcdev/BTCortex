import { execFile, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { BitcoinNetwork } from '@btcortex/bitcoin-config';
import { NETWORK_PARAMETERS } from '@btcortex/bitcoin-config';
import { consoleLogPath, networkDirectory, pidFilePath } from './datadir';

// Process lifecycle of a managed bitcoind (docs/research/notes/full-nodes-core.md
// §10). The node runs detached from BTCortex, so closing the application does
// not stop it unless the profile's policy says so, and it is always stopped
// through RPC `stop` so the chainstate is flushed.

const execFileAsync = promisify(execFile);

export interface StartBitcoindOptions {
  bitcoind: string;
  dataDirectory: string;
  network: BitcoinNetwork;
  /** Additional one-shot arguments, for example `-reindex` after explicit confirmation. */
  extraArguments?: readonly string[];
}

export interface StartedProcess {
  pid: number;
  arguments: string[];
  consoleLog: string;
}

export function buildArguments(options: StartBitcoindOptions): string[] {
  // No trailing separator on -datadir: a trailing backslash before a closing quote breaks Windows argument parsing.
  const dataDirectory = options.dataDirectory.replace(/[\\/]+$/, '');
  return [
    `-datadir=${dataDirectory}`,
    // -chain (not -regtest and friends) so that a matching chain= in bitcoin.conf does not count as a second selector.
    `-chain=${NETWORK_PARAMETERS[options.network].chainName}`,
    '-server=1',
    '-printtoconsole=0',
    // BTCortex follows the node through this file; the command line keeps bitcoin.conf from moving it.
    '-pid=bitcoind.pid',
    ...(options.extraArguments ?? []),
  ];
}

export function startBitcoind(options: StartBitcoindOptions): StartedProcess {
  const args = buildArguments(options);
  const consoleLog = consoleLogPath(options.dataDirectory, options.network);
  mkdirSync(networkDirectory(options.dataDirectory, options.network), { recursive: true });
  // The console output goes to a file rather than a pipe: a pipe nobody drains
  // can block the node, and the file survives BTCortex exiting.
  const output = openSync(consoleLog, 'a');
  try {
    const child = spawn(options.bitcoind, args, {
      cwd: dirname(options.bitcoind),
      detached: true,
      windowsHide: true,
      stdio: ['ignore', output, output],
      shell: false,
    });
    // A launch failure (missing file, access denied) arrives later as an 'error' event; without a
    // listener it would crash the orchestrator. The monitor reports the node as not started.
    child.once('error', () => undefined);
    if (child.pid === undefined) throw new Error(`bitcoind could not be started from ${options.bitcoind}.`);
    child.unref();
    return { pid: child.pid, arguments: args, consoleLog };
  } finally {
    closeSync(output);
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The pid bitcoind wrote for this network, if the file exists and the process is alive. */
/**
 * The executable name of a running process, for example `bitcoin-qt.exe`.
 * tasklist's CSV rows start with the quoted image name, which does not depend
 * on the Windows display language.
 */
export async function processImageName(pid: number): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FI', `PID eq ${String(pid)}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      timeout: 15_000,
    });
    return /^"([^"]+)"/.exec(stdout.trim())?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

export function readRunningPid(dataDirectory: string, network: BitcoinNetwork): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(pidFilePath(dataDirectory, network), 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 && isProcessAlive(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

export interface WaitOptions {
  timeoutMs: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

/** Resolves true when the process has exited, false on timeout. */
export async function waitForExit(pid: number, { timeoutMs, intervalMs = 500, signal }: WaitOptions): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    if (signal?.aborted) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return !isProcessAlive(pid);
}

/** Reads the last lines bitcoind wrote to the console, for start-up error reports. */
export function readConsoleTail(dataDirectory: string, network: BitcoinNetwork, maxLines = 20): string[] {
  try {
    const lines = readFileSync(consoleLogPath(dataDirectory, network), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '');
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}
