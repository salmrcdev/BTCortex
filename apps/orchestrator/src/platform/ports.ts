import { createServer } from 'node:net';

/** True when nothing listens on the loopback port (a quick bind test). */
export function isLoopbackPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

/**
 * The preferred port if free, otherwise the first free port in the fallback
 * range. `taken` holds ports promised to programs that are not running now
 * (a stopped node), which a bind test cannot see.
 */
export async function chooseLoopbackPort(
  preferred: number,
  fallbackRange: readonly [number, number],
  taken: ReadonlySet<number> = new Set(),
): Promise<number | undefined> {
  if (!taken.has(preferred) && (await isLoopbackPortFree(preferred))) return preferred;
  for (let port = fallbackRange[0]; port <= fallbackRange[1]; port += 1) {
    if (!taken.has(port) && (await isLoopbackPortFree(port))) return port;
  }
  return undefined;
}
