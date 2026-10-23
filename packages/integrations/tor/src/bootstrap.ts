import { parseArguments } from './control';

// Bootstrap reports, from `GETINFO status/bootstrap-phase` and from
// STATUS_CLIENT events (privacy-networking.md §2.12). Only the tags "starting"
// and "done" are guaranteed to exist in future tor versions, so the interface
// shows tor's own summary and the progress, and tags serve diagnosis only.

export interface BootstrapStatus {
  progress: number;
  tag: string;
  summary: string;
  /** NOTICE while bootstrapping normally, WARN or ERR for problem reports. */
  severity: string;
  /** Present on problem reports. */
  warning?: string;
  reason?: string;
  /** tor says `ignore` for the first problem reports of a phase and `warn` once they persist. */
  recommendation?: 'ignore' | 'warn';
  count?: number;
  host?: string;
}

/** Parses `NOTICE BOOTSTRAP PROGRESS=… TAG=… SUMMARY="…"`, the same text in both sources. */
export function parseBootstrapStatus(text: string): BootstrapStatus | undefined {
  const { positional, keywords } = parseArguments(text);
  if (positional[1] !== 'BOOTSTRAP') return undefined;
  const progress = Number(keywords.get('PROGRESS'));
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) return undefined;
  const recommendation = keywords.get('RECOMMENDATION');
  const count = Number(keywords.get('COUNT'));
  const warning = keywords.get('WARNING');
  const reason = keywords.get('REASON');
  const host = keywords.get('HOST');
  return {
    progress,
    tag: keywords.get('TAG') ?? '',
    summary: keywords.get('SUMMARY') ?? '',
    severity: positional[0] ?? 'NOTICE',
    ...(warning === undefined ? {} : { warning }),
    ...(reason === undefined ? {} : { reason }),
    ...(host === undefined ? {} : { host }),
    ...(recommendation === 'ignore' || recommendation === 'warn' ? { recommendation } : {}),
    ...(Number.isInteger(count) && count > 0 ? { count } : {}),
  };
}
