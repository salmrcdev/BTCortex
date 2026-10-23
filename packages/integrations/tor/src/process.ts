import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs';

// tor runs in the user's session without a console window, detached from
// BTCortex so that it can keep serving a node that keeps running after
// BTCortex closes; BTCortex connects to it again on its next start. Its
// output ("Log notice stdout") goes to a file rather than a pipe: a pipe
// nobody drains can block tor, and the file survives BTCortex exiting.
// Live notices reach BTCortex as control-port events instead.

export interface TorExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface TorProcess {
  child: ChildProcess;
  pid: number;
  /** Settles when tor has exited, for whatever reason, while this BTCortex runs. */
  exited: Promise<TorExit>;
}

export interface StartTorProcessOptions {
  executable: string;
  /** The Expert Bundle folder, used as the working directory. */
  bundle: string;
  args: readonly string[];
  /** Receives tor's output; moved aside at a start once it exceeds `maxLogBytes`. */
  logFile: string;
  maxLogBytes?: number;
}

const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;
const TAIL_BYTES = 64 * 1024;

function rotate(logFile: string, maxBytes: number): void {
  if (!existsSync(logFile) || statSync(logFile).size < maxBytes) return;
  rmSync(`${logFile}.1`, { force: true });
  renameSync(logFile, `${logFile}.1`);
}

/** Starts tor; rejects when Windows cannot start the executable at all (missing, blocked). */
export function startTorProcess(options: StartTorProcessOptions): Promise<TorProcess> {
  rotate(options.logFile, options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES);
  const output = openSync(options.logFile, 'a');
  return new Promise<TorProcess>((resolvePromise, reject) => {
    const child = spawn(options.executable, [...options.args], {
      cwd: options.bundle,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', output, output],
      shell: false,
    });
    const exited = new Promise<TorExit>((resolveExit) => {
      child.once('exit', (code, signal) => {
        resolveExit({ code, signal });
      });
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.removeListener('error', reject);
      // Later errors (for example a failed kill) surface through `exited` or the control port.
      child.on('error', () => undefined);
      if (child.pid === undefined) {
        reject(new Error(`tor could not be started from ${options.executable}.`));
        return;
      }
      child.unref();
      resolvePromise({ child, pid: child.pid, exited });
    });
  }).finally(() => {
    closeSync(output);
  });
}

/** The last lines tor wrote, for explaining why it stopped. */
export function readTorLogTail(logFile: string, lines = 30): string[] {
  if (!existsSync(logFile)) return [];
  const size = statSync(logFile).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const buffer = Buffer.alloc(size - start);
  const descriptor = openSync(logFile, 'r');
  try {
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(descriptor, buffer, offset, buffer.length - offset, start + offset);
      if (read === 0) break;
      offset += read;
    }
  } finally {
    closeSync(descriptor);
  }
  return buffer
    .toString('utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(-lines);
}

/** Whether a process with this number exists; a tor found running from an earlier session has no child handle. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const TOR_LINE = /^[A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2}\.\d{3} \[(\w+)\] (.*)$/;

/** Splits a line of tor's own log ("Oct 23 02:41:07.000 [notice] …") into its severity and message. */
export function parseTorLogLine(line: string): { severity: string; message: string } | undefined {
  const match = TOR_LINE.exec(line);
  return match?.[1] && match[2] !== undefined ? { severity: match[1], message: match[2] } : undefined;
}
