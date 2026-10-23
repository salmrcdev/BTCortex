import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { AppFailure } from '@btcortex/contracts';

// Prevents two orchestrators from managing the same data directory at once
// (specification section 32). The native shell's single-instance guard covers
// the normal case; this lock also covers manual or stale launches.

export interface InstanceLock {
  readonly path: string;
  release(): void;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function acquireInstanceLock(directory: string, pid = process.pid): InstanceLock {
  const path = join(directory, 'orchestrator.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(path, 'wx');
      writeSync(descriptor, String(pid));
      closeSync(descriptor);
      return {
        path,
        release: () => {
          try {
            if (readFileSync(path, 'utf8').trim() === String(pid)) rmSync(path, { force: true });
          } catch {
            // Already gone; nothing to release.
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
      if (Number.isInteger(owner) && owner !== pid && isProcessAlive(owner)) {
        throw new AppFailure({
          code: 'orchestrator.already-running',
          message: 'Another BTCortex orchestrator is already managing this data directory.',
          component: 'BTCortex orchestrator',
          dataRisk: 'none',
          likelyCause: `Process ${owner} holds the lock file.`,
          details: { lockFile: path, owner },
          recoveryActions: [{ id: 'close-other-instance', label: 'Close the other BTCortex window and try again' }],
        });
      }
      // Stale lock left by a process that no longer exists.
      rmSync(path, { force: true });
    }
  }
  throw new Error(`Could not acquire the instance lock at ${path}.`);
}
