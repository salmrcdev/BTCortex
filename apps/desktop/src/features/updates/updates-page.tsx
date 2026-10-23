import type { TFunction } from 'i18next';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ComponentUpdate, NodeVersion, UpdatesOverview } from '@btcortex/contracts';
import { ExternalLink } from '@/components/data/external-link';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { JobProgress } from '@/components/feedback/job-progress';
import { Note } from '@/components/feedback/note';
import { NetworkBadge } from '@/components/status/network-badge';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useJob } from '@/features/nodes/queries';
import { UPDATE_STAGES, useSoftwareActions } from '@/features/software/queries';
import { formatDate, formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useUpdateActions, useUpdates } from './queries';

// The update centre (specification sections 23 and 24.1, area 20): what can
// be updated, how serious staying is, what an update touches, release notes,
// deferring, and the Bitcoin Core version of every node with what moving it
// changes for good. Installation and node moves are the same verified steps
// the Installed software page runs.

const STATE_TONE = {
  current: 'healthy',
  available: 'attention',
  unknown: 'unknown',
  'not-installed': 'inactive',
} as const;
const REMIND_AFTER_DAYS = 7;

function SecurityMark({ security }: { security: ComponentUpdate['security'] }) {
  const { t } = useTranslation();
  if (!security) return null;
  return (
    <p className="flex items-start gap-2">
      <ShieldAlert
        aria-hidden="true"
        className={`mt-0.5 size-4 shrink-0 ${security.severity === 'critical' ? 'text-danger' : 'text-warning'}`}
      />
      <span>
        <span className="font-medium">{t(`updates.security.${security.severity}`)}</span> {security.reason}
      </span>
    </p>
  );
}

function stateLabel(component: ComponentUpdate, t: TFunction): string {
  if (component.deferred) {
    return component.deferred.until === null
      ? t('updates.skipped', { version: component.deferred.version })
      : t('updates.deferredUntil', { date: formatDate(component.deferred.until) });
  }
  switch (component.state) {
    case 'available':
      return t('updates.states.available', { version: component.latest ?? '' });
    case 'current':
      return t('updates.states.current');
    case 'unknown':
      return t('updates.states.unknown');
    case 'not-installed':
      return t('updates.states.notInstalled');
  }
}

function ComponentCard({ component }: { component: ComponentUpdate }) {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const software = useSoftwareActions();
  const actions = useUpdateActions();
  const [jobId, setJobId] = useState<string>();
  const job = useJob(jobId).data;
  const state = job?.state;
  const latest = component.latest;

  // A finished installation is reported once, however often the page renders afterwards.
  const reported = useRef<string>(undefined);
  useEffect(() => {
    if (state !== 'succeeded' || jobId === undefined || reported.current === jobId) return;
    reported.current = jobId;
    toast.success(t('updates.done', { name: component.name, version: latest ?? '' }));
    void software.refresh();
    void actions.invalidate();
  }, [state, jobId, latest, component.name, software, actions, t]);

  const available = component.state === 'available';
  const installing = job !== undefined && (job.state === 'queued' || job.state === 'running');
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{component.name}</CardTitle>
        <StatusIndicator
          tone={component.deferred ? 'inactive' : STATE_TONE[component.state]}
          label={stateLabel(component, t)}
        />
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground">
          {t('updates.installed', { versions: component.installed.join(', ') })}
          {latest !== null && ` ${t('updates.latest', { version: latest })}`}
        </p>
        <SecurityMark security={component.security} />
        {component.deferred && component.security && (
          <p className="text-muted-foreground">{t('updates.deferredSecurity')}</p>
        )}
        {component.error !== null && (
          <p className="text-muted-foreground">{t('updates.checkFailed', { reason: component.error })}</p>
        )}
        {component.held !== null && <p className="text-muted-foreground">{component.held}</p>}
        {available && !installing && (
          <div className="space-y-1">
            <p className="font-medium">{t('updates.impact')}</p>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              {component.impact.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {installing ? (
          <div className="space-y-2">
            <p className="font-medium">{t('updates.installing', { version: latest ?? '' })}</p>
            <JobProgress
              job={job}
              stages={UPDATE_STAGES.filter(
                (stage) => stage !== 'restarting' || component.product === 'tor' || component.product === 'fulcrum',
              ).map((stage) => ({ id: stage, label: t(`updates.stages.${stage}`) }))}
            />
          </div>
        ) : (
          job?.state === 'failed' &&
          job.error && (
            <ErrorPanel
              title={t('updates.failed')}
              error={toOrchestratorError({ code: -32000, message: job.error.message, data: job.error })}
            />
          )
        )}
        {!installing && (
          <div className="flex flex-wrap items-center gap-2">
            {available && latest !== null && (
              <Button
                disabled={software.update.isPending}
                onClick={() => {
                  software.update.mutate(component.product, {
                    onSuccess: ({ jobId: started }) => {
                      setJobId(started);
                    },
                    onError,
                  });
                }}
              >
                {t('updates.install', { version: latest })}
              </Button>
            )}
            {available && latest !== null && component.deferred === null && (
              <>
                <Button
                  variant="outline"
                  disabled={actions.defer.isPending}
                  onClick={() => {
                    actions.defer.mutate(
                      { product: component.product, version: latest, days: REMIND_AFTER_DAYS },
                      { onError },
                    );
                  }}
                >
                  {t('updates.remindLater', { count: REMIND_AFTER_DAYS })}
                </Button>
                <Button
                  variant="ghost"
                  disabled={actions.defer.isPending}
                  onClick={() => {
                    actions.defer.mutate({ product: component.product, version: latest, days: null }, { onError });
                  }}
                >
                  {t('updates.skip')}
                </Button>
              </>
            )}
            {component.deferred !== null && (
              <Button
                variant="outline"
                disabled={actions.resume.isPending}
                onClick={() => {
                  actions.resume.mutate(component.product, { onError });
                }}
              >
                {t('updates.resume')}
              </Button>
            )}
            {component.releaseNotes !== null && (
              <ExternalLink href={component.releaseNotes}>
                {t('updates.releaseNotes', { version: latest ?? '' })}
              </ExternalLink>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NodeRow({ node, lastBackupAt }: { node: NodeVersion; lastBackupAt: string | null }) {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const software = useSoftwareActions();
  const actions = useUpdateActions();
  const newer = node.newer;
  const product = t(`software.products.${node.implementation}`);
  return (
    <li className="space-y-2 border-b py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{node.name}</span>
          <NetworkBadge network={node.network} />
          <span className="text-muted-foreground">
            {node.version === null
              ? t('updates.nodes.unknown')
              : t('updates.nodes.runs', { product, version: node.version })}
          </span>
          {!node.managed && <Badge variant="outline">{t('updates.nodes.external')}</Badge>}
        </p>
        {newer !== null && (
          <ConfirmButton
            label={t('updates.nodes.move', { version: newer })}
            title={t('updates.nodes.moveTitle', { name: node.name, product, version: newer })}
            confirmLabel={t('updates.nodes.moveConfirm')}
            disabled={software.useRuntime.isPending}
            onConfirm={() => {
              software.useRuntime.mutate(
                { nodeId: node.nodeId, version: newer },
                {
                  onSuccess: () => {
                    toast.success(t('updates.nodes.moved', { name: node.name, product, version: newer }));
                    void actions.invalidate();
                  },
                  onError,
                },
              );
            }}
          >
            <p>{t('updates.nodes.moveBody')}</p>
            {node.notes.length > 0 && (
              <ul className="list-inside list-disc space-y-1">
                {node.notes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <p>
              {lastBackupAt === null
                ? t('updates.nodes.noBackup')
                : t('updates.nodes.lastBackup', { time: formatTimestamp(lastBackupAt) })}
            </p>
          </ConfirmButton>
        )}
      </div>
      <SecurityMark security={node.security} />
      {!node.managed && node.security && <p className="text-muted-foreground">{t('updates.nodes.externalHint')}</p>}
    </li>
  );
}

function Overview({ data }: { data: UpdatesOverview }) {
  const { t } = useTranslation();
  const shown = data.components.filter((component) => component.state !== 'not-installed');
  const others = data.components.filter((component) => component.state === 'not-installed');
  return (
    <>
      <p className="text-muted-foreground">
        {data.checkedAt === null
          ? t('updates.neverChecked')
          : t('updates.checkedAt', { time: formatTimestamp(data.checkedAt) })}
      </p>
      {data.nodes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('updates.nodes.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {data.nodes.map((node) => (
                <NodeRow key={node.nodeId} node={node} lastBackupAt={data.lastBackupAt} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {shown.length === 0 ? (
        <p className="text-muted-foreground">{t('updates.nothingInstalled')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {shown.map((component) => (
            <ComponentCard key={component.product} component={component} />
          ))}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('updates.btcortex', { version: data.btcortex.version })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Note tone="info">{data.btcortex.detail}</Note>
          {others.length > 0 && (
            <p className="text-muted-foreground">
              {t('updates.notInstalled', { names: others.map((component) => component.name).join(', ') })}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export function UpdatesPage() {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const overview = useUpdates();
  const actions = useUpdateActions();
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-mono text-xl font-semibold">{t('updates.title')}</h1>
          <p className="max-w-prose text-muted-foreground">{t('updates.description')}</p>
        </div>
        <Button
          variant="outline"
          disabled={actions.refresh.isPending}
          onClick={() => {
            actions.refresh.mutate(undefined, { onError });
          }}
        >
          <RefreshCw
            aria-hidden="true"
            className={actions.refresh.isPending ? 'motion-safe:animate-spin' : undefined}
          />
          {actions.refresh.isPending ? t('updates.checking') : t('updates.checkNow')}
        </Button>
      </div>
      {overview.isError ? (
        <ErrorPanel
          title={t('updates.unavailable')}
          error={toOrchestratorError(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      ) : overview.data ? (
        <Overview data={overview.data} />
      ) : (
        <Skeleton className="h-64" />
      )}
    </div>
  );
}
