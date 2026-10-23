import type { MetricsPoint, NodeSnapshot } from '@btcortex/contracts';

// Short history of a node's figures for trend charts (specification sections
// 5.9 and 19.1): one sample per minute, the last 24 hours, in memory while
// BTCortex runs. Persistent history and longer periods are separate work.

const MINUTE_MS = 60_000;
const KEPT_MINUTES = 24 * 60;
/** BTC/kvB to sat/vB. */
const BTC_PER_KVB_IN_SAT_PER_VB = 100_000;

export class MetricsHistory {
  private readonly points: MetricsPoint[] = [];

  /** Keeps the latest snapshot of each minute. */
  record(snapshot: NodeSnapshot): void {
    const at = Date.parse(snapshot.takenAt);
    const minute = Math.floor(at / MINUTE_MS) * MINUTE_MS;
    const point: MetricsPoint = {
      at: new Date(minute).toISOString(),
      blocks: snapshot.blockchain.blocks,
      peers: snapshot.network.connections,
      mempoolTransactions: snapshot.mempool.transactions,
      mempoolVirtualBytes: snapshot.mempool.virtualBytes,
      mempoolMinimumFeeSatPerVb:
        Math.round(snapshot.mempool.minimumFeeBtcPerKvB * BTC_PER_KVB_IN_SAT_PER_VB * 1000) / 1000,
    };
    const last = this.points.at(-1);
    if (last?.at === point.at) this.points[this.points.length - 1] = point;
    else this.points.push(point);
    const oldest = minute - KEPT_MINUTES * MINUTE_MS;
    while ((this.points[0] && Date.parse(this.points[0].at) <= oldest) || this.points.length > KEPT_MINUTES) {
      this.points.shift();
    }
  }

  list(): MetricsPoint[] {
    return [...this.points];
  }
}
