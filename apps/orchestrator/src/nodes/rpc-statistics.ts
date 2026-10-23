import type { RpcCallStatistics } from '@btcortex/bitcoin-rpc';
import type { RpcStatistic } from '@btcortex/contracts';

// RPC performance statistics per node (specification section 5.7): how often
// BTCortex called each method, how long it took and how often it failed.

interface Totals {
  calls: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

export class RpcStatistics {
  private readonly totals = new Map<string, Totals>();

  record({ method, durationMs, ok }: RpcCallStatistics): void {
    const totals = this.totals.get(method) ?? { calls: 0, errors: 0, totalMs: 0, maxMs: 0 };
    totals.calls += 1;
    if (!ok) totals.errors += 1;
    totals.totalMs += durationMs;
    totals.maxMs = Math.max(totals.maxMs, durationMs);
    this.totals.set(method, totals);
  }

  /** Most called first. */
  list(): RpcStatistic[] {
    return [...this.totals]
      .map(([method, totals]) => ({
        method,
        calls: totals.calls,
        errors: totals.errors,
        averageMs: Math.round((totals.totalMs / totals.calls) * 10) / 10,
        maxMs: Math.round(totals.maxMs * 10) / 10,
      }))
      .sort((a, b) => b.calls - a.calls || a.method.localeCompare(b.method, 'en'));
  }
}
