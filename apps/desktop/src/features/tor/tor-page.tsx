import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { AppError, TorStatus } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { Meter } from '@/components/data/meter';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { JobProgress } from '@/components/feedback/job-progress';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import type { StatusTone } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes, formatDate, formatLogTime, formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useJob } from '@/features/nodes/queries';
import { I2pCard } from './i2p-card';
import { torKeys, useTorActions, useTorStatus } from './queries';

// Tor & Privacy (specification sections 10 and 24.1): setting up the Tor
// Project's tor with verification, its connection to the Tor network as tor
// reports it, what to do when it cannot connect, the nodes that use it, other
// software's tor on this computer, and what Tor does and does not protect;
// then the I2P router on this computer, which does not depend on Tor.

const INSTALL_STAGES = [
  'resolving',
  'fetching-checksums',
  'verifying-signatures',
  'downloading',
  'extracting',
  'verifying-executables',
  'finalising',
  'starting',
] as const;

/** tor's own reasons for connection problems that mean the network blocks it. */
const BLOCKED_REASONS = new Set(['CONNECTREFUSED', 'NOROUTE', 'TIMEOUT', 'IOERROR', 'MISC', 'DONE', 'RESOURCELIMIT']);
const OUTDATED = new Set(['old', 'unrecommended', 'obsolete']);

function appErrorAsOrchestratorError(error: AppError) {
  return toOrchestratorError({ code: -32000, message: error.message, data: error });
}

function SetUpTor() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const actions = useTorActions();
  const onError = useErrorFeedback();
  const [jobId, setJobId] = useState<string>();
  const job = useJob(jobId);
  const state = job.data?.state;

  const reported = useRef<string>(undefined);
  useEffect(() => {
    if (state !== 'succeeded' || jobId === undefined || reported.current === jobId) return;
    reported.current = jobId;
    toast.success(t('tor.setUp.done'));
    void queryClient.invalidateQueries({ queryKey: torKeys.all });
  }, [state, jobId, queryClient, t]);

  const working = state === 'queued' || state === 'running';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{working ? t('tor.setUp.running') : t('tor.setUp.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="max-w-prose text-muted-foreground">{t('tor.setUp.body')}</p>
        {job.data && working ? (
          <JobProgress
            job={job.data}
            stages={INSTALL_STAGES.map((stage) => ({ id: stage, label: t(`tor.stages.${stage}`) }))}
          />
        ) : (
          <Button
            disabled={actions.install.isPending}
            onClick={() => {
              actions.install.mutate(undefined, {
                onSuccess: ({ jobId: started }) => {
                  setJobId(started);
                },
                onError,
              });
            }}
          >
            {t('tor.setUp.action')}
          </Button>
        )}
        {state === 'failed' && job.data?.error && (
          <ErrorPanel title={t('tor.setUp.failed')} error={appErrorAsOrchestratorError(job.data.error)} />
        )}
      </CardContent>
    </Card>
  );
}

function stateIndicator(status: TorStatus, t: TFunction): { tone: StatusTone; label: string } {
  switch (status.state) {
    case 'running':
      return status.circuitEstablished
        ? { tone: 'healthy', label: t('tor.state.running') }
        : { tone: 'attention', label: t('tor.state.noCircuits') };
    case 'starting':
      return {
        tone: 'working',
        label: status.bootstrap
          ? t('tor.state.starting', { progress: status.bootstrap.progress })
          : t('tor.state.startingUnknown'),
      };
    case 'stopping':
      return { tone: 'working', label: t('tor.state.stopping') };
    case 'failed':
      return { tone: 'failed', label: t('tor.state.failed') };
    case 'not-installed':
      return { tone: 'inactive', label: t('tor.state.notInstalled') };
    case 'stopped':
      return { tone: 'inactive', label: t('tor.state.stopped') };
  }
}

/** What tor's reports mean for the user, and what to do about them. */
function Problems({ status }: { status: TorStatus }) {
  const { t } = useTranslation();
  const notes: ReactNode[] = [];
  const problem = status.bootstrap?.problem;
  if (status.state === 'starting' && problem) {
    notes.push(
      problem.reason === 'CLOCK_SKEW' ? (
        <Note key="clock" tone="warning">
          {t('tor.problems.clock')}
        </Note>
      ) : (
        <Note key="blocked" tone="warning">
          {t('tor.problems.blocked', { warning: problem.warning })}
        </Note>
      ),
    );
  } else if (status.state === 'starting' && status.bootstrap?.stalled) {
    notes.push(
      <Note key="stalled" tone="warning">
        {t('tor.problems.stalled')}
      </Note>,
    );
  }
  if ((status.state === 'starting' || status.state === 'running') && status.networkLiveness === 'down') {
    notes.push(
      <Note key="offline" tone="warning">
        {t('tor.problems.offline')}
      </Note>,
    );
  }
  if (status.versionStatus !== null && OUTDATED.has(status.versionStatus)) {
    notes.push(
      <Note key="version" tone="warning">
        {t('tor.problems.oldVersion', { status: t(`tor.versionStatuses.${status.versionStatus as 'old'}`) })}{' '}
        <Link to="/software" className="underline underline-offset-2">
          {t('navigation.software')}
        </Link>
      </Note>,
    );
  }
  return notes.length > 0 ? <div className="space-y-2">{notes}</div> : null;
}

function ConnectionCard({ status }: { status: TorStatus }) {
  const { t } = useTranslation();
  const actions = useTorActions();
  const onError = useErrorFeedback();
  const indicator = stateIndicator(status, t);
  const bootstrap = status.bootstrap;
  const active = status.state === 'starting' || status.state === 'running';
  const runningUsers = status.usedBy.filter((user) => user.running);
  const blockedReason = bootstrap?.problem?.reason;

  const start = () => {
    actions.start.mutate(undefined, {
      onSuccess: () => toast.success(t('tor.started')),
      onError,
    });
  };
  const stop = () => {
    actions.stop.mutate(undefined, {
      onSuccess: () => toast.success(t('tor.stopped')),
      onError,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tor.connectionTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <StatusIndicator tone={indicator.tone} label={indicator.label} className="font-medium" />
        {bootstrap && status.state === 'starting' && (
          <div className="max-w-xl space-y-1.5">
            <Meter
              role="progressbar"
              tone={blockedReason !== undefined && BLOCKED_REASONS.has(blockedReason) ? 'warning' : 'info'}
              value={bootstrap.progress / 100}
              label={t('tor.progressLabel')}
              valueText={t('tor.progressValue', { progress: bootstrap.progress, summary: bootstrap.summary })}
            />
            <p className="text-muted-foreground">{t('tor.torSays', { summary: bootstrap.summary })}</p>
          </div>
        )}
        <Problems status={status} />
        {status.state === 'failed' && status.error && (
          <ErrorPanel title={t('tor.errorTitle')} error={appErrorAsOrchestratorError(status.error)} />
        )}
        <div className="flex flex-wrap items-center gap-3">
          {active || status.state === 'stopping' ? (
            runningUsers.length > 0 ? (
              <ConfirmButton
                label={t('tor.stop')}
                title={t('tor.stopTitle')}
                confirmLabel={t('tor.stopConfirm')}
                destructive
                disabled={actions.stop.isPending || status.state === 'stopping'}
                onConfirm={stop}
              >
                <p>{t('tor.stopBody', { nodes: runningUsers.map((user) => user.name).join(', ') })}</p>
              </ConfirmButton>
            ) : (
              <Button variant="outline" disabled={actions.stop.isPending || status.state === 'stopping'} onClick={stop}>
                {t('tor.stop')}
              </Button>
            )
          ) : (
            <Button disabled={actions.start.isPending} onClick={start}>
              {t('tor.start')}
            </Button>
          )}
        </div>
        <label className="flex max-w-prose items-start gap-2">
          <Checkbox
            checked={status.autoStart}
            disabled={actions.configure.isPending}
            onChange={(event) => {
              actions.configure.mutate(event.currentTarget.checked, { onError });
            }}
          />
          <span>
            <span className="font-medium">{t('tor.autoStart')}</span>
            <span className="block text-muted-foreground">{t('tor.autoStartHint')}</span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}

function Detail({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        {children}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </dd>
    </>
  );
}

function DetailsCard({ status }: { status: TorStatus }) {
  const { t } = useTranslation();
  const installed = status.installed;
  const endpoint = (port: number) => `127.0.0.1:${String(port)}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tor.detailsTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
          {installed && (
            <>
              <Detail label={t('tor.bundle')}>
                <span className="tabular">
                  {status.runningVersion !== null && status.runningVersion !== installed.version
                    ? t('tor.bundleRunningOlder', { installed: installed.version, running: status.runningVersion })
                    : installed.version}
                </span>
              </Detail>
              {installed.torVersion && (
                <Detail label={t('tor.torVersion')}>
                  <span className="tabular">{installed.torVersion}</span>
                </Detail>
              )}
              <Detail label={t('tor.verified')}>{formatDate(installed.verifiedAt)}</Detail>
            </>
          )}
          {status.versionStatus !== null && (
            <Detail label={t('tor.versionStatus')}>
              {t(`tor.versionStatuses.${status.versionStatus as 'recommended'}`, {
                defaultValue: status.versionStatus,
              })}
            </Detail>
          )}
          <Detail label={t('tor.socksNodes')}>
            <CopyableValue value={endpoint(status.ports.socks)} label={t('tor.socksNodes')} />
          </Detail>
          <Detail label={t('tor.socksApps')}>
            <CopyableValue value={endpoint(status.ports.applicationSocks)} label={t('tor.socksApps')} />
          </Detail>
          <Detail label={t('tor.controlPort')} hint={t('tor.controlPortHint')}>
            <span className="font-mono text-[13px]">{endpoint(status.ports.control)}</span>
          </Detail>
          {status.startedAt !== null && (
            <Detail label={t('tor.runningSince')}>{formatTimestamp(status.startedAt)}</Detail>
          )}
          {status.traffic && (
            <Detail label={t('tor.traffic')}>
              <span className="tabular">
                {t('tor.trafficValue', {
                  read: formatBytes(status.traffic.readBytes),
                  written: formatBytes(status.traffic.writtenBytes),
                })}
              </span>
            </Detail>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

function UsersCard({ status }: { status: TorStatus }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tor.usersTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {status.usedBy.length === 0 ? (
          <p className="max-w-prose text-muted-foreground">{t('tor.noUsers')}</p>
        ) : (
          <ul className="space-y-1.5">
            {status.usedBy.map((user) => (
              <li key={user.id} className="flex items-center gap-2">
                <StatusIndicator
                  tone={user.running ? 'healthy' : 'inactive'}
                  label={user.running ? t('tor.userRunning') : t('tor.userStopped')}
                  className="text-muted-foreground"
                />
                {user.kind === 'electrum' ? (
                  <Link to="/electrum" className="font-medium underline-offset-2 hover:underline">
                    {user.name}
                  </Link>
                ) : (
                  <Link
                    to="/nodes/$nodeId/privacy"
                    params={{ nodeId: user.id }}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {user.name}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2">
          <h3 className="font-medium">{t('tor.externalTitle')}</h3>
          {status.external.length === 0 ? (
            <p className="text-muted-foreground">{t('tor.externalNone')}</p>
          ) : (
            <ul className="space-y-2">
              {status.external.map((external) => (
                <li key={external.kind}>
                  <span className="font-medium">{t(`tor.externalKinds.${external.kind}`)}</span>
                  <span className="block text-muted-foreground">
                    {[
                      external.socksPort === undefined
                        ? undefined
                        : t('tor.externalSocks', { port: external.socksPort }),
                      external.controlPort === undefined
                        ? undefined
                        : t('tor.externalControl', { port: external.controlPort }),
                      external.torVersion === undefined
                        ? undefined
                        : t('tor.externalVersion', { version: external.torVersion }),
                    ]
                      .filter((part) => part !== undefined)
                      .join(' · ')}
                  </span>
                  {external.unauthenticated && <Note tone="warning">{t('tor.externalOpen')}</Note>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{t('tor.externalNote')}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function NoticesCard({ status }: { status: TorStatus }) {
  const { t } = useTranslation();
  const lines = [...status.recentLines].reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tor.noticesTitle')}</CardTitle>
        <Link to="/logs" search={{ source: 'tor' }} className="text-sm underline underline-offset-2">
          {t('tor.openLogs')}
        </Link>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-muted-foreground">{t('tor.noNotices')}</p>
        ) : (
          <ol className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs" aria-label={t('tor.noticesTitle')}>
            {lines.map((line, index) => (
              <li key={`${line.time}-${String(index)}`} className="flex gap-3">
                <time dateTime={line.time} className="shrink-0 text-muted-foreground">
                  {formatLogTime(line.time)}
                </time>
                <span
                  className={
                    line.severity === 'error' ? 'text-danger' : line.severity === 'warning' ? 'text-warning' : undefined
                  }
                >
                  {line.message}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function GuideCard() {
  const { t } = useTranslation();
  const points = ['anonymity', 'vpn', 'browser', 'dns', 'wallet'] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tor.guideTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="max-w-prose list-disc space-y-1.5 pl-5">
          {points.map((point) => (
            <li key={point}>{t(`tor.guide.${point}`)}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Tor's state at a glance, for the overview (specification section 23). */
export function TorOverviewCard() {
  const { t } = useTranslation();
  const status = useTorStatus();
  const data = status.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('overview.torTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data ? (
          status.isError ? (
            <p className="text-muted-foreground">{t('tor.unavailable')}</p>
          ) : (
            <Skeleton className="h-10" />
          )
        ) : data.state === 'not-installed' ? (
          <p className="text-muted-foreground">{t('overview.torNotSetUp')}</p>
        ) : (
          <>
            <StatusIndicator {...stateIndicator(data, t)} />
            {data.usedBy.length > 0 && (
              <p className="text-muted-foreground">{t('overview.torUsedBy', { count: data.usedBy.length })}</p>
            )}
          </>
        )}
        <Button asChild variant="outline">
          <Link to="/tor">{t('overview.openTor')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function TorPage() {
  const { t } = useTranslation();
  const status = useTorStatus();
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('tor.title')}</h1>
        <p className="max-w-3xl text-muted-foreground">{t('tor.description')}</p>
      </div>
      {status.isError ? (
        <ErrorPanel
          title={t('tor.unavailable')}
          error={toOrchestratorError(status.error)}
          onRetry={() => void status.refetch()}
        />
      ) : !status.data ? (
        <Skeleton className="h-64" />
      ) : status.data.state === 'not-installed' ? (
        <>
          <SetUpTor />
          <GuideCard />
          <I2pCard />
        </>
      ) : (
        <>
          <ConnectionCard status={status.data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <DetailsCard status={status.data} />
            <UsersCard status={status.data} />
          </div>
          <NoticesCard status={status.data} />
          <GuideCard />
          <I2pCard />
        </>
      )}
    </div>
  );
}
