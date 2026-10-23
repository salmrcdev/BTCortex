// Fulcrum's `/stats` HTTP endpoint (docs/research/notes/electrum-indexers-explorers.md
// §3.5): available from start-up, before the Electrum and admin ports open,
// so it is the source of indexing progress. Of its large JSON tree, BTCortex
// reads the "Controller" section (observed with 2.1.4): "Header count" is the
// number of blocks in the index (so the indexed height is one less), and
// while Fulcrum catches up, "StateMachine" names its state and the node's
// height it is indexing towards; it is null once the index is up to date.

export interface FulcrumStats {
  /** Fulcrum's name for the node's chain (main, test, testnet4, signet, regtest); null before it asked. */
  chain: string | null;
  /** The highest block in the index; null while the index is empty. */
  indexedHeight: number | null;
  /** While catching up: the node's height Fulcrum is indexing towards. */
  targetHeight: number | null;
  /** Fulcrum's own name for what it is doing, for example "DownloadingBlocks"; null when idle. */
  activity: string | null;
  /** The node as Fulcrum sees it. */
  node: { subversion: string | null; zmqBlockNotifications: boolean } | null;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseFulcrumStats(json: unknown): FulcrumStats {
  const root = record(json);
  const controller = record(root?.['Controller']);
  if (!root || !controller) throw new Error('Fulcrum’s /stats has no "Controller" section.');
  const chain = typeof controller['Chain'] === 'string' && controller['Chain'] !== '' ? controller['Chain'] : null;
  const headers = controller['Header count'];
  const machine = record(controller['StateMachine']);
  const daemon = record(record(root['Bitcoin Daemon'])?.['bitcoind info']);
  const notifications = daemon?.['zmqNotifications'];
  return {
    chain,
    indexedHeight: typeof headers === 'number' && headers > 0 ? headers - 1 : null,
    targetHeight: typeof machine?.['Height'] === 'number' ? machine['Height'] : null,
    activity: typeof machine?.['State'] === 'string' ? machine['State'] : null,
    node: daemon
      ? {
          subversion: typeof daemon['subversion'] === 'string' ? daemon['subversion'] : null,
          zmqBlockNotifications:
            Array.isArray(notifications) &&
            notifications.some((entry) => Array.isArray(entry) && entry[0] === 'hashblock'),
        }
      : null,
  };
}

export async function readFulcrumStats(
  statsPort: number,
  options: { timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<FulcrumStats> {
  const response = await (options.fetch ?? fetch)(`http://127.0.0.1:${String(statsPort)}/stats`, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
  });
  if (!response.ok) throw new Error(`Fulcrum’s /stats answered HTTP ${String(response.status)}.`);
  return parseFulcrumStats(await response.json());
}
