import { z } from 'zod';
import { ServiceHealthSchema } from './catalogue';

// Monitoring and alerts (specification section 19): the health of everything
// BTCortex runs or connects to in one summary, the computer's resources, their
// history, and alerts raised when something needs attention and resolved when
// it no longer does.

export const AlertSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertSchema = z.object({
  /** The rule and what it is about, for example `node.unreachable:<node id>`; stable while the condition lasts. */
  id: z.string(),
  rule: z.string(),
  severity: AlertSeveritySchema,
  component: z.string(),
  title: z.string(),
  message: z.string(),
  /** Where in BTCortex to look, for example `/nodes/<id>`. */
  route: z.string().nullable(),
  raisedAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  acknowledgedAt: z.string().nullable(),
  /**
   * Whether the alert reports something that happened (a setting changed)
   * rather than a lasting condition; it is resolved once marked as seen.
   */
  clearsWhenSeen: z.boolean(),
});
export type Alert = z.infer<typeof AlertSchema>;

export const HealthServiceSchema = z.object({
  id: z.enum(['nodes', 'tor', 'electrum', 'lightning', 'payments', 'backups']),
  health: ServiceHealthSchema,
  summary: z.string(),
  route: z.string(),
});
export type HealthService = z.infer<typeof HealthServiceSchema>;

export const VolumeUsageSchema = z.object({
  root: z.string(),
  freeBytes: z.number(),
  totalBytes: z.number(),
  /** What BTCortex keeps there, for example "BTCortex's data" or a node's name. */
  uses: z.array(z.string()),
});
export type VolumeUsage = z.infer<typeof VolumeUsageSchema>;

/** Disk and network activity of the whole computer over the last minute; null until measured twice. */
export const ActivitySchema = z.object({
  /** The busiest disk's share of time spent on reads and writes. */
  diskBusyPercent: z.number().nullable(),
  diskReadBytesPerSecond: z.number().nullable(),
  diskWriteBytesPerSecond: z.number().nullable(),
  networkInBytesPerSecond: z.number().nullable(),
  networkOutBytesPerSecond: z.number().nullable(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const RecentErrorSchema = z.object({ at: z.string(), component: z.string(), message: z.string() });
export type RecentError = z.infer<typeof RecentErrorSchema>;

export const HealthSummarySchema = z.object({
  checkedAt: z.string(),
  overall: z.enum(['healthy', 'attention', 'failed', 'unknown']),
  services: z.array(HealthServiceSchema),
  resources: z.object({
    /** Share of all processors busy over the last check interval; null until two samples exist. */
    cpuPercent: z.number().nullable(),
    memoryUsedBytes: z.number(),
    memoryTotalBytes: z.number(),
    volumes: z.array(VolumeUsageSchema),
    activity: ActivitySchema,
  }),
  alerts: z.object({ open: z.number().int(), critical: z.number().int(), warning: z.number().int() }),
  /** Errors BTCortex logged in the last 24 hours, the latest first. */
  recentErrors: z.object({ count: z.number().int(), latest: z.array(RecentErrorSchema) }),
});
export type HealthSummary = z.infer<typeof HealthSummarySchema>;

/** Metrics measured for the whole computer. */
export const SystemMetricSchema = z.enum([
  'system.cpu',
  'system.memory',
  'system.disk-busy',
  'system.disk-read',
  'system.disk-write',
  'system.network-in',
  'system.network-out',
]);
export type SystemMetric = z.infer<typeof SystemMetricSchema>;

/** Metrics measured for each Bitcoin node; their series are named `<metric>:<node id>`. */
export const NodeMetricSchema = z.enum([
  'node.peers',
  'node.mempool-transactions',
  'node.mempool-size',
  'node.traffic-in',
  'node.traffic-out',
  'node.sync',
  'node.size',
]);
export type NodeMetric = z.infer<typeof NodeMetricSchema>;

export const MetricKindSchema = z.enum([...SystemMetricSchema.options, ...NodeMetricSchema.options]);
export type MetricKind = z.infer<typeof MetricKindSchema>;

/** Series kept in the metrics history: a computer metric, or a node metric with the node's id. */
export const MetricSeriesSchema = z.union([
  SystemMetricSchema,
  z.templateLiteral([NodeMetricSchema, ':', z.string().regex(/^[\w-]+$/)]),
]);
export type MetricSeries = z.infer<typeof MetricSeriesSchema>;

export const MetricUnitSchema = z.enum(['percent', 'bytes-per-second', 'count', 'virtual-bytes', 'bytes']);
export type MetricUnit = z.infer<typeof MetricUnitSchema>;

export const METRIC_UNITS: Readonly<Record<MetricKind, MetricUnit>> = {
  'system.cpu': 'percent',
  'system.memory': 'percent',
  'system.disk-busy': 'percent',
  'system.disk-read': 'bytes-per-second',
  'system.disk-write': 'bytes-per-second',
  'system.network-in': 'bytes-per-second',
  'system.network-out': 'bytes-per-second',
  'node.peers': 'count',
  'node.mempool-transactions': 'count',
  'node.mempool-size': 'virtual-bytes',
  'node.traffic-in': 'bytes-per-second',
  'node.traffic-out': 'bytes-per-second',
  'node.sync': 'percent',
  'node.size': 'bytes',
};

export function nodeSeries(metric: NodeMetric, nodeId: string): MetricSeries {
  return `${metric}:${nodeId}`;
}

/** The metric a series measures and, for node metrics, the node's id. */
export function describeSeries(series: MetricSeries): { kind: MetricKind; nodeId: string | null } {
  const separator = series.indexOf(':');
  if (separator === -1) return { kind: series as SystemMetric, nodeId: null };
  return { kind: series.slice(0, separator) as NodeMetric, nodeId: series.slice(separator + 1) };
}

export const MetricHistorySchema = z.object({
  series: MetricSeriesSchema,
  /** Minute samples while they are kept, hourly averages beyond. */
  resolution: z.enum(['minute', 'hour']),
  points: z.array(z.object({ at: z.string(), value: z.number() })),
});
export type MetricHistory = z.infer<typeof MetricHistorySchema>;

export const MonitoringSettingsSchema = z.object({
  /** How long minute samples are kept before they are folded into hourly averages. */
  detailedHours: z.number().int().min(6).max(168),
  /** How long hourly averages are kept. */
  historyDays: z.number().int().min(7).max(365),
  /** Free space on a disk BTCortex uses below which it warns, and below which the alert turns critical. */
  diskWarningGiB: z.number().int().min(1).max(10_000),
  diskCriticalGiB: z.number().int().min(1).max(10_000),
  /** Memory or processor use that, held for ten minutes or more, raises an alert; null for never. */
  resourceWarningPercent: z.number().int().min(50).max(99).nullable(),
  /** Which new alerts appear as Windows notifications. */
  desktopNotifications: z.enum(['all', 'critical', 'off']),
});
export type MonitoringSettings = z.infer<typeof MonitoringSettingsSchema>;

export const ConfigureMonitoringParamsSchema = MonitoringSettingsSchema.partial()
  .strict()
  .refine(
    (settings) =>
      settings.diskWarningGiB === undefined ||
      settings.diskCriticalGiB === undefined ||
      settings.diskCriticalGiB < settings.diskWarningGiB,
    { message: 'The critical free space must be below the warning level.', path: ['diskCriticalGiB'] },
  );
export type ConfigureMonitoringParams = z.infer<typeof ConfigureMonitoringParamsSchema>;

export const MonitoringExportParamsSchema = z.discriminatedUnion('kind', [
  z
    .object({
      /** The chosen series side by side as CSV, one row per sample time. */
      kind: z.literal('metrics'),
      series: z.array(MetricSeriesSchema).min(1).max(20),
      hours: z
        .number()
        .int()
        .min(1)
        .max(24 * 365),
    })
    .strict(),
  z
    .object({
      /** A plain-text report: health, alerts, and the minimum, average and maximum of every series. */
      kind: z.literal('report'),
      hours: z
        .number()
        .int()
        .min(1)
        .max(24 * 365),
    })
    .strict(),
]);
export type MonitoringExportParams = z.infer<typeof MonitoringExportParamsSchema>;

export const MonitoringExportSchema = z.object({ path: z.string(), createdAt: z.string(), sizeBytes: z.number() });
export type MonitoringExport = z.infer<typeof MonitoringExportSchema>;

export const AlertsChangedSchema = z.object({
  raised: z.array(AlertSchema),
  resolved: z.array(AlertSchema),
  open: z.number().int(),
});
export type AlertsChanged = z.infer<typeof AlertsChangedSchema>;
