import { rename } from 'node:fs/promises';

// On Windows, a file that was just written or run is often still open in
// another process for a moment (an antivirus scanning it, a process that has
// just exited), and renaming it or its folder fails with EPERM, EACCES or
// EBUSY. Such renames are retried for a while before giving up.

const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);

export interface RenameOptions {
  timeoutMs?: number;
  /** For tests. */
  rename?: (from: string, to: string) => Promise<void>;
}

export async function renameWhenReleased(from: string, to: string, options: RenameOptions = {}): Promise<void> {
  const attempt = options.rename ?? rename;
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  for (let delay = 100; ; delay = Math.min(delay * 2, 2_000)) {
    try {
      await attempt(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === undefined || !TRANSIENT.has(code) || Date.now() + delay > deadline) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
