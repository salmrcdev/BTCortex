import { existsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { cpus, freemem, totalmem } from 'node:os';
import { dirname, parse } from 'node:path';
import type { HardwareSummary } from '@btcortex/contracts';

// Hardware facts used for zero-touch recommendations. Free space is measured
// on the volume that will actually hold the data.

export function nearestExistingPath(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return parse(path).root;
    current = parent;
  }
  return current;
}

export async function describeHardware(dataPath: string): Promise<HardwareSummary> {
  const volumePath = nearestExistingPath(dataPath);
  const stats = await statfs(volumePath);
  return {
    totalMemoryBytes: totalmem(),
    availableMemoryBytes: freemem(),
    freeDiskBytes: stats.bavail * stats.bsize,
    volumeBytes: stats.blocks * stats.bsize,
    logicalProcessors: cpus().length,
    volumePath: parse(volumePath).root,
  };
}
