import { Link } from '@tanstack/react-router';
import { Bell, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Activity, Alert } from '@btcortex/contracts';
import { capacityTone, Meter } from '@/components/data/meter';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatBytes,
  formatLogTime,
  formatPercent,
  formatRate,
  formatRelativeTime,
  formatTimestamp,
} from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { cn } from '@/lib/utils';
import { useAcknowledgeAlert, useAlerts, useHealth } from './queries';

// Monitoring at a glance (specification section 19): how everything is
// doing, the computer's resources, the alerts that need attention and the
// errors BTCortex logged lately. Shown on the overview and the monitoring page.

const OVERALL_TONE = { healthy: 'healthy', attention: 'attention', failed: 'failed', unknown: 'unknown' } as const;

const ACTIVITY_ROWS = [
  ['diskRead', 'diskReadBytesPerSecond'],
  ['diskWrite', 'diskWriteBytesPerSecond'],
  ['networkIn', 'networkInBytesPerSecond'],
  ['networkOut', 'networkOutBytesPerSecond'],
] as const satisfies readonly (readonly [string, keyof Activity])[];

function SeverityIcon({ severity }: { severity: Alert['severity'] }) {
  if (severity === 'critical') return <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />;
  if (severity === 'warning')
    return <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />;
  return <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />;
}

function ActivityFigures({ activity }: { activity: Activity }) {
  const { t } = useTranslation();
  const busy = activity.diskBusyPercent;
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('monitoring.activity.label')}
      </p>
      <div className="space-y-1">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t('monitoring.activity.diskBusy')}</dt>
          <dd className="tabular">{busy === null ? t('monitoring.measuring') : formatPercent(busy / 100)}</dd>
        </div>
        {busy !== null && (
          <Meter
            value={busy / 100}
            tone={capacityTone(busy / 100)}
            label={t('monitoring.activity.diskBusy')}
            valueText={formatPercent(busy / 100)}
          />
        )}
      </div>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {ACTIVITY_ROWS.map(([label, field]) => {
          const value = activity[field];
          return (
            <div key={field} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t(`monitoring.activity.${label}`)}</dt>
              <dd className="tabular">{value === null ? '—' : formatRate(value)}</dd>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function HealthCard({ showLink = false }: { showLink?: boolean }) {
  const { t } = useTranslation();
  const health = useHealth();
  const summary = health.data;
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>{t('monitoring.title')}</CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          {summary && (
            <StatusIndicator tone={OVERALL_TONE[summary.overall]} label={t(`monitoring.overall.${summary.overall}`)} />
          )}
          {showLink && (
            <Button asChild variant="outline">
              <Link to="/monitoring">{t('monitoring.openMonitoring')}</Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {health.isError ? (
          <ErrorPanel
            title={t('monitoring.healthFailed')}
            error={toOrchestratorError(health.error)}
            onRetry={() => void health.refetch()}
          />
        ) : !summary ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <ul className="space-y-2" aria-label={t('monitoring.servicesLabel')}>
              {summary.services.map((service) => (
                <li key={service.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <a href={`#${service.route}`} className="font-medium underline-offset-2 hover:underline">
                    {t(`monitoring.services.${service.id}`)}
                  </a>
                  <span className="flex min-w-0 items-center gap-2 text-right">
                    <StatusIndicator tone={service.health} label={service.summary} className="text-sm" />
                  </span>
                </li>
              ))}
            </ul>
            <dl className="space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('monitoring.cpu')}</dt>
                  <dd className="tabular">
                    {summary.resources.cpuPercent === null
                      ? t('monitoring.measuring')
                      : formatPercent(summary.resources.cpuPercent / 100)}
                  </dd>
                </div>
                {summary.resources.cpuPercent !== null && (
                  <Meter
                    value={summary.resources.cpuPercent / 100}
                    tone={capacityTone(summary.resources.cpuPercent / 100)}
                    label={t('monitoring.cpu')}
                    valueText={formatPercent(summary.resources.cpuPercent / 100)}
                  />
                )}
              </div>
              <div className="space-y-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('monitoring.memory')}</dt>
                  <dd className="tabular">
                    {t('monitoring.memoryValue', {
                      used: formatBytes(summary.resources.memoryUsedBytes),
                      total: formatBytes(summary.resources.memoryTotalBytes),
                    })}
                  </dd>
                </div>
                <Meter
                  value={summary.resources.memoryUsedBytes / Math.max(summary.resources.memoryTotalBytes, 1)}
                  tone={capacityTone(
                    summary.resources.memoryUsedBytes / Math.max(summary.resources.memoryTotalBytes, 1),
                  )}
                  label={t('monitoring.memory')}
                  valueText={formatBytes(summary.resources.memoryUsedBytes)}
                />
              </div>
              {summary.resources.volumes.map((volume) => {
                const used = 1 - volume.freeBytes / Math.max(volume.totalBytes, 1);
                return (
                  <div key={volume.root} className="space-y-1">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">
                        {t('monitoring.disk', { root: volume.root, uses: volume.uses.join(', ') })}
                      </dt>
                      <dd className="tabular">{t('monitoring.diskFree', { free: formatBytes(volume.freeBytes) })}</dd>
                    </div>
                    <Meter
                      value={used}
                      tone={capacityTone(used)}
                      label={t('monitoring.disk', { root: volume.root, uses: volume.uses.join(', ') })}
                      valueText={t('monitoring.diskFree', { free: formatBytes(volume.freeBytes) })}
                    />
                  </div>
                );
              })}
              <ActivityFigures activity={summary.resources.activity} />
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  const { t } = useTranslation();
  const acknowledge = useAcknowledgeAlert();
  const feedback = useErrorFeedback();
  const resolved = alert.resolvedAt !== null;
  return (
    <li className={cn('flex gap-3 border-b py-3 last:border-0', resolved && 'opacity-70')}>
      <SeverityIcon severity={alert.severity} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">
          {alert.title}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{alert.component}</span>
        </p>
        <p className="text-muted-foreground">{alert.message}</p>
        <p className="text-xs text-muted-foreground">
          {resolved
            ? t('monitoring.alerts.resolvedAt', {
                time: formatRelativeTime(new Date(alert.resolvedAt ?? alert.updatedAt)),
              })
            : t('monitoring.alerts.since', { time: formatRelativeTime(new Date(alert.raisedAt)) })}
          {alert.acknowledgedAt !== null && !resolved && ` · ${t('monitoring.alerts.seen')}`}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {alert.route !== null && (
          <Button asChild variant="outline">
            <a href={`#${alert.route}`}>{t('monitoring.alerts.open')}</a>
          </Button>
        )}
        {!resolved && alert.acknowledgedAt === null && (
          <Button
            variant="ghost"
            disabled={acknowledge.isPending}
            onClick={() => {
              acknowledge.mutate(alert.id, { onError: feedback });
            }}
          >
            {alert.clearsWhenSeen ? t('monitoring.alerts.dismiss') : t('monitoring.alerts.acknowledge')}
          </Button>
        )}
      </div>
    </li>
  );
}

export function AlertsCard() {
  const { t } = useTranslation();
  const [showResolved, setShowResolved] = useState(false);
  const alerts = useAlerts(showResolved);
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>{t('monitoring.alerts.title')}</CardTitle>
        <Button
          variant="ghost"
          aria-pressed={showResolved}
          onClick={() => {
            setShowResolved(!showResolved);
          }}
        >
          {showResolved ? t('monitoring.alerts.hideResolved') : t('monitoring.alerts.showResolved')}
        </Button>
      </CardHeader>
      <CardContent>
        {alerts.isError ? (
          <ErrorPanel
            title={t('monitoring.alerts.failed')}
            error={toOrchestratorError(alerts.error)}
            onRetry={() => void alerts.refetch()}
          />
        ) : !alerts.data ? (
          <Skeleton className="h-16" />
        ) : alerts.data.length === 0 ? (
          <StatusIndicator tone="healthy" label={t('monitoring.alerts.none')} />
        ) : (
          <ul>
            {alerts.data.map((alert) => (
              <AlertRow key={`${alert.id}-${alert.raisedAt}`} alert={alert} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** The errors BTCortex logged in the last day, with the way to the full logs. */
export function RecentErrorsCard() {
  const { t } = useTranslation();
  const health = useHealth();
  const errors = health.data?.recentErrors;
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>{t('monitoring.errors.title')}</CardTitle>
        <Button asChild variant="outline">
          <Link to="/logs">{t('monitoring.errors.openLogs')}</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {health.isError ? (
          <ErrorPanel
            title={t('monitoring.healthFailed')}
            error={toOrchestratorError(health.error)}
            onRetry={() => void health.refetch()}
          />
        ) : !errors ? (
          <Skeleton className="h-12" />
        ) : errors.count === 0 ? (
          <StatusIndicator tone="healthy" label={t('monitoring.errors.none')} />
        ) : (
          <div className="space-y-2">
            <StatusIndicator tone="attention" label={t('monitoring.errors.count', { count: errors.count })} />
            <ul className="space-y-1.5">
              {errors.latest.map((error) => (
                <li
                  key={`${error.at}-${error.message}`}
                  className="grid gap-x-3 sm:grid-cols-[9rem_8rem_minmax(0,1fr)]"
                >
                  <time dateTime={error.at} title={formatTimestamp(error.at)} className="tabular text-muted-foreground">
                    {formatLogTime(error.at)}
                  </time>
                  <span className="truncate font-medium">{error.component}</span>
                  <span className="min-w-0 break-words">{error.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The bell in the status bar: open alerts that need attention, linking to the monitoring page. */
export function AlertsButton() {
  const { t } = useTranslation();
  const alerts = useAlerts(false);
  const open = (alerts.data ?? []).filter((alert) => alert.severity !== 'info');
  const critical = open.some((alert) => alert.severity === 'critical');
  return (
    <Button asChild variant="ghost" className="relative">
      <Link to="/monitoring" aria-label={t('monitoring.alerts.bell', { count: open.length })}>
        <Bell aria-hidden="true" className={cn(open.length > 0 && (critical ? 'text-danger' : 'text-warning'))} />
        {open.length > 0 && <span className="tabular text-xs font-semibold">{open.length}</span>}
      </Link>
    </Button>
  );
}
