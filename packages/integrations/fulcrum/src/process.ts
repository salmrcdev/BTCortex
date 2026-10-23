import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync } from 'node:fs';

// Fulcrum runs without a console window, detached from BTCortex like the node
// it serves, so that a node that keeps running after BTCortex closes keeps
// its Electrum server; BTCortex finds it again through its pid file and its
// ports. Fulcrum logs to stdout only, so its output goes to a file (a pipe
// nobody drains could block it, and the file survives BTCortex exiting).

export interface FulcrumExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface FulcrumProcess {
  child: ChildProcess;
  pid: number;
  /** Settles when Fulcrum has exited, for whatever reason, while this BTCortex runs. */
  exited: Promise<FulcrumExit>;
}

export interface StartFulcrumOptions {
  executable: string;
  configFile: string;
  /** Working directory: Fulcrum's installation folder. */
  directory: string;
  /** Receives Fulcrum's output; moved aside at a start once it exceeds `maxLogBytes`. */
  logFile: string;
  maxLogBytes?: number;
  /** Extra environment variables, such as RPCUSER and RPCPASSWORD. */
  environment?: Record<string, string>;
}

const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024;
const TAIL_BYTES = 64 * 1024;

function rotate(logFile: string, maxBytes: number): void {
  if (!existsSync(logFile) || statSync(logFile).size < maxBytes) return;
  rmSync(`${logFile}.1`, { force: true });
  renameSync(logFile, `${logFile}.1`);
}

/** Starts Fulcrum; rejects when Windows cannot start the executable at all (missing, blocked). */
export function startFulcrumProcess(options: StartFulcrumOptions): Promise<FulcrumProcess> {
  rotate(options.logFile, options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES);
  const output = openSync(options.logFile, 'a');
  return new Promise<FulcrumProcess>((resolvePromise, reject) => {
    const child = spawn(options.executable, [options.configFile], {
      cwd: options.directory,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', output, output],
      shell: false,
      env: { ...process.env, ...options.environment },
    });
    const exited = new Promise<FulcrumExit>((resolveExit) => {
      child.once('exit', (code, signal) => {
        resolveExit({ code, signal });
      });
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.removeListener('error', reject);
      child.on('error', () => undefined);
      if (child.pid === undefined) {
        reject(new Error(`Fulcrum could not be started from ${options.executable}.`));
        return;
      }
      child.unref();
      resolvePromise({ child, pid: child.pid, exited });
    });
  }).finally(() => {
    closeSync(output);
  });
}

/** The process number in Fulcrum's pid file, which it removes when it shuts down cleanly. */
export function readFulcrumPid(pidFile: string): number | undefined {
  if (!existsSync(pidFile)) return undefined;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** Whether a process with this number exists. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The last lines Fulcrum wrote. */
export function readFulcrumLogTail(logFile: string, lines = 30): string[] {
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

export interface FulcrumLogLine {
  /** ISO 8601, from Fulcrum's UTC timestamp. */
  time: string;
  /** The thread that wrote it, such as "Controller", when given. */
  source?: string;
  message: string;
  /**
   * Fulcrum marks only fatal errors in text ("FATAL:"); warnings and errors
   * are told apart only by colour on a console, so they are recognised by
   * their wording.
   */
  severity: 'error' | 'warning' | 'info';
}

const LINE = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})\] (?:<([^>]+)> )?(.*)$/;
const TROUBLE =
  /\b(error|errors|failed|failure|cannot|can't|unable|refused|timed out|timeout|exception|lost|disconnected)\b/i;

/** Splits a line written with `ts_format = utc` ("[2026-10-23 03:04:02.414] <Controller> …"). */
export function parseFulcrumLogLine(line: string): FulcrumLogLine | undefined {
  const match = LINE.exec(line);
  if (!match?.[1] || !match[2] || match[4] === undefined) return undefined;
  const message = match[4];
  return {
    time: `${match[1]}T${match[2]}Z`,
    ...(match[3] ? { source: match[3] } : {}),
    message,
    severity: message.startsWith('FATAL:') ? 'error' : TROUBLE.test(message) ? 'warning' : 'info',
  };
}
