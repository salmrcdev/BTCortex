import type { DatabaseSync } from 'node:sqlite';
import { AlertSchema } from '@btcortex/contracts';
import type { Alert, MetricHistory, MetricSeries } from '@btcortex/contracts';

// Persistence for monitoring: alerts, which stay open while their condition
// lasts, and the metrics history, kept small on purpose (specification
// section 19.1: configurable retention, no unbounded growth). Minute samples
// are kept for a while (two days unless changed); older ones are folded into
// hourly averages, kept for a longer while (90 days unless changed).

const RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ALERTS = 500;
/** Alerts about something that happened, rather than a lasting condition. */
export const EVENT_RULES: ReadonlySet<string> = new Set(['config.changed']);

export interface Retention {
  detailedHours: number;
  historyDays: number;
}

function toAlert(row: Record<string, unknown>): Alert {
  return AlertSchema.parse({
    id: row['id'],
    rule: row['rule'],
    severity: row['severity'],
    component: row['component'],
    title: row['title'],
    message: row['message'],
    route: row['route'] ?? null,
    raisedAt: row['raised_at'],
    updatedAt: row['updated_at'],
    resolvedAt: row['resolved_at'] ?? null,
    acknowledgedAt: row['acknowledged_at'] ?? null,
    clearsWhenSeen: EVENT_RULES.has(String(row['rule'])),
  });
}

export class AlertStore {
  constructor(private readonly database: DatabaseSync) {}

  open(): Alert[] {
    return this.database
      .prepare('SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY raised_at DESC')
      .all()
      .map(toAlert);
  }

  recent(since: Date): Alert[] {
    return this.database
      .prepare('SELECT * FROM alerts WHERE resolved_at IS NULL OR resolved_at >= ? ORDER BY raised_at DESC')
      .all(since.toISOString())
      .map(toAlert);
  }

  /** Alerts raised since a time, resolved or not, oldest first. */
  raisedSince(since: Date): Alert[] {
    return this.database
      .prepare('SELECT * FROM alerts WHERE raised_at >= ? ORDER BY raised_at')
      .all(since.toISOString())
      .map(toAlert);
  }

  get(id: string): Alert | undefined {
    const row = this.database.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
    return row ? toAlert(row) : undefined;
  }

  /** A new alert, or a resolved one raised again, which then starts afresh. */
  raise(
    alert: Omit<Alert, 'raisedAt' | 'updatedAt' | 'resolvedAt' | 'acknowledgedAt' | 'clearsWhenSeen'>,
    now: Date,
  ): Alert {
    const at = now.toISOString();
    this.database
      .prepare(
        `INSERT INTO alerts (id, rule, severity, component, title, message, route, raised_at, updated_at, resolved_at, acknowledged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(id) DO UPDATE SET rule = excluded.rule, severity = excluded.severity, component = excluded.component,
           title = excluded.title, message = excluded.message, route = excluded.route, raised_at = excluded.raised_at,
           updated_at = excluded.updated_at, resolved_at = NULL, acknowledged_at = NULL`,
      )
      .run(alert.id, alert.rule, alert.severity, alert.component, alert.title, alert.message, alert.route, at, at);
    const raised = this.get(alert.id);
    if (!raised) throw new Error(`Alert ${alert.id} was not stored.`);
    return raised;
  }

  /** An open alert whose wording or severity changed. */
  refresh(alert: Pick<Alert, 'id' | 'severity' | 'title' | 'message' | 'route'>, now: Date): void {
    this.database
      .prepare('UPDATE alerts SET severity = ?, title = ?, message = ?, route = ?, updated_at = ? WHERE id = ?')
      .run(alert.severity, alert.title, alert.message, alert.route, now.toISOString(), alert.id);
  }

  resolve(id: string, now: Date): Alert | undefined {
    this.database
      .prepare('UPDATE alerts SET resolved_at = ?, updated_at = ? WHERE id = ? AND resolved_at IS NULL')
      .run(now.toISOString(), now.toISOString(), id);
    return this.get(id);
  }

  acknowledge(id: string, now: Date): Alert | undefined {
    this.database
      .prepare('UPDATE alerts SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL')
      .run(now.toISOString(), id);
    return this.get(id);
  }

  prune(now: Date): void {
    this.database
      .prepare('DELETE FROM alerts WHERE resolved_at IS NOT NULL AND resolved_at < ?')
      .run(new Date(now.getTime() - RESOLVED_RETENTION_MS).toISOString());
    this.database
      .prepare(
        'DELETE FROM alerts WHERE resolved_at IS NOT NULL AND id NOT IN (SELECT id FROM alerts ORDER BY raised_at DESC LIMIT ?)',
      )
      .run(MAX_ALERTS);
  }
}

export interface SeriesStatistics {
  series: MetricSeries;
  minimum: number;
  average: number;
  maximum: number;
  samples: number;
}

export class MetricsStore {
  constructor(private readonly database: DatabaseSync) {}

  record(series: MetricSeries, at: Date, value: number): void {
    if (!Number.isFinite(value)) return;
    this.database
      .prepare(
        "INSERT INTO metric_samples (series, resolution, at, value) VALUES (?, 'minute', ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value",
      )
      .run(series, Math.floor(at.getTime() / 1000), value);
  }

  /** Folds minute samples past their retention into hourly averages and drops hourly ones past theirs. */
  compact(now: Date, retention: Retention): void {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const cutoff = nowSeconds - retention.detailedHours * 3600;
    // Only whole hours before the cut-off are folded, so an hour is never averaged from part of its samples.
    const foldBefore = cutoff - (cutoff % 3600);
    this.database
      .prepare(
        `INSERT INTO metric_samples (series, resolution, at, value)
         SELECT series, 'hour', at - (at % 3600) AS hour, AVG(value)
         FROM metric_samples WHERE resolution = 'minute' AND at < ?
         GROUP BY series, hour
         ON CONFLICT DO UPDATE SET value = excluded.value`,
      )
      .run(foldBefore);
    this.database.prepare("DELETE FROM metric_samples WHERE resolution = 'minute' AND at < ?").run(foldBefore);
    this.database
      .prepare("DELETE FROM metric_samples WHERE resolution = 'hour' AND at < ?")
      .run(nowSeconds - retention.historyDays * 24 * 3600);
  }

  /** Drops the history of nodes that are no longer in BTCortex. */
  forgetNodesExcept(nodeIds: readonly string[]): void {
    const keep = new Set(nodeIds);
    const rows = this.database
      .prepare("SELECT DISTINCT series FROM metric_samples WHERE series LIKE 'node.%'")
      .all()
      .map((row) => String(row['series']));
    const remove = this.database.prepare('DELETE FROM metric_samples WHERE series = ?');
    for (const series of rows) {
      if (!keep.has(series.slice(series.indexOf(':') + 1))) remove.run(series);
    }
  }

  /** Every series with samples since a time. */
  seriesSince(since: Date): MetricSeries[] {
    return this.database
      .prepare('SELECT DISTINCT series FROM metric_samples WHERE at >= ? ORDER BY series')
      .all(Math.floor(since.getTime() / 1000))
      .map((row) => String(row['series']) as MetricSeries);
  }

  history(series: MetricSeries, hours: number, now: Date, detailedHours: number): MetricHistory {
    const from = Math.floor(now.getTime() / 1000) - hours * 3600;
    const resolution = hours <= detailedHours ? 'minute' : 'hour';
    const rows = this.database
      .prepare(
        resolution === 'minute'
          ? "SELECT at, value FROM metric_samples WHERE series = ? AND resolution = 'minute' AND at >= ? ORDER BY at"
          : // Recent minutes not folded yet are averaged per hour on the fly.
            `SELECT at, value FROM metric_samples WHERE series = ?1 AND resolution = 'hour' AND at >= ?2
             UNION ALL
             SELECT at - (at % 3600) AS at, AVG(value) FROM metric_samples
             WHERE series = ?1 AND resolution = 'minute' AND at >= ?2 GROUP BY at - (at % 3600)
             ORDER BY at`,
      )
      .all(series, from);
    return {
      series,
      resolution,
      points: rows.map((row) => ({
        at: new Date(Number(row['at']) * 1000).toISOString(),
        value: Number(row['value']),
      })),
    };
  }

  /** Several series side by side, one row per sample time, with null where a series has no sample. */
  table(
    series: readonly MetricSeries[],
    hours: number,
    now: Date,
    detailedHours: number,
  ): { at: string; values: (number | null)[] }[] {
    const rows = new Map<string, (number | null)[]>();
    series.forEach((name, column) => {
      for (const point of this.history(name, hours, now, detailedHours).points) {
        const row = rows.get(point.at) ?? series.map(() => null);
        row[column] = point.value;
        rows.set(point.at, row);
      }
    });
    return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([at, values]) => ({ at, values }));
  }

  statistics(hours: number, now: Date, detailedHours: number): SeriesStatistics[] {
    return this.seriesSince(new Date(now.getTime() - hours * 3600 * 1000)).flatMap((series) => {
      const values = this.history(series, hours, now, detailedHours).points.map((point) => point.value);
      if (values.length === 0) return [];
      return [
        {
          series,
          minimum: Math.min(...values),
          average: values.reduce((sum, value) => sum + value, 0) / values.length,
          maximum: Math.max(...values),
          samples: values.length,
        },
      ];
    });
  }
}
