import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogEntry, LogPage, LogQuery, LogSeverity, LogSource, LogSourceKind } from '@btcortex/contracts';
import { consoleLogPath, debugLogPath } from '@btcortex/integration-bitcoin-core';
import type { AppPaths } from '../platform/paths';
import { localDataDirectory } from '../nodes/local-files';
import type { NodeManager } from '../nodes/node-manager';
import { LogTail } from './log-tail';
import type { TailEntry } from './log-tail';
import {
  parseApplicationLine,
  parseBitcoinCoreLine,
  parseConsoleLine,
  parseFulcrumLine,
  parseShellLine,
  parseTorLine,
} from './parsers';
import type { LineParser } from './parsers';

// The log centre's sources and queries (specification section 20): BTCortex's
// own logs and the logs of every node whose files are on this computer, read
// incrementally, filtered, merged by time and returned newest first.

export const ORCHESTRATOR_LOG_FILE = 'orchestrator.log';
export const SHELL_LOG_FILE = 'shell.log';
/** Written by tor itself: BTCortex sends its output there. */
export const TOR_LOG_FILE = 'tor.log';

const DEFAULT_WINDOW_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES_PER_SOURCE = 20_000;

const SEVERITY_RANK: Record<LogSeverity, number> = { error: 0, warning: 1, info: 2, debug: 3 };

const PARSERS: Record<LogSourceKind, LineParser> = {
  application: parseApplicationLine,
  shell: parseShellLine,
  'bitcoin-core': parseBitcoinCoreLine,
  'bitcoin-core-console': parseConsoleLine,
  tor: parseTorLine,
  fulcrum: parseFulcrumLine,
};

export interface LogServiceOptions {
  paths: AppPaths;
  nodes: Pick<NodeManager, 'list'>;
  /** The log files of the Electrum servers set up for nodes. */
  electrumLogs?: () => { nodeId: string; path: string }[];
  windowBytes?: number;
}

interface SourceLocation {
  id: string;
  kind: LogSourceKind;
  path: string;
  nodeId?: string;
  nodeName?: string;
}

function describe(location: SourceLocation): LogSource {
  let info;
  try {
    info = statSync(location.path);
  } catch {
    info = undefined;
  }
  return {
    id: location.id,
    kind: location.kind,
    ...(location.nodeId === undefined ? {} : { nodeId: location.nodeId }),
    ...(location.nodeName === undefined ? {} : { nodeName: location.nodeName }),
    path: location.path,
    exists: info !== undefined,
    sizeBytes: info?.size ?? 0,
    ...(info ? { modifiedAt: info.mtime.toISOString() } : {}),
  };
}

function matchesSearch(entry: TailEntry, term: string): boolean {
  if (entry.message.toLowerCase().includes(term)) return true;
  if (entry.component?.toLowerCase().includes(term)) return true;
  return entry.context !== undefined && JSON.stringify(entry.context).toLowerCase().includes(term);
}

export class LogService {
  private readonly tails = new Map<string, LogTail>();
  private readonly windowBytes: number;

  constructor(private readonly options: LogServiceOptions) {
    this.windowBytes = options.windowBytes ?? DEFAULT_WINDOW_BYTES;
  }

  private locations(): SourceLocation[] {
    const locations: SourceLocation[] = [
      { id: 'btcortex', kind: 'application', path: join(this.options.paths.logs, ORCHESTRATOR_LOG_FILE) },
      { id: 'shell', kind: 'shell', path: join(this.options.paths.logs, SHELL_LOG_FILE) },
      { id: 'tor', kind: 'tor', path: join(this.options.paths.logs, TOR_LOG_FILE) },
    ];
    const names = new Map(this.options.nodes.list().map(({ profile }) => [profile.id, profile.name]));
    for (const { nodeId, path } of this.options.electrumLogs?.() ?? []) {
      const nodeName = names.get(nodeId);
      locations.push({
        id: `electrum:${nodeId}`,
        kind: 'fulcrum',
        path,
        nodeId,
        ...(nodeName === undefined ? {} : { nodeName }),
      });
    }
    for (const { profile } of this.options.nodes.list()) {
      const root = localDataDirectory(profile);
      if (root === undefined) continue;
      const node = { nodeId: profile.id, nodeName: profile.name };
      locations.push({
        id: `node:${profile.id}:debug`,
        kind: 'bitcoin-core',
        path: debugLogPath(root, profile.network),
        ...node,
      });
      if (profile.execution === 'managed') {
        locations.push({
          id: `node:${profile.id}:console`,
          kind: 'bitcoin-core-console',
          path: consoleLogPath(root, profile.network),
          ...node,
        });
      }
    }
    return locations;
  }

  sources(): LogSource[] {
    return this.locations().map(describe);
  }

  async read(query: LogQuery): Promise<LogPage> {
    const wanted = new Set(query.sourceIds);
    const minimum = SEVERITY_RANK[query.minimumSeverity];
    const term = query.search?.trim().toLowerCase() ?? '';
    const since = query.since === undefined ? undefined : Date.parse(query.since);
    const until = query.until === undefined ? undefined : Date.parse(query.until);

    const matches: { sourceId: string; entry: TailEntry; at: number }[] = [];
    for (const location of this.locations()) {
      if (!wanted.has(location.id)) continue;
      for (const entry of await this.tailFor(location).read()) {
        if (SEVERITY_RANK[entry.severity] > minimum) continue;
        const at = Date.parse(entry.time);
        if (since !== undefined && at < since) continue;
        if (until !== undefined && at > until) continue;
        if (term !== '' && !matchesSearch(entry, term)) continue;
        matches.push({ sourceId: location.id, entry, at });
      }
    }
    // Newest first; within the same moment, later lines first.
    matches.sort((a, b) => b.at - a.at || b.entry.offset - a.entry.offset);
    const entries: LogEntry[] = matches.slice(0, query.limit).map(({ sourceId, entry }) => ({
      id: `${sourceId}:${String(entry.offset)}`,
      sourceId,
      time: entry.time,
      timeEstimated: entry.timeEstimated,
      severity: entry.severity,
      ...(entry.component === undefined ? {} : { component: entry.component }),
      message: entry.message,
      ...(entry.context === undefined ? {} : { context: entry.context }),
    }));
    return { entries, limited: matches.length > query.limit, windowBytes: this.windowBytes };
  }

  private tailFor(location: SourceLocation): LogTail {
    const existing = this.tails.get(location.id);
    if (existing?.path === location.path) return existing;
    const tail = new LogTail(location.path, PARSERS[location.kind], {
      windowBytes: this.windowBytes,
      maxEntries: MAX_ENTRIES_PER_SOURCE,
    });
    this.tails.set(location.id, tail);
    return tail;
  }
}
