import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Which I2P router runs on this computer, read-only: the program Windows
// reports on the SAM bridge's port, and the routers' consoles, which answer
// even while the bridge does not (the Java router's bridge is off until it is
// started; i2pd opens its bridge once it has joined the I2P network).

const execFileAsync = promisify(execFile);
const CONSOLE_TIMEOUT_MS = 3_000;

export type I2pRouterKind = 'i2pd' | 'java-i2p';

export interface RouterConsole {
  url: string;
  /** How the console's pages, or its login prompt, name it. */
  mark: RegExp;
}

/** Where each router's console answers by default. */
export const ROUTER_CONSOLES: Record<I2pRouterKind, RouterConsole> = {
  i2pd: { url: 'http://127.0.0.1:7070/', mark: /Purple I2P/i },
  'java-i2p': { url: 'http://127.0.0.1:7657/', mark: /I2P Router Console/i },
};

/** Whether a router's console answers, by its name on the page or in its login prompt. */
export async function consoleAnswers({ url, mark }: RouterConsole): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(CONSOLE_TIMEOUT_MS) });
    if (mark.test(response.headers.get('www-authenticate') ?? '')) return true;
    return mark.test((await response.text()).slice(0, 65_536));
  } catch {
    return false;
  }
}

/** The first router whose console answers, if any. */
export async function routerByConsole(
  consoles: Record<I2pRouterKind, RouterConsole> = ROUTER_CONSOLES,
): Promise<I2pRouterKind | null> {
  const kinds = Object.keys(consoles) as I2pRouterKind[];
  const answers = await Promise.all(kinds.map((kind) => consoleAnswers(consoles[kind])));
  return kinds.find((_kind, index) => answers[index]) ?? null;
}

const PROGRAM_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$env:BTCORTEX_PORT) | Select-Object -First 1',
  'if ($listener) { $owner = Get-Process -Id $listener.OwningProcess; if ($owner) { [string]$owner.ProcessName } }',
].join('; ');

/** The name of the process listening on a local port, as Windows reports it. */
export async function listeningProcess(port: number): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', PROGRAM_SCRIPT],
    // The port travels in the environment, never inside the script.
    { windowsHide: true, timeout: 15_000, env: { ...process.env, BTCORTEX_PORT: String(port) } },
  );
  const name = stdout.trim();
  return name === '' ? null : name;
}

/** i2pd by its own name; the Java router runs inside Java. */
export function routerName(processName: string | null): string | null {
  if (processName === null) return null;
  if (/^i2pd/i.test(processName)) return 'i2pd';
  if (/^(java|javaw|i2psvc)$/i.test(processName)) return 'I2P';
  return processName;
}
