import { execFile, spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { BitcoinNetworkId } from '@btcortex/contracts';
import { sparrowNetworkArgument } from './config';

const execFileAsync = promisify(execFile);

/**
 * Whether any Sparrow process runs. tasklist's CSV rows start with the quoted
 * image name, which does not depend on the Windows display language.
 */
export async function isSparrowRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const { stdout } = await execFileAsync('tasklist.exe', ['/FI', 'IMAGENAME eq Sparrow.exe', '/FO', 'CSV', '/NH'], {
    windowsHide: true,
    timeout: 15_000,
  });
  return stdout.split(/\r?\n/).some((line) => line.toLowerCase().startsWith('"sparrow.exe"'));
}

/** Starts Sparrow on the given network, detached from BTCortex (it is the user's application). */
export function launchSparrow(executable: string, network: BitcoinNetworkId): number {
  const child = spawn(executable, ['-n', sparrowNetworkArgument(network)], {
    cwd: dirname(executable),
    detached: true,
    stdio: 'ignore',
    shell: false,
  });
  if (child.pid === undefined) throw new Error(`Sparrow could not be started from ${executable}.`);
  child.unref();
  return child.pid;
}
