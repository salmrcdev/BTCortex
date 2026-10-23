import { Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { describeSeries, METRIC_UNITS, nodeSeries, NodeMetricSchema, SystemMetricSchema } from '@btcortex/contracts';
import type { MetricKind, MetricSeries, MetricUnit } from '@btcortex/contracts';
import { toast } from 'sonner';
import { niceMaximum } from '@/components/charts/chart-scale';
import { LineChart } from '@/components/charts/line-chart';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { useNodes } from '@/features/nodes/queries';
import {
  formatBytes,
  formatBytesAxis,
  formatClockTime,
  formatCompact,
  formatDayMonth,
  formatNumber,
  formatPercent,
  formatRate,
  formatTimestamp,
  formatVirtualBytes,
  formatVirtualBytesAxis,
} from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useExportMonitoring, useMetricHistory, useMonitoringSettings, useRevealExport } from './queries';
import { RANGES } from './search';
import type { RangeHours } from './search';

// The history of the recorded metrics (specification section 19.1): a period
// from an hour to a year, up to four metrics compared as small multiples on
// one time scale (never two scales on one chart), and the chosen metrics
// exported as CSV.

export { RANGES } from './search';
export type { RangeHours } from './search';
export const MAX_COMPARED = 4;
export const DEFAULT_SERIES: readonly MetricSeries[] = ['system.cpu', 'system.memory'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function durationLabel(t: TFunction, hours: number): string {
  return hours < 48
    ? t('monitoring.duration.hours', { count: hours })
    : t('monitoring.duration.days', { count: hours / 24 });
}

interface UnitFormat {
  value: (value: number) => string;
  tick: (value: number, maximum: number) => string;
  /** A fixed top of the axis, or how to round the largest value up to one. */
  maximum?: number | ((largest: number) => number);
}

/** A round axis top in binary units, so that rate ticks read "3 KiB/s" rather than "2.9 KiB/s". */
function binaryMaximum(largest: number): number {
  let scale = 1;
  while (largest / scale >= 1024) scale *= 1024;
  return niceMaximum(largest / scale) * scale;
}

const UNIT_FORMATS: Record<MetricUnit, UnitFormat> = {
  percent: {
    value: (value) => formatPercent(value / 100, value < 10 ? 1 : 0),
    tick: (value) => formatPercent(value / 100),
    maximum: 100,
  },
  'bytes-per-second': {
    value: formatRate,
    tick: (value, maximum) => `${formatBytesAxis(value, maximum)}/s`,
    maximum: binaryMaximum,
  },
  'virtual-bytes': { value: (value) => formatVirtualBytes(value), tick: formatVirtualBytesAxis },
  bytes: { value: (value) => formatBytes(value), tick: formatBytesAxis, maximum: binaryMaximum },
  count: { value: (value) => formatNumber(value, { maximumFractionDigits: 1 }), tick: (value) => formatCompact(value) },
};

/** The time now, refreshed every minute, so that the charts move on together. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, MINUTE);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

function metricName(t: TFunction, kind: MetricKind): string {
  return t(`monitoring.history.metrics.${kind}`);
}

export function useSeriesTitle(): (series: MetricSeries) => string {
  const { t } = useTranslation();
  const nodes = useNodes();
  return (series) => {
    const { kind, nodeId } = describeSeries(series);
    if (nodeId === null) return metricName(t, kind);
    const name = nodes.data?.find((node) => node.profile.id === nodeId)?.profile.name ?? nodeId;
    return t('monitoring.history.nodeMetric', { node: name, metric: metricName(t, kind) });
  };
}

function MetricChart({
  series,
  title,
  hours,
  now,
}: {
  series: MetricSeries;
  title: string;
  hours: number;
  now: number;
}) {
  const { t } = useTranslation();
  const history = useMetricHistory(series, hours);
  const format = UNIT_FORMATS[METRIC_UNITS[describeSeries(series).kind]];
  const points = useMemo(
    () => (history.data?.points ?? []).map((point) => ({ x: Date.parse(point.at), y: point.value })),
    [history.data],
  );
  const latest = points.at(-1);
  const maximum =
    typeof format.maximum === 'function'
      ? format.maximum(Math.max(0, ...points.map((point) => point.y)))
      : format.maximum;
  return (
    <section aria-label={title} className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground tabular">
          {latest && t('monitoring.history.latest', { value: format.value(latest.y) })}
          {history.data?.resolution === 'hour' && ` · ${t('monitoring.history.hourly')}`}
        </p>
      </div>
      {history.isError ? (
        <ErrorPanel title={title} error={toOrchestratorError(history.error)} onRetry={() => void history.refetch()} />
      ) : !history.data ? (
        <Skeleton className="h-[220px]" />
      ) : points.length === 0 ? (
        <p className="text-muted-foreground">{t('monitoring.history.empty')}</p>
      ) : (
        <LineChart
          title={title}
          points={points}
          formatY={format.value}
          formatTick={format.tick}
          formatX={hours <= 48 ? formatClockTime : formatDayMonth}
          formatXLong={(time) => formatTimestamp(new Date(time))}
          xHeading={t('monitoring.history.time')}
          yHeading={title}
          domain={[now - hours * HOUR, now]}
          gapMs={history.data.resolution === 'minute' ? 3 * MINUTE : 3 * HOUR}
          {...(maximum === undefined ? {} : { maximum })}
        />
      )}
    </section>
  );
}

function SeriesChooser({
  selected,
  onChange,
}: {
  selected: readonly MetricSeries[];
  onChange: (series: MetricSeries[]) => void;
}) {
  const { t } = useTranslation();
  const nodes = useNodes();
  const groups = [
    {
      id: 'computer',
      label: t('monitoring.history.computer'),
      series: [...SystemMetricSchema.options] as MetricSeries[],
    },
    ...(nodes.data ?? []).map((node) => ({
      id: node.profile.id,
      label: node.profile.name,
      series: NodeMetricSchema.options.map((metric) => nodeSeries(metric, node.profile.id)),
    })),
  ];
  const full = selected.length >= MAX_COMPARED;
  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{t('monitoring.history.choose')}</p>
        <p className="text-xs text-muted-foreground">{t('monitoring.history.chooseHint')}</p>
      </div>
      {groups.map((group) => (
        <fieldset key={group.id} className="space-y-1">
          <legend className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {group.label}
          </legend>
          {group.series.map((series) => {
            const checked = selected.includes(series);
            return (
              <label key={series} className="flex items-start gap-2">
                <Checkbox
                  checked={checked}
                  // One metric always stays chosen; a fifth waits until one is cleared.
                  disabled={checked ? selected.length === 1 : full}
                  onChange={() => {
                    onChange(checked ? selected.filter((other) => other !== series) : [...selected, series]);
                  }}
                />
                <span>{metricName(t, describeSeries(series).kind)}</span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

export function HistoryCard({
  range,
  series,
  onRangeChange,
  onSeriesChange,
}: {
  range: RangeHours;
  series: readonly MetricSeries[];
  onRangeChange: (range: RangeHours) => void;
  onSeriesChange: (series: MetricSeries[]) => void;
}) {
  const { t } = useTranslation();
  const settings = useMonitoringSettings();
  const exporting = useExportMonitoring();
  const reveal = useRevealExport();
  const feedback = useErrorFeedback();
  const titleOf = useSeriesTitle();
  const now = useMinuteClock();
  const kept = (settings.data?.historyDays ?? 90) * 24;
  const ranges = RANGES.filter((hours) => hours <= Math.max(kept, 24) || hours === range);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('monitoring.history.title')}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('monitoring.history.range')}>
            {ranges.map((hours) => (
              <Button
                key={hours}
                variant={hours === range ? 'secondary' : 'ghost'}
                aria-pressed={hours === range}
                onClick={() => {
                  onRangeChange(hours);
                }}
              >
                {durationLabel(t, hours)}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            disabled={exporting.isPending}
            onClick={() => {
              exporting.mutate(
                { kind: 'metrics', series: [...series], hours: range },
                {
                  onSuccess: (result) => {
                    toast.success(t('monitoring.history.exported', { name: result.path.split(/[\\/]/).at(-1) ?? '' }), {
                      action: {
                        label: t('monitoring.history.showFile'),
                        onClick: () => {
                          reveal.mutate(result.path, { onError: feedback });
                        },
                      },
                    });
                  },
                  onError: feedback,
                },
              );
            }}
          >
            <Download aria-hidden="true" />
            {t('monitoring.history.exportCsv')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <SeriesChooser selected={series} onChange={onSeriesChange} />
          <div className="min-w-0 space-y-6">
            {series.map((name) => (
              <MetricChart
                key={`${name}-${String(range)}`}
                series={name}
                title={titleOf(name)}
                hours={range}
                now={now}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
