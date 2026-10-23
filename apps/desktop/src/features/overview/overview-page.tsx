import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { SystemInfo } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertsCard, HealthCard } from '@/features/monitoring/health-panels';
import { NodeSummaryCard } from '@/features/nodes/nodes-page';
import { useNodes } from '@/features/nodes/queries';
import { useSystemInfo } from '@/features/system/use-system-info';
import { TorOverviewCard } from '@/features/tor/tor-page';
import { formatBytes, formatPercent, formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] items-baseline gap-3 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function MemoryMeter({ info }: { info: SystemInfo['platform'] }) {
  const { t } = useTranslation();
  const used = info.totalMemoryBytes - info.freeMemoryBytes;
  const fraction = info.totalMemoryBytes > 0 ? used / info.totalMemoryBytes : 0;
  return (
    <div className="space-y-1.5">
      <p className="tabular">
        {t('overview.memoryInUse', { used: formatBytes(used), total: formatBytes(info.totalMemoryBytes) })}
        <span className="text-muted-foreground"> ({formatPercent(fraction)})</span>
      </p>
      <div
        role="meter"
        aria-label={t('overview.memoryBar')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-info" style={{ width: `${(fraction * 100).toFixed(1)}%` }} />
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();
  const query = useSystemInfo();
  const info = query.data;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('overview.title')}</h1>
        <p className="text-muted-foreground">{t('overview.description')}</p>
      </div>

      {query.isError ? (
        <ErrorPanel
          title={t('errors.orchestratorUnavailable')}
          error={toOrchestratorError(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <HealthCard showLink />
          <AlertsCard />
          <Card>
            <CardHeader>
              <CardTitle>{t('overview.applicationTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {info ? (
                <dl>
                  <Field label={t('overview.version')}>
                    <span className="font-mono tabular">{info.product.version}</span>
                  </Field>
                  <Field label={t('overview.runtime')}>{info.orchestrator.runtime}</Field>
                  <Field label={t('overview.startedAt')}>
                    <span className="tabular">{formatTimestamp(info.orchestrator.startedAt)}</span>
                  </Field>
                  <Field label={t('overview.dataDirectory')}>
                    <CopyableValue value={info.orchestrator.dataDirectory} label={t('overview.dataDirectory')} />
                  </Field>
                  {info.orchestrator.developmentMode && (
                    <p className="pt-2 text-xs text-warning">{t('overview.developmentBuild')}</p>
                  )}
                </dl>
              ) : (
                <LoadingRows />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('overview.computerTitle')}</CardTitle>
              {query.dataUpdatedAt > 0 && (
                <span className="text-xs text-muted-foreground tabular">
                  {t('overview.refreshed', { time: formatTimestamp(new Date(query.dataUpdatedAt)) })}
                </span>
              )}
            </CardHeader>
            <CardContent>
              {info ? (
                <dl>
                  <Field label={t('overview.operatingSystem')}>
                    {info.platform.os === 'windows' ? 'Windows' : info.platform.os} {info.platform.release} (
                    {info.platform.architecture})
                  </Field>
                  <Field label={t('overview.processor')}>
                    <span>{info.platform.cpuModel}</span>
                    <span className="block text-muted-foreground">
                      {t('overview.logicalProcessors', { count: info.platform.logicalProcessors })}
                    </span>
                  </Field>
                  <Field label={t('overview.memory')}>
                    <MemoryMeter info={info.platform} />
                  </Field>
                </dl>
              ) : (
                <LoadingRows />
              )}
            </CardContent>
          </Card>

          <NodesOverview />
          <TorOverviewCard />
        </div>
      )}
    </div>
  );
}

function NodesOverview() {
  const { t } = useTranslation();
  const nodes = useNodes();
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>{t('overview.nodesTitle')}</CardTitle>
        <Button asChild variant="outline">
          <Link to="/nodes">{t('overview.openNodes')}</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {nodes.isError ? (
          <ErrorPanel
            title={t('overview.nodesFailed')}
            error={toOrchestratorError(nodes.error)}
            onRetry={() => void nodes.refetch()}
          />
        ) : !nodes.data ? (
          <LoadingRows />
        ) : nodes.data.length === 0 ? (
          <div className="space-y-3">
            <p className="text-muted-foreground">{t('overview.nodesEmpty')}</p>
            <Button asChild>
              <Link to="/nodes/setup">{t('nodes.setUp')}</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {nodes.data.map((node) => (
              <NodeSummaryCard key={node.profile.id} node={node} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
