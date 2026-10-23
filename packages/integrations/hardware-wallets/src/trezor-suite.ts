import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { installSignedInstaller, readInstallerRecord } from '@btcortex/installation-manager';
import type { InstallerRecord, InstallProgress, TrustedKey } from '@btcortex/installation-manager';
import { SATOSHILABS_SIGNING_KEY } from './signing-key.generated';

// Trezor Suite, Trezor's own application, which BTCortex installs and opens
// for what belongs to it: setting up a device, firmware updates (including
// the Bitcoin-only firmware) and pairing the Safe 7
// (docs/research/notes/wallets-hardware.md §8.1–8.3). The installer is
// verified by its detached signature from the SatoshiLabs 2021 Signing Key
// and by SatoshiLabs' Windows code signature, then installed for the current
// user without administrator rights. BTCortex never enables or connects to
// Suite's experimental MCP server. The standalone Trezor Bridge is deprecated
// by Trezor: BTCortex only detects it and suggests removing it.

const execFileAsync = promisify(execFile);

const VERSION = /^\d+\.\d+\.\d+$/;
const RELEASES = 'https://github.com/trezor/trezor-suite/releases';
/** Suite's own bridge, started while Suite runs; it holds the device's USB interface. */
export const TREZOR_SUITE_BRIDGE_PORT = 21328;
/** The deprecated standalone Trezor Bridge (trezord). */
export const TREZOR_BRIDGE_PORT = 21325;
/** Publishers named in Suite's Authenticode certificates (electron-builder signing configuration). */
const SUITE_PUBLISHERS = ['SatoshiLabs, s.r.o.', 'Trezor Company s.r.o.'];

export const SATOSHILABS_TRUSTED_KEYS: readonly TrustedKey[] = [
  {
    name: SATOSHILABS_SIGNING_KEY.owner,
    armored: SATOSHILABS_SIGNING_KEY.armored,
    fingerprints: [SATOSHILABS_SIGNING_KEY.fingerprint],
  },
];

export interface SuiteEnvironment {
  LOCALAPPDATA?: string | undefined;
  ProgramFiles?: string | undefined;
  'ProgramFiles(x86)'?: string | undefined;
}

export function trezorSuiteReleaseFiles(version: string) {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a Trezor Suite release version.`);
  const installerName = `Trezor-Suite-${version}-win-x64.exe`;
  const base = `${RELEASES}/download/v${version}/`;
  return { installerName, installer: `${base}${installerName}`, signature: `${base}${installerName}.asc` };
}

export async function fetchLatestTrezorSuiteVersion(fetchImplementation: typeof fetch = fetch): Promise<string> {
  const response = await fetchImplementation('https://api.github.com/repos/trezor/trezor-suite/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BTCortex' },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered HTTP ${String(response.status)} when asked for the latest Trezor Suite release.`);
  }
  const body = (await response.json()) as { tag_name?: unknown; prerelease?: unknown; draft?: unknown };
  const tag = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/, '') : '';
  if (!VERSION.test(tag) || body.prerelease === true || body.draft === true) {
    throw new Error(`The latest Trezor Suite release tag "${tag}" is not a final release.`);
  }
  return tag;
}

/** Where Suite's installer puts it: per user by default, per machine when an administrator installed it. */
export function trezorSuiteLocations(env: SuiteEnvironment = process.env): string[] {
  return [
    ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Programs', 'Trezor Suite', 'Trezor Suite.exe')] : []),
    ...(env.ProgramFiles ? [join(env.ProgramFiles, 'Trezor Suite', 'Trezor Suite.exe')] : []),
  ];
}

export function trezorSuitePerUserExecutable(env: SuiteEnvironment = process.env): string {
  if (!env.LOCALAPPDATA) throw new Error('The per-user programs folder is not known.');
  return join(env.LOCALAPPDATA, 'Programs', 'Trezor Suite', 'Trezor Suite.exe');
}

/** The product version Windows reads from an executable, for example `26.10.2`. */
async function productVersion(path: string): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-Item -LiteralPath $env:BTCORTEX_FILE).VersionInfo.ProductVersion',
      ],
      { env: { ...process.env, BTCORTEX_FILE: path }, windowsHide: true, timeout: 20_000 },
    );
    // Windows reports four parts, for example 26.10.2.0; releases are named with three.
    const version = stdout.trim().replace(/^(\d+\.\d+\.\d+)\.0$/, '$1');
    return version === '' ? null : version;
  } catch {
    return null;
  }
}

async function processRunning(imageName: string): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      timeout: 15_000,
    });
    return stdout.split(/\r?\n/).some((line) => line.toLowerCase().startsWith(`"${imageName.toLowerCase()}"`));
  } catch {
    return false;
  }
}

function listening(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (result: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    socket.once('connect', () => {
      finish(true);
    });
    socket.once('error', () => {
      finish(false);
    });
  });
}

export interface TrezorSuiteState {
  installed: { path: string; version: string | null; installedByBtcortex: boolean } | null;
  running: boolean;
  /** Suite's bridge is up, so Suite holds a connected Trezor: other applications must wait until it is closed. */
  holdsDevice: boolean;
}

export async function trezorSuiteState(
  recordFile: string,
  env: SuiteEnvironment = process.env,
): Promise<TrezorSuiteState> {
  const path = trezorSuiteLocations(env).find((candidate) => existsSync(candidate));
  const record = await readInstallerRecord(recordFile).catch(() => undefined);
  const [running, bridge] = await Promise.all([
    processRunning('Trezor Suite.exe'),
    listening(TREZOR_SUITE_BRIDGE_PORT),
  ]);
  return {
    installed: path
      ? {
          path,
          version: await productVersion(path),
          installedByBtcortex: record?.installedExecutable.toLowerCase() === path.toLowerCase(),
        }
      : null,
    running,
    holdsDevice: running && bridge,
  };
}

export interface TrezorBridgeState {
  /** The deprecated standalone bridge is installed or answering on its port. */
  present: boolean;
  running: boolean;
  path: string | null;
}

export async function trezorBridgeState(env: SuiteEnvironment = process.env): Promise<TrezorBridgeState> {
  const candidates = [env.ProgramFiles, env['ProgramFiles(x86)']]
    .filter((folder): folder is string => folder !== undefined)
    .map((folder) => join(folder, 'TREZOR Bridge', 'trezord.exe'));
  const path = candidates.find((candidate) => existsSync(candidate)) ?? null;
  const [running, port] = await Promise.all([processRunning('trezord.exe'), listening(TREZOR_BRIDGE_PORT)]);
  return { present: path !== null || running || port, running: running || port, path };
}

/** Opens Suite, detached: it is the user's application. */
export function launchTrezorSuite(executable: string): void {
  const child = spawn(executable, [], { detached: true, stdio: 'ignore', shell: false, windowsHide: false });
  child.once('error', () => undefined);
  child.unref();
}

export interface InstallTrezorSuiteOptions {
  version: string;
  downloadsDirectory: string;
  recordFile: string;
  env?: SuiteEnvironment;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  runInstaller?: (path: string, args: readonly string[], timeoutMs: number) => Promise<number | null>;
}

export function installTrezorSuite(options: InstallTrezorSuiteOptions): Promise<InstallerRecord> {
  const files = trezorSuiteReleaseFiles(options.version);
  return installSignedInstaller({
    label: `Trezor Suite ${options.version}`,
    version: options.version,
    installerUrl: files.installer,
    installerName: files.installerName,
    signatureUrl: files.signature,
    keys: SATOSHILABS_TRUSTED_KEYS,
    threshold: 1,
    trustAnchors: `SatoshiLabs 2021 Signing Key ${SATOSHILABS_SIGNING_KEY.fingerprint}`,
    expectedSigners: SUITE_PUBLISHERS,
    // electron-builder's assisted NSIS installer: silent, for this Windows user only.
    silentArguments: ['/S', '/currentuser'],
    installedExecutable: trezorSuitePerUserExecutable(options.env),
    recordFile: options.recordFile,
    downloadsDirectory: options.downloadsDirectory,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.runInstaller ? { runInstaller: options.runInstaller } : {}),
  });
}
