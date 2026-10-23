import type { RecentError } from '@btcortex/contracts';
import type { LogEntry, LogSink } from '../logging/logger';

// The errors BTCortex logged lately, for the "recent errors" figure on the
// monitoring dashboard (specification section 19). Entries reach sinks
// already redacted; only the last day's errors are kept, and only so many.

const WINDOW_MS = 24 * 60 * 60 * 1000;
const CAPACITY = 200;
const LATEST = 5;

export class RecentErrorsSink implements LogSink {
  private readonly entries: { time: number; component: string; message: string }[] = [];

  write(entry: LogEntry): void {
    if (entry.level !== 'error') return;
    this.entries.push({ time: Date.parse(entry.time), component: entry.component, message: entry.message });
    if (this.entries.length > CAPACITY) this.entries.shift();
  }

  close(): void {
    // Nothing to release.
  }

  summary(now: Date): { count: number; latest: RecentError[] } {
    const since = now.getTime() - WINDOW_MS;
    const recent = this.entries.filter((entry) => entry.time >= since);
    return {
      count: recent.length,
      latest: recent
        .slice(-LATEST)
        .reverse()
        .map((entry) => ({
          at: new Date(entry.time).toISOString(),
          component: entry.component,
          message: entry.message,
        })),
    };
  }
}
