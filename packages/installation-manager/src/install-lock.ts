import { resolve } from 'node:path';

// One installation per destination at a time. Two requests for the same
// release (a set-up and an update started together, say) would otherwise share
// one download file and one staging folder and undo each other's work. The
// orchestrator is a single process (BTCortex runs once per user), so a lock in
// memory is enough.

const queues = new Map<string, Promise<void>>();

/** Runs `work` once every earlier installation into the same destination has finished. */
export async function withInstallLock<T>(destination: string, work: () => Promise<T>): Promise<T> {
  const key = resolve(destination).toLowerCase();
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(work);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  try {
    return await run;
  } finally {
    if (queues.get(key) === settled) queues.delete(key);
  }
}
