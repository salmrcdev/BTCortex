import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { LogSeverity } from '@btcortex/contracts';
import { callOrchestrator } from '@/lib/orchestrator';

/** Live viewing reads only what was appended, so a short interval is cheap. */
const LIVE_REFRESH_MS = 2_000;
const SOURCES_REFRESH_MS = 15_000;

export interface LogFilters {
  sourceIds: string[];
  minimumSeverity: LogSeverity;
  search: string;
  /** How far back to look; `undefined` for everything still in the files' recent window. */
  periodMs: number | undefined;
  limit: number;
}

export const logKeys = {
  sources: ['logs', 'sources'] as const,
  entries: (filters: LogFilters) => ['logs', 'entries', filters] as const,
};

export function useLogSources() {
  return useQuery({
    queryKey: logKeys.sources,
    queryFn: () => callOrchestrator('logs.sources', {}),
    refetchInterval: SOURCES_REFRESH_MS,
  });
}

export function useLogEntries(filters: LogFilters, live: boolean) {
  return useQuery({
    queryKey: logKeys.entries(filters),
    queryFn: () =>
      callOrchestrator('logs.read', {
        sourceIds: filters.sourceIds,
        minimumSeverity: filters.minimumSeverity,
        ...(filters.search.trim() === '' ? {} : { search: filters.search.trim() }),
        // The period is resolved when the request is made, so live views keep moving forward.
        ...(filters.periodMs === undefined ? {} : { since: new Date(Date.now() - filters.periodMs).toISOString() }),
        limit: filters.limit,
      }),
    enabled: filters.sourceIds.length > 0,
    refetchInterval: live ? LIVE_REFRESH_MS : false,
    placeholderData: keepPreviousData,
  });
}

export function useCreateBundle() {
  return useMutation({
    mutationFn: () => callOrchestrator('diagnostics.createBundle', {}, { timeoutMs: 120_000 }),
  });
}

export function useRevealBundle() {
  return useMutation({
    mutationFn: (path: string) => callOrchestrator('diagnostics.revealBundle', { path }),
  });
}
