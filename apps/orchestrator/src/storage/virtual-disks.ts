import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

// The virtual disks of WSL2 distributions and Docker Desktop. BTCortex runs
// everything natively and uses neither, but their disks can take a large
// share of a volume (specification section 27 asks for them to be
// monitored), so the ones that exist are listed with their sizes, read-only.

export interface VirtualDiskFile {
  name: string;
  owner: 'wsl' | 'docker';
  path: string;
  bytes: number;
}

export interface WslDistribution {
  name: string;
  /** The folder WSL keeps the distribution's disk in, as the registry has it. */
  basePath: string;
  /** The disk's file name when the registry gives one. */
  diskFile: string | null;
}

const DistributionsSchema = z.array(
  z.object({ name: z.string(), basePath: z.string(), diskFile: z.string().nullable() }),
);

/** The WSL 2 distributions registered for this user; the registry is the only list WSL keeps. */
const LXSS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$found = @(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss' | ForEach-Object { $p = Get-ItemProperty $_.PSPath; if ($p.BasePath -and $p.Version -eq 2) { @{ name = [string]$p.DistributionName; basePath = [string]$p.BasePath; diskFile = if ($p.VhdFileName) { [string]$p.VhdFileName } else { $null } } } })",
  'ConvertTo-Json -Compress -Depth 3 -InputObject $found',
].join('; ');

export async function readWslDistributions(): Promise<WslDistribution[]> {
  if (process.platform !== 'win32') return [];
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LXSS_SCRIPT], {
    windowsHide: true,
    timeout: 30_000,
  });
  const text = stdout.trim();
  if (text === '') return [];
  const parsed: unknown = JSON.parse(text);
  return DistributionsSchema.parse(Array.isArray(parsed) ? parsed : [parsed]);
}

interface Candidate {
  name: string;
  owner: VirtualDiskFile['owner'];
  path: string;
}

/** The disk files that may exist, from the registered distributions and Docker Desktop's own layout. */
export function virtualDiskCandidates(
  distributions: readonly WslDistribution[],
  localAppData: string | undefined,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const distribution of distributions) {
    // The registry may keep the long-path form, \\?\C:\...
    const base = distribution.basePath.replace(/^\\\\\?\\/, '');
    const docker = distribution.name.startsWith('docker-desktop');
    candidates.push({
      name: distribution.name,
      owner: docker ? 'docker' : 'wsl',
      path: join(base, distribution.diskFile ?? 'ext4.vhdx'),
    });
    // Since Docker Desktop 4.30 its images, containers and volumes are on a data disk next to the
    // docker-desktop distribution rather than in a distribution of their own.
    if (distribution.name === 'docker-desktop') {
      candidates.push({
        name: 'docker-desktop data',
        owner: 'docker',
        path: join(dirname(base), 'disk', 'docker_data.vhdx'),
      });
    }
  }
  if (localAppData) {
    candidates.push({
      name: 'docker-desktop data',
      owner: 'docker',
      path: join(localAppData, 'Docker', 'wsl', 'disk', 'docker_data.vhdx'),
    });
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function findVirtualDisks(
  distributions: () => Promise<WslDistribution[]> = readWslDistributions,
  localAppData: string | undefined = process.env['LOCALAPPDATA'],
): Promise<VirtualDiskFile[]> {
  if (process.platform !== 'win32') return [];
  const candidates = virtualDiskCandidates(await distributions().catch(() => []), localAppData);
  const found: VirtualDiskFile[] = [];
  for (const candidate of candidates) {
    const info = await stat(candidate.path).catch(() => undefined);
    if (info?.isFile()) found.push({ ...candidate, bytes: info.size });
  }
  return found;
}
