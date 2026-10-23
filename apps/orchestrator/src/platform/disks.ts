import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { readdir, stat, statfs } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { DiskKind, Volume } from '@btcortex/contracts';
import { nearestExistingPath } from './hardware';

// The disk behind a folder: how much room is left, and whether it is an SSD
// or a hard disk, which makes days of difference to an initial synchronisation.
// Windows reports the disk type through its Storage module without
// administrator rights.

const execFileAsync = promisify(execFile);

export type DiskDescription = Pick<Volume, 'kind' | 'bus' | 'model'>;

const UNKNOWN_DISK: DiskDescription = { kind: 'unknown', bus: null, model: null };

const DiskSchema = z.object({ MediaType: z.string(), BusType: z.string(), Model: z.string() });

function diskScript(letter: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$partition = Get-Partition -DriveLetter ${letter}`,
    '$disk = Get-PhysicalDisk | Where-Object { $_.DeviceId -eq "$($partition.DiskNumber)" } | Select-Object -First 1',
    '[pscustomobject]@{ MediaType = "$($disk.MediaType)"; BusType = "$($disk.BusType)"; Model = "$($disk.FriendlyName)" } | ConvertTo-Json -Compress',
  ].join('; ');
}

function diskKind(mediaType: string): DiskKind {
  // SCM is storage-class memory, which behaves like a fast SSD.
  if (mediaType === 'SSD' || mediaType === 'SCM') return 'ssd';
  if (mediaType === 'HDD') return 'hdd';
  return 'unknown';
}

const disks = new Map<string, Promise<DiskDescription>>();

/** The type of the disk holding a volume such as `C:\`, asked once per volume while BTCortex runs. */
export function describeDisk(root: string): Promise<DiskDescription> {
  const letter = /^([A-Za-z]):[\\/]?$/.exec(root)?.[1]?.toUpperCase();
  if (process.platform !== 'win32' || letter === undefined) return Promise.resolve(UNKNOWN_DISK);
  let pending = disks.get(letter);
  if (!pending) {
    pending = execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', diskScript(letter)], {
      windowsHide: true,
      timeout: 20_000,
    })
      .then(({ stdout }) => {
        const disk = DiskSchema.parse(JSON.parse(stdout));
        return { kind: diskKind(disk.MediaType), bus: disk.BusType || null, model: disk.Model || null };
      })
      .catch(() => UNKNOWN_DISK);
    disks.set(letter, pending);
  }
  return pending;
}

/** Room on the volume that holds `path` (or would hold it, for a folder that does not exist yet). */
export async function measureVolume(
  path: string,
  describe: (root: string) => Promise<DiskDescription> = describeDisk,
): Promise<Volume> {
  const existing = nearestExistingPath(path);
  const stats = await statfs(existing);
  const root = parse(existing).root;
  return {
    root,
    totalBytes: stats.blocks * stats.bsize,
    freeBytes: stats.bavail * stats.bsize,
    ...(await describe(root)),
  };
}

const STAT_BATCH = 64;

/**
 * Total size of the files under a folder; 0 when it does not exist. Links and
 * junctions are not followed, so nothing is counted twice.
 */
export async function folderSize(path: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true, recursive: true });
  } catch {
    return 0;
  }
  const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
  let total = 0;
  for (let start = 0; start < files.length; start += STAT_BATCH) {
    const sizes = await Promise.all(
      files.slice(start, start + STAT_BATCH).map((file) =>
        stat(file).then(
          (info) => info.size,
          () => 0,
        ),
      ),
    );
    total += sizes.reduce((sum, size) => sum + size, 0);
  }
  return total;
}

/** Size of the files directly in a folder, without its subfolders. */
export async function topLevelFilesSize(path: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        stat(join(path, entry.name)).then(
          (info) => info.size,
          () => 0,
        ),
      ),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}
