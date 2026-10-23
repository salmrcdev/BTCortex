import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { arch, cpus, release } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { CHAIN_SIZE_ESTIMATES, recommendConfiguration } from '@btcortex/bitcoin-config';
import type {
  DetectionReport,
  EnvironmentCheck,
  EnvironmentReport,
  ExistingSoftware,
  HardwareSummary,
} from '@btcortex/contracts';

// What the first-run guide checks on this computer (specification section
// 25), read-only and without administrator rights. Every fact comes from a
// probe that tests replace; the report turns them into checks a person can
// act on, and into the profile BTCortex recommends for a beginner.

const execFileAsync = promisify(execFile);
const GIB = 1024 ** 3;
const GB = 1000 ** 3;

/** Ports of the services BTCortex works with, by their usual numbers. */
export const WELL_KNOWN_PORTS: readonly { port: number; purpose: string }[] = [
  { port: 8332, purpose: 'Bitcoin Core RPC (mainnet)' },
  { port: 8333, purpose: 'Bitcoin peer-to-peer (mainnet)' },
  { port: 48332, purpose: 'Bitcoin Core RPC (testnet4)' },
  { port: 38332, purpose: 'Bitcoin Core RPC (signet)' },
  { port: 18443, purpose: 'Bitcoin Core RPC (regtest)' },
  { port: 50001, purpose: 'Electrum server' },
  { port: 50002, purpose: 'Electrum server over TLS' },
  { port: 9050, purpose: 'Tor SOCKS proxy' },
  { port: 9051, purpose: 'Tor control port' },
  { port: 9150, purpose: 'Tor Browser’s SOCKS proxy' },
  { port: 10009, purpose: 'LND gRPC' },
  { port: 8080, purpose: 'LND REST' },
];

/** Where BTCortex's own downloads come from. */
export const RELEASE_SERVERS: readonly string[] = [
  'https://bitcoincore.org/',
  'https://github.com/',
  'https://dist.torproject.org/',
];

export interface Listener {
  port: number;
  pid: number | null;
  owner: string | null;
  /** The program file, when Windows says; tells BTCortex's own services apart. */
  path: string | null;
}

export interface WindowsFacts {
  listeners: Listener[];
  /** The system proxy or its automatic configuration address, when one is set. */
  proxy: string | null;
  /** Whether Windows treats the internet connection as metered; null when unknown. */
  metered: boolean | null;
  docker: 'running' | 'installed' | 'not-installed' | 'unknown';
}

export interface EnvironmentProbes {
  dataDirectory: string;
  /** BTCortex's own data folder: services it started run from programs inside it. */
  btcortexRoot: string;
  osRelease: () => string;
  architecture: () => string;
  processor: () => string;
  hardware: () => Promise<HardwareSummary>;
  bitcoinCore: () => Promise<DetectionReport>;
  connectableNodes: () => Promise<number>;
  exists: (path: string) => boolean;
  env: Record<string, string | undefined>;
  wsl: () => Promise<'available' | 'not-installed' | 'unknown'>;
  windows: () => Promise<WindowsFacts>;
  reachable: (url: string) => Promise<boolean>;
}

const WindowsFactsSchema = z.object({
  listeners: z.array(
    z.object({
      port: z.number(),
      pid: z.number().nullable(),
      owner: z.string().nullable(),
      path: z.string().nullable().default(null),
    }),
  ),
  proxy: z.string().nullable(),
  metered: z.boolean().nullable(),
  docker: z.enum(['running', 'installed', 'not-installed', 'unknown']),
});

const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$ports = @($env:BTCORTEX_PORTS -split ',' | ForEach-Object { [int]$_ })",
  '$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $ports | Sort-Object LocalPort -Unique | ForEach-Object { $owner = Get-Process -Id $_.OwningProcess; @{ port = [int]$_.LocalPort; pid = [int]$_.OwningProcess; owner = if ($owner) { [string]$owner.ProcessName } else { $null }; path = if ($owner -and $owner.Path) { [string]$owner.Path } else { $null } } })',
  "$settings = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'",
  '$proxy = $null',
  'if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer) { $proxy = [string]$settings.ProxyServer } elseif ($settings.AutoConfigURL) { $proxy = [string]$settings.AutoConfigURL }',
  '$metered = $null',
  'try { [void][Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]; $connection = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile(); if ($connection) { $cost = [string]$connection.GetConnectionCost().NetworkCostType; if ($cost -eq "Unrestricted") { $metered = $false } elseif ($cost -eq "Fixed" -or $cost -eq "Variable") { $metered = $true } } } catch {}',
  "$docker = 'not-installed'",
  "if (Get-Process -Name 'Docker Desktop', 'com.docker.backend') { $docker = 'running' } elseif (Test-Path (Join-Path $env:ProgramFiles 'Docker\\Docker\\Docker Desktop.exe')) { $docker = 'installed' }",
  'ConvertTo-Json -Compress -Depth 3 @{ listeners = $listeners; proxy = $proxy; metered = $metered; docker = $docker }',
].join('; ');

export async function readWindowsFacts(): Promise<WindowsFacts> {
  if (process.platform !== 'win32') return { listeners: [], proxy: null, metered: null, docker: 'unknown' };
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT],
    {
      windowsHide: true,
      timeout: 30_000,
      // The ports travel in the environment, never inside the script.
      env: { ...process.env, BTCORTEX_PORTS: WELL_KNOWN_PORTS.map(({ port }) => String(port)).join(',') },
    },
  );
  return WindowsFactsSchema.parse(JSON.parse(stdout));
}

/** `wsl --status` answers only when the Windows Subsystem for Linux is installed. */
export async function detectWsl(): Promise<'available' | 'not-installed' | 'unknown'> {
  if (process.platform !== 'win32') return 'unknown';
  try {
    await execFileAsync('wsl.exe', ['--status'], { windowsHide: true, timeout: 15_000 });
    return 'available';
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || typeof error.code === 'number')) {
      return 'not-installed';
    }
    return 'unknown';
  }
}

export async function isReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8_000) });
    return response.status > 0;
  } catch {
    return false;
  }
}

export const defaultProbes = (
  options: Pick<EnvironmentProbes, 'dataDirectory' | 'btcortexRoot' | 'hardware' | 'bitcoinCore' | 'connectableNodes'>,
): EnvironmentProbes => ({
  ...options,
  osRelease: release,
  architecture: arch,
  processor: () => cpus()[0]?.model.trim() ?? 'Unknown processor',
  exists: existsSync,
  env: process.env,
  wsl: detectWsl,
  windows: readWindowsFacts,
  reachable: isReachable,
});

const WINDOWS_10_VERSIONS: Record<number, string> = {
  17763: '1809',
  18362: '1903',
  18363: '1909',
  19041: '2004',
  19042: '20H2',
  19043: '21H1',
  19044: '21H2',
  19045: '22H2',
};
const WINDOWS_11_VERSIONS: Record<number, string> = {
  22000: '21H2',
  22621: '22H2',
  22631: '23H2',
  26100: '24H2',
  26200: '25H2',
};
/** WebView2 and the Tauri runtime need Windows 10 version 1809 or later. */
const MINIMUM_BUILD = 17763;

function describeWindows(osRelease: string): { name: string; build: number | null } {
  const build = Number(osRelease.split('.')[2]);
  if (!Number.isInteger(build)) return { name: `Windows ${osRelease}`, build: null };
  if (build >= 22000) {
    const version = WINDOWS_11_VERSIONS[build];
    return { name: `Windows 11${version ? ` ${version}` : ''} (build ${String(build)})`, build };
  }
  const version = WINDOWS_10_VERSIONS[build];
  return { name: `Windows 10${version ? ` ${version}` : ''} (build ${String(build)})`, build };
}

function formatSize(bytes: number): string {
  return bytes >= 1000 * GB
    ? `${(bytes / (1000 * GB)).toLocaleString('en-GB', { maximumFractionDigits: 1 })} TB`
    : `${Math.round(bytes / GB).toLocaleString('en-GB')} GB`;
}

interface Candidate {
  id: ExistingSoftware['id'];
  name: string;
  paths: (string | undefined)[];
}

function softwareCandidates(env: Record<string, string | undefined>): Candidate[] {
  const under = (base: string | undefined, ...parts: string[]) => (base ? join(base, ...parts) : undefined);
  return [
    {
      id: 'sparrow',
      name: 'Sparrow Wallet',
      paths: [
        under(env['ProgramFiles'], 'Sparrow', 'Sparrow.exe'),
        under(env['LOCALAPPDATA'], 'Programs', 'Sparrow', 'Sparrow.exe'),
        under(env['APPDATA'], 'Sparrow'),
      ],
    },
    {
      id: 'electrum',
      name: 'Electrum',
      paths: [
        under(env['ProgramFiles(x86)'], 'Electrum'),
        under(env['ProgramFiles'], 'Electrum'),
        under(env['APPDATA'], 'Electrum'),
      ],
    },
    {
      id: 'trezor-suite',
      name: 'Trezor Suite',
      paths: [
        under(env['LOCALAPPDATA'], 'Programs', 'Trezor Suite', 'Trezor Suite.exe'),
        under(env['ProgramFiles'], 'Trezor Suite', 'Trezor Suite.exe'),
      ],
    },
    { id: 'lnd', name: 'LND', paths: [under(env['LOCALAPPDATA'], 'Lnd')] },
    {
      id: 'tor-browser',
      name: 'Tor Browser',
      paths: [
        under(env['USERPROFILE'], 'Desktop', 'Tor Browser', 'Browser', 'firefox.exe'),
        under(env['USERPROFILE'], 'OneDrive', 'Desktop', 'Tor Browser', 'Browser', 'firefox.exe'),
      ],
    },
  ];
}

export async function inspectEnvironment(probes: EnvironmentProbes, now: Date): Promise<EnvironmentReport> {
  const checks: EnvironmentCheck[] = [];
  const add = (check: EnvironmentCheck) => checks.push(check);

  const [hardware, bitcoinCore, connectableNodes, wsl, windows, reachability] = await Promise.all([
    probes.hardware(),
    probes.bitcoinCore().catch((): DetectionReport | undefined => undefined),
    probes.connectableNodes().catch(() => 0),
    probes.wsl().catch(() => 'unknown' as const),
    probes.windows().catch((): WindowsFacts => ({ listeners: [], proxy: null, metered: null, docker: 'unknown' })),
    Promise.all(RELEASE_SERVERS.map(async (url) => ({ url, reachable: await probes.reachable(url) }))),
  ]);

  // Windows and hardware.
  const windowsVersion = describeWindows(probes.osRelease());
  if (windowsVersion.build !== null && windowsVersion.build < MINIMUM_BUILD) {
    add({
      id: 'system.windows',
      area: 'system',
      state: 'problem',
      title: windowsVersion.name,
      detail: 'BTCortex needs Windows 10 version 1809 or later, with the WebView2 runtime.',
    });
  } else if (windowsVersion.build !== null && windowsVersion.build < 22000) {
    add({
      id: 'system.windows',
      area: 'system',
      state: 'warning',
      title: windowsVersion.name,
      detail:
        'Microsoft ended support for Windows 10 on 14 October 2025; it gets security updates only through Extended Security Updates. A computer that holds Bitcoin keys should run a supported Windows.',
    });
  } else {
    add({
      id: 'system.windows',
      area: 'system',
      state: 'ok',
      title: windowsVersion.name,
      detail: `${probes.architecture()} edition.`,
    });
  }
  add({
    id: 'system.hardware',
    area: 'system',
    state: hardware.totalMemoryBytes < 4 * GIB || hardware.logicalProcessors < 2 ? 'warning' : 'ok',
    title: `${probes.processor()}, ${String(hardware.logicalProcessors)} logical processors, ${(hardware.totalMemoryBytes / GIB).toLocaleString('en-GB', { maximumFractionDigits: 1 })} GiB of memory`,
    detail:
      hardware.totalMemoryBytes < 4 * GIB
        ? 'Bitcoin Core runs with little memory, but its first synchronisation takes much longer; BTCortex keeps its caches small.'
        : 'Enough for Bitcoin Core and the services beside it; BTCortex sizes their caches to this computer.',
  });

  // Disk space, judged as the node set-up will judge it.
  const general = recommendConfiguration({ network: 'mainnet', usage: 'general', hardware });
  const electrum = recommendConfiguration({ network: 'mainnet', usage: 'electrum-backend', hardware });
  const sizes = CHAIN_SIZE_ESTIMATES.mainnet;
  const free = `${formatSize(hardware.freeDiskBytes)} free on ${hardware.volumePath}`;
  if (!general.feasible) {
    add({
      id: 'storage.space',
      area: 'storage',
      state: 'problem',
      title: free,
      detail: `${general.blockers.join(' ')} Free up space, or choose another disk for the node when you set it up.`,
    });
  } else if (general.pruned) {
    add({
      id: 'storage.space',
      area: 'storage',
      state: 'info',
      title: free,
      detail: `The whole blockchain (about ${formatSize(sizes.blocksBytes + sizes.chainstateBytes)}) does not fit, so the node will keep only recent blocks. It still checks every block, but an Electrum server or explorer needs the whole chain.`,
    });
  } else {
    add({
      id: 'storage.space',
      area: 'storage',
      state: 'ok',
      title: free,
      detail: electrum.feasible
        ? 'Room for the whole blockchain and an Electrum server’s indexes.'
        : 'Room for the whole blockchain, but not also for an Electrum server’s indexes.',
    });
  }

  // Bitcoin software already here: BTCortex reads it and never changes it.
  const software: ExistingSoftware[] = [];
  for (const installation of bitcoinCore?.installations ?? []) {
    const product = installation.product === 'unknown' ? 'Bitcoin Core or a derivative' : installation.product;
    software.push({
      id: installation.product === 'Bitcoin Knots' ? 'bitcoin-knots' : 'bitcoin-core',
      name: `${product}${installation.version ? ` ${installation.version}` : ''}`,
      location: installation.path,
    });
  }
  for (const candidate of softwareCandidates(probes.env)) {
    const location = candidate.paths.find((path) => path !== undefined && probes.exists(path));
    if (location) software.push({ id: candidate.id, name: candidate.name, location });
  }
  const dataDirectories = bitcoinCore?.dataDirectories ?? [];
  if (software.length === 0 && dataDirectories.length === 0) {
    add({
      id: 'software.none',
      area: 'software',
      state: 'ok',
      title: 'No Bitcoin software found',
      detail: 'BTCortex installs what you choose from verified releases.',
    });
  } else {
    add({
      id: 'software.found',
      area: 'software',
      state: 'info',
      title: `Found: ${[...new Set(software.map((entry) => entry.name))].join(', ') || 'Bitcoin Core data'}`,
      detail:
        connectableNodes > 0
          ? `BTCortex can connect to ${connectableNodes === 1 ? 'the node' : `the ${String(connectableNodes)} nodes`} already here instead of setting up a new one. Existing programs, settings and wallets are read, never replaced.`
          : 'Existing programs, settings and wallets are read, never replaced.',
    });
  }

  // Virtualisation: shown because the specification asks, but nothing BTCortex deploys needs it.
  add({
    id: 'virtualisation',
    area: 'virtualisation',
    state: 'ok',
    title: `WSL2 ${wsl === 'available' ? 'installed' : wsl === 'not-installed' ? 'not installed' : 'not checked'}; Docker ${windows.docker === 'running' ? 'running' : windows.docker === 'installed' ? 'installed' : windows.docker === 'not-installed' ? 'not installed' : 'not checked'}`,
    detail: 'Not needed: everything BTCortex sets up runs natively on Windows.',
  });

  // Ports: BTCortex chooses free ones for what it sets up, so these only say what already runs.
  const root = probes.btcortexRoot.toLowerCase();
  const used = windows.listeners.flatMap((listener) => {
    const purpose = WELL_KNOWN_PORTS.find(({ port }) => port === listener.port)?.purpose;
    if (purpose === undefined) return [];
    const own = listener.path?.toLowerCase().startsWith(root) === true;
    return [{ ...listener, purpose, own }];
  });
  const others = used.filter((listener) => !listener.own);
  const describe = (listener: (typeof used)[number]) =>
    `${String(listener.port)} (${listener.purpose}) by ${listener.own ? 'BTCortex’s ' : ''}${listener.owner ?? 'an unknown program'}${listener.pid === null ? '' : ` (process ${String(listener.pid)})`}`;
  add({
    id: 'ports',
    area: 'ports',
    state: others.length === 0 ? 'ok' : 'info',
    title:
      used.length === 0
        ? 'The usual Bitcoin, Electrum, Tor and Lightning ports are free'
        : others.length === 0
          ? 'The usual ports are free or used by BTCortex itself'
          : `${String(others.length)} of the usual ports ${others.length === 1 ? 'is' : 'are'} used by other programs`,
    detail:
      used.length === 0
        ? 'Nothing else listens where BTCortex’s services usually would.'
        : `${used.map(describe).join('; ')}.${others.length === 0 ? '' : ' BTCortex picks free ports for what it sets up, so this blocks nothing.'}`,
  });

  // Network.
  const unreachable = reachability.filter((entry) => !entry.reachable).map((entry) => new URL(entry.url).host);
  add({
    id: 'network.releases',
    area: 'network',
    state: unreachable.length === 0 ? 'ok' : unreachable.length === RELEASE_SERVERS.length ? 'problem' : 'warning',
    title:
      unreachable.length === 0
        ? 'The release servers answer'
        : unreachable.length === RELEASE_SERVERS.length
          ? 'No release server answers'
          : `${unreachable.join(', ')} ${unreachable.length === 1 ? 'does' : 'do'} not answer`,
    detail:
      unreachable.length === 0
        ? 'Releases can be downloaded and verified from bitcoincore.org, GitHub and torproject.org.'
        : 'Without them nothing can be installed. Check the internet connection, or whether a firewall or filter blocks these sites.',
  });
  if (windows.proxy !== null) {
    add({
      id: 'network.proxy',
      area: 'network',
      state: 'warning',
      title: 'Windows uses a proxy',
      detail: `Windows sends web traffic through ${windows.proxy}. BTCortex connects directly, so its downloads fail if this network allows only the proxy.`,
    });
  }
  if (windows.metered === true) {
    add({
      id: 'network.metered',
      area: 'network',
      state: 'warning',
      title: 'The internet connection is metered',
      detail: `A full node downloads the whole blockchain once (about ${formatSize(sizes.blocksBytes)}), even when it keeps only recent blocks, and then every new block and the transactions relayed with them: several gigabytes a month.`,
    });
  }

  const recommendation = electrum.feasible
    ? {
        profileId: 'private-wallet' as const,
        reason:
          'There is room for the whole blockchain and an Electrum server, so your wallet can ask only your own node.',
      }
    : {
        profileId: 'basic-node' as const,
        reason: general.pruned
          ? 'The disk is too small for the whole blockchain, so a pruned node is the best fit; it still verifies every block.'
          : 'There is room for the whole blockchain but not for an Electrum server’s indexes as well.',
      };

  return {
    checkedAt: now.toISOString(),
    checks,
    software,
    connectableNodes,
    recommendation,
  };
}
