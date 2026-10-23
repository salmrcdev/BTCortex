import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type {
  AppError,
  ElectrumOverview,
  ElectrumServerStatus,
  ElectrumSetupPlan,
  NodeWithStatus,
} from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { Meter } from '@/components/data/meter';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { JobProgress } from '@/components/feedback/job-progress';
import { Note } from '@/components/feedback/note';
import { NetworkBadge } from '@/components/status/network-badge';
import { StatusIndicator } from '@/components/status/status-indicator';
import type { StatusTone } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { chooseFolder } from '@/lib/dialogs';
import { formatBytes, formatLogTime, formatNumber, formatPercent } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { cn } from '@/lib/utils';
import { QrCode } from '@/features/hardware/qr';
import { useJob, useNodes } from '@/features/nodes/queries';
import { ElectrumWalletCard } from '@/features/wallets/electrum-wallet-card';
import { SparrowCard } from '@/features/wallets/sparrow-card';
import { electrumKeys, useElectrumActions, useElectrumOverview, useElectrumPlan } from './queries';
import { RemoteServers } from './remote-servers';

// Electrum servers (specification section 7): for each node on this
// computer, whether it can have one, what setting one up involves (shown
// before anything changes), the way from installation to a server wallets
// can use, how each wallet connects, and the server's own figures and lines.

const SETUP_STAGES = [
  'checking',
  'resolving',
  'fetching-checksums',
  'verifying-signatures',
  'downloading',
  'extracting',
  'verifying-executables',
  'finalising',
  'configuring',
  'restarting',
] as const;

function appErrorAsOrchestratorError(error: AppError) {
  return toOrchestratorError({ code: -32000, message: error.message, data: error });
}

function stateIndicator(server: ElectrumServerStatus, t: TFunction): { tone: StatusTone; label: string } {
  const progress = formatPercent(server.progress ?? 0);
  switch (server.state) {
    case 'not-set-up':
      return { tone: 'inactive', label: t('electrum.state.notSetUp') };
    case 'waiting':
      switch (server.waitingFor) {
        case 'installation':
          return { tone: 'working', label: t('electrum.state.installation') };
        case 'node-stopped':
          return { tone: 'inactive', label: t('electrum.state.nodeStopped') };
        case 'node-unreachable':
          return { tone: 'attention', label: t('electrum.state.nodeUnreachable') };
        case 'node-synchronising':
          return { tone: 'working', label: t('electrum.state.nodeSynchronising', { progress }) };
        case 'transaction-index':
          return { tone: 'working', label: t('electrum.state.transactionIndex', { progress }) };
        case 'transaction-index-off':
          return { tone: 'attention', label: t('electrum.state.transactionIndexOff') };
        case 'node-pruned':
          return { tone: 'failed', label: t('electrum.state.nodePruned') };
        case undefined:
          return { tone: 'working', label: t('electrum.state.waiting') };
      }
      break;
    case 'starting':
      return { tone: 'working', label: t('electrum.state.starting') };
    case 'indexing':
      return { tone: 'working', label: t('electrum.state.indexing', { progress }) };
    case 'ready':
      return { tone: 'healthy', label: t('electrum.state.ready') };
    case 'stopping':
      return { tone: 'working', label: t('electrum.state.stopping') };
    case 'stopped':
      return { tone: 'inactive', label: t('electrum.state.stopped') };
    case 'failed':
      return { tone: 'failed', label: t('electrum.state.failed') };
  }
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function PlanView({ plan, onChooseFolder }: { plan: ElectrumSetupPlan; onChooseFolder: () => void }) {
  const { t } = useTranslation();
  const volume = plan.volume;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
        <Detail label={t('electrum.setUp.folder')}>
          <span className="block break-all font-mono text-[13px]">{plan.dataDirectory}</span>
          {volume && (
            <span className="block text-xs text-muted-foreground">
              {t('electrum.setUp.volume', { free: formatBytes(volume.freeBytes), root: volume.root })} ·{' '}
              {t(`electrum.setUp.volumeKind.${volume.kind}`)}
            </span>
          )}
          <Button variant="ghost" className="mt-1 h-auto px-0 underline underline-offset-2" onClick={onChooseFolder}>
            {t('electrum.setUp.chooseFolder')}
          </Button>
        </Detail>
        <Detail label={t('electrum.setUp.space')}>
          {t('electrum.setUp.spaceValue', { size: formatBytes(plan.indexBytesEstimate) })}
          {plan.transactionIndexBytesEstimate !== null && (
            <span className="block text-xs text-muted-foreground">
              {t('electrum.setUp.transactionIndexSpace', { size: formatBytes(plan.transactionIndexBytesEstimate) })}
            </span>
          )}
        </Detail>
        <Detail label={t('electrum.setUp.nodeChanges')}>
          {plan.nodeChanges.length === 0 ? (
            t('electrum.setUp.noNodeChanges')
          ) : (
            <>
              <ul className="font-mono text-[13px]">
                {plan.nodeChanges.map((change) => (
                  <li key={change.key}>{`${change.key}=${change.value}`}</li>
                ))}
              </ul>
              {plan.restartsNode && (
                <span className="block text-xs text-muted-foreground">{t('electrum.setUp.restartsNode')}</span>
              )}
            </>
          )}
        </Detail>
      </dl>
      {plan.installsFulcrum && <Note tone="info">{t('electrum.setUp.installs')}</Note>}
      {plan.warnings.map((warning) => (
        <Note key={warning.code} tone="warning">
          {warning.message}
        </Note>
      ))}
      {plan.blockers.map((blocker) => (
        <Note key={blocker.code} tone="warning">
          <span className="font-medium">{blocker.message}</span>
        </Note>
      ))}
    </div>
  );
}

function SetUpServer({ server }: { server: ElectrumServerStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const actions = useElectrumActions();
  const onError = useErrorFeedback();
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState<string>();
  const [jobId, setJobId] = useState<string>();
  const plan = useElectrumPlan(server.nodeId, folder, open);
  const job = useJob(jobId);
  const state = job.data?.state;

  const reported = useRef<string>(undefined);
  useEffect(() => {
    if (state !== 'succeeded' || jobId === undefined || reported.current === jobId) return;
    reported.current = jobId;
    toast.success(t('electrum.setUp.done'));
    void queryClient.invalidateQueries({ queryKey: electrumKeys.all });
  }, [state, jobId, queryClient, t]);

  const working = state === 'queued' || state === 'running';
  if (job.data && working) {
    return (
      <div className="space-y-3">
        <p className="font-medium">{t('electrum.setUp.running')}</p>
        <JobProgress
          job={job.data}
          stages={SETUP_STAGES.map((stage) => ({ id: stage, label: t(`electrum.setUp.stages.${stage}`) }))}
        />
      </div>
    );
  }

  const chooseAnother = () => {
    void chooseFolder(plan.data?.dataDirectory).then((chosen) => {
      if (chosen !== null) setFolder(chosen);
    });
  };

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-muted-foreground">{t('electrum.setUp.intro')}</p>
      {!open ? (
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('electrum.setUp.action')}
        </Button>
      ) : plan.isError ? (
        <ErrorPanel
          title={t('electrum.setUp.planFailed')}
          error={toOrchestratorError(plan.error)}
          onRetry={() => void plan.refetch()}
        />
      ) : !plan.data ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          {t('electrum.setUp.planLoading')}
        </p>
      ) : (
        <section aria-label={t('electrum.setUp.planTitle')} className="space-y-4 rounded-md border p-4">
          <h3 className="font-medium">{t('electrum.setUp.planTitle')}</h3>
          <PlanView plan={plan.data} onChooseFolder={chooseAnother} />
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={plan.data.blockers.length > 0 || actions.setUp.isPending}
              onClick={() => {
                const dataDirectory = plan.data.dataDirectory;
                actions.setUp.mutate(
                  { nodeId: server.nodeId, dataDirectory },
                  {
                    onSuccess: ({ jobId: started }) => {
                      setJobId(started);
                    },
                    onError,
                  },
                );
              }}
            >
              {t('electrum.setUp.confirm')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setFolder(undefined);
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </section>
      )}
      {state === 'failed' && job.data?.error && (
        <ErrorPanel title={t('electrum.setUp.failed')} error={appErrorAsOrchestratorError(job.data.error)} />
      )}
    </div>
  );
}

type StepState = 'done' | 'current' | 'problem' | 'pending';

/** The way from installation to a server wallets can use, with the step the server is at. */
function Steps({ server, installed }: { server: ElectrumServerStatus; installed: boolean }) {
  const { t } = useTranslation();
  const waiting = server.state === 'waiting' ? server.waitingFor : undefined;
  const nodeProblem = waiting === 'node-stopped' || waiting === 'node-unreachable' || waiting === 'node-pruned';
  const indexed = server.state === 'ready';
  const steps: { id: 'installed' | 'node' | 'transactionIndex' | 'indexing' | 'ready'; state: StepState }[] = [
    { id: 'installed', state: installed ? 'done' : 'current' },
    {
      id: 'node',
      state: !installed ? 'pending' : nodeProblem ? 'problem' : waiting === 'node-synchronising' ? 'current' : 'done',
    },
    {
      id: 'transactionIndex',
      state:
        waiting === 'transaction-index-off'
          ? 'problem'
          : waiting === 'transaction-index'
            ? 'current'
            : !installed || nodeProblem || waiting === 'node-synchronising'
              ? 'pending'
              : 'done',
    },
    {
      id: 'indexing',
      state: indexed ? 'done' : server.state === 'indexing' || server.state === 'starting' ? 'current' : 'pending',
    },
    { id: 'ready', state: indexed ? 'done' : 'pending' },
  ];
  return (
    <ol className="space-y-1.5" aria-label={t('electrum.steps.label')}>
      {steps.map((step) => (
        <li
          key={step.id}
          className="flex items-center gap-2"
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          {step.state === 'done' ? (
            <CircleCheck aria-hidden="true" className="size-4 text-success" />
          ) : step.state === 'current' ? (
            <LoaderCircle aria-hidden="true" className="size-4 text-info motion-safe:animate-spin" />
          ) : step.state === 'problem' ? (
            <TriangleAlert aria-hidden="true" className="size-4 text-warning" />
          ) : (
            <span aria-hidden="true" className="size-4 rounded-full border border-input" />
          )}
          <span className={cn(step.state === 'pending' && 'text-muted-foreground')}>
            {t(`electrum.steps.${step.id}`)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Progress({ server }: { server: ElectrumServerStatus }) {
  const { t } = useTranslation();
  if (server.state === 'indexing' && server.indexing) {
    const { indexedHeight, targetHeight, blocksPerSecond } = server.indexing;
    return (
      <div className="max-w-xl space-y-1.5">
        <Meter
          role="progressbar"
          tone="info"
          value={server.progress ?? 0}
          label={t('electrum.progressLabel')}
          valueText={t('electrum.progressValue', {
            progress: formatPercent(server.progress ?? 0, 1),
            indexed: indexedHeight === null ? '—' : formatNumber(indexedHeight),
            target: targetHeight === null ? '—' : formatNumber(targetHeight),
          })}
        />
        {blocksPerSecond !== null && (
          <p className="text-muted-foreground">
            {t('electrum.speed', { rate: formatNumber(blocksPerSecond, { maximumFractionDigits: 1 }) })}
          </p>
        )}
        <p className="text-muted-foreground">{t('electrum.indexingNote')}</p>
      </div>
    );
  }
  if (server.state === 'waiting' && server.waitingFor === 'transaction-index') {
    return (
      <div className="max-w-xl space-y-1.5">
        <Meter
          role="progressbar"
          tone="info"
          value={server.progress ?? 0}
          label={t('electrum.transactionIndexLabel')}
          valueText={formatPercent(server.progress ?? 0)}
        />
        <p className="text-muted-foreground">{t('electrum.transactionIndexNote')}</p>
      </div>
    );
  }
  if (server.state === 'waiting' && server.waitingFor === 'transaction-index-off') {
    return <Note tone="warning">{t('electrum.transactionIndexOffNote')}</Note>;
  }
  if (server.state === 'waiting' && server.waitingFor === 'node-pruned') {
    return <Note tone="warning">{t('electrum.nodePrunedNote')}</Note>;
  }
  return null;
}

function Connection({ server }: { server: ElectrumServerStatus }) {
  const { t } = useTranslation();
  const connection = server.connection;
  if (!connection) return null;
  const port = String(connection.port);
  return (
    <section className="space-y-3" aria-labelledby={`connect-${server.nodeId}`}>
      <h3 id={`connect-${server.nodeId}`} className="font-medium">
        {t('electrum.connectTitle')}
      </h3>
      {server.state !== 'ready' && <Note tone="info">{t('electrum.connectPending')}</Note>}
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
        <Detail label={t('electrum.server')}>
          <CopyableValue value={connection.server} label={t('electrum.server')} />
        </Detail>
        <Detail label={t('electrum.url')}>
          <CopyableValue value={connection.url} label={t('electrum.url')} />
        </Detail>
      </dl>
      <ul className="max-w-prose space-y-2">
        <li>
          <span className="font-medium">{t('electrum.wallets.sparrow')}</span>
          <span className="block text-muted-foreground">{t('electrum.wallets.sparrowSteps', { port })}</span>
        </li>
        <li>
          <span className="font-medium">{t('electrum.wallets.trezor')}</span>
          <span className="block text-muted-foreground">
            {t('electrum.wallets.trezorSteps', { server: connection.server })}
          </span>
        </li>
        <li>
          <span className="font-medium">{t('electrum.wallets.electrum')}</span>
          <span className="block text-muted-foreground">
            {t('electrum.wallets.electrumSteps', { server: connection.server })}
          </span>
        </li>
      </ul>
      {server.network !== 'mainnet' && (
        <Note tone="info">{t('electrum.connectNetwork', { network: t(`networks.${server.network}`) })}</Note>
      )}
      <p className="max-w-prose text-xs text-muted-foreground">{t('electrum.connectIntro')}</p>
    </section>
  );
}

/** Access from other devices through Tor: off by default, on only after the user confirms what it means. */
function RemoteAccess({ server }: { server: ElectrumServerStatus }) {
  const { t } = useTranslation();
  const actions = useElectrumActions();
  const onError = useErrorFeedback();
  const access = server.remoteAccess;
  const onion = access.onion;
  const set = (enabled: boolean) => {
    actions.remoteAccess.mutate(
      { nodeId: server.nodeId, enabled },
      {
        onSuccess: () => toast.success(enabled ? t('electrum.remote.turnedOn') : t('electrum.remote.turnedOff')),
        onError,
      },
    );
  };
  return (
    <section className="space-y-3" aria-labelledby={`remote-${server.nodeId}`}>
      <h3 id={`remote-${server.nodeId}`} className="font-medium">
        {t('electrum.remote.title')}
      </h3>
      {!access.enabled ? (
        <>
          <p className="max-w-prose text-muted-foreground">{t('electrum.remote.intro')}</p>
          <ConfirmButton
            label={t('electrum.remote.turnOn')}
            title={t('electrum.remote.confirmTitle')}
            confirmLabel={t('electrum.remote.confirm')}
            disabled={actions.remoteAccess.isPending}
            onConfirm={() => {
              set(true);
            }}
          >
            <p>{t('electrum.remote.confirmBody')}</p>
            <p>{t('electrum.remote.confirmAddress')}</p>
          </ConfirmButton>
        </>
      ) : (
        <>
          <StatusIndicator
            tone={access.problem === undefined && onion ? 'healthy' : 'attention'}
            label={access.problem === undefined && onion ? t('electrum.remote.on') : t('electrum.remote.notNow')}
          />
          {access.problem !== undefined && (
            <Note tone="warning">
              {access.problem}{' '}
              <Link to="/tor" className="underline underline-offset-2">
                {t('navigation.tor')}
              </Link>
            </Note>
          )}
          {onion && (
            <div className="flex flex-wrap items-start gap-6">
              <QrCode frame={onion.qr} label={t('electrum.remote.qrLabel')} />
              <dl className="grid min-w-0 flex-1 grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
                <Detail label={t('electrum.server')}>
                  <CopyableValue value={onion.server} label={t('electrum.remote.serverLabel')} />
                </Detail>
                <Detail label={t('electrum.url')}>
                  <CopyableValue value={onion.url} label={t('electrum.remote.urlLabel')} />
                </Detail>
                <Detail label={t('electrum.remote.host')}>
                  <CopyableValue value={onion.host} label={t('electrum.remote.host')} />
                </Detail>
                <Detail label={t('electrum.remote.port')}>
                  <span className="tabular">{onion.port}</span>
                </Detail>
              </dl>
            </div>
          )}
          <ul className="max-w-prose list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t('electrum.remote.needsTor')}</li>
            <li>{t('electrum.remote.delay')}</li>
            <li>{t('electrum.remote.private')}</li>
          </ul>
          <Button
            variant="outline"
            disabled={actions.remoteAccess.isPending}
            onClick={() => {
              set(false);
            }}
          >
            {t('electrum.remote.turnOff')}
          </Button>
        </>
      )}
    </section>
  );
}

function Details({ server }: { server: ElectrumServerStatus }) {
  const { t } = useTranslation();
  const figures = server.server;
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
      {server.runningVersion !== null && (
        <Detail label={t('electrum.version')}>
          <span className="tabular">{server.runningVersion}</span>
        </Detail>
      )}
      {figures && (
        <>
          <Detail label={t('electrum.clients')}>
            <span className="tabular">{formatNumber(figures.clients)}</span>
          </Detail>
          <Detail label={t('electrum.height')}>
            <span className="tabular">{formatNumber(figures.height)}</span>
          </Detail>
          <Detail label={t('electrum.uptime')}>{figures.uptime}</Detail>
          {figures.memoryBytes !== undefined && (
            <Detail label={t('electrum.memory')}>
              <span className="tabular">{formatBytes(figures.memoryBytes)}</span>
            </Detail>
          )}
        </>
      )}
      {server.indexBytes !== null && (
        <Detail label={t('electrum.indexSize')}>
          <span className="tabular">{formatBytes(server.indexBytes)}</span>
        </Detail>
      )}
      {server.dataDirectory !== null && (
        <Detail label={t('electrum.folder')}>
          <CopyableValue value={server.dataDirectory} label={t('electrum.folder')} />
        </Detail>
      )}
    </dl>
  );
}

function RecentLines({ server }: { server: ElectrumServerStatus }) {
  const { t } = useTranslation();
  const lines = [...server.recentLines].reverse();
  return (
    <details className="group">
      <summary className="cursor-pointer font-medium">{t('electrum.linesTitle')}</summary>
      <div className="mt-2 space-y-2">
        {lines.length === 0 ? (
          <p className="text-muted-foreground">{t('electrum.noLines')}</p>
        ) : (
          <ol className="max-h-72 space-y-1 overflow-y-auto font-mono text-xs" aria-label={t('electrum.linesTitle')}>
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
        <Link
          to="/logs"
          search={{ source: `electrum:${server.nodeId}` }}
          className="text-sm underline underline-offset-2"
        >
          {t('electrum.openLogs')}
        </Link>
      </div>
    </details>
  );
}

function Actions({ server }: { server: ElectrumServerStatus }) {
  const { t } = useTranslation();
  const actions = useElectrumActions();
  const onError = useErrorFeedback();
  const [deleteIndex, setDeleteIndex] = useState(false);
  const deleteId = useId();
  const clients = server.server?.clients ?? 0;
  const running = server.pid !== null || server.state === 'starting' || server.state === 'indexing';
  const stop = () => {
    actions.stop.mutate(server.nodeId, {
      onSuccess: () => toast.success(t('electrum.stopped')),
      onError,
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      {running || server.state === 'stopping' ? (
        clients > 0 ? (
          <ConfirmButton
            label={t('electrum.stop')}
            title={t('electrum.stopTitle')}
            confirmLabel={t('electrum.stopConfirm')}
            destructive
            disabled={actions.stop.isPending || server.state === 'stopping'}
            onConfirm={stop}
          >
            <p>{t('electrum.stopBody', { count: clients })}</p>
          </ConfirmButton>
        ) : (
          <Button variant="outline" disabled={actions.stop.isPending || server.state === 'stopping'} onClick={stop}>
            {t('electrum.stop')}
          </Button>
        )
      ) : (
        (server.state === 'stopped' || server.state === 'failed' || !server.enabled) && (
          <Button
            disabled={actions.start.isPending}
            onClick={() => {
              actions.start.mutate(server.nodeId, {
                onSuccess: () => toast.success(t('electrum.started')),
                onError,
              });
            }}
          >
            {t('electrum.start')}
          </Button>
        )
      )}
      <ConfirmButton
        label={t('electrum.remove')}
        title={t('electrum.removeTitle')}
        confirmLabel={t('electrum.removeConfirm')}
        destructive
        disabled={actions.remove.isPending}
        onConfirm={() => {
          actions.remove.mutate(
            { nodeId: server.nodeId, deleteIndex },
            {
              onSuccess: (removal) =>
                toast.success(
                  removal.deletedBytes > 0
                    ? t('electrum.removedFreed', { size: formatBytes(removal.deletedBytes) })
                    : t('electrum.removed'),
                ),
              onError,
            },
          );
        }}
      >
        <p>{t('electrum.removeBody')}</p>
        <label htmlFor={deleteId} className="flex items-start gap-2 text-foreground">
          <Checkbox
            id={deleteId}
            checked={deleteIndex}
            onChange={(event) => {
              setDeleteIndex(event.currentTarget.checked);
            }}
          />
          <span>
            {server.indexBytes === null
              ? t('electrum.removeDeleteIndexUnknown')
              : t('electrum.removeDeleteIndex', { size: formatBytes(server.indexBytes) })}
            <span className="block text-muted-foreground">{t('electrum.removeDeleteIndexHint')}</span>
          </span>
        </label>
      </ConfirmButton>
    </div>
  );
}

function ServerCard({
  server,
  overview,
  node,
}: {
  server: ElectrumServerStatus;
  overview: ElectrumOverview;
  node: NodeWithStatus | undefined;
}) {
  const { t } = useTranslation();
  const indicator = stateIndicator(server, t);
  const setUp = server.state !== 'not-set-up';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Link to="/nodes/$nodeId" params={{ nodeId: server.nodeId }} className="underline-offset-2 hover:underline">
            {server.nodeName}
          </Link>
          <NetworkBadge network={server.network} />
        </CardTitle>
        <StatusIndicator tone={indicator.tone} label={indicator.label} className="font-medium" />
      </CardHeader>
      <CardContent className="space-y-5">
        {!setUp ? (
          server.unavailableReason !== undefined ? (
            <Note tone="info">{t(`electrum.unavailableReasons.${server.unavailableReason}`)}</Note>
          ) : (
            <SetUpServer server={server} />
          )
        ) : (
          <>
            {server.state !== 'ready' && server.state !== 'stopped' && (
              <Steps server={server} installed={overview.installed !== null} />
            )}
            <Progress server={server} />
            {server.state === 'failed' && server.error && (
              <ErrorPanel title={t('electrum.errorTitle')} error={appErrorAsOrchestratorError(server.error)} />
            )}
            <Actions server={server} />
            <div className="grid gap-6 lg:grid-cols-2">
              <Connection server={server} />
              <Details server={server} />
            </div>
            <RemoteAccess server={server} />
            {server.state === 'ready' && node && (
              <div className="grid gap-6 lg:grid-cols-2">
                <SparrowCard node={node} via="electrum" />
                <ElectrumWalletCard node={node} />
              </div>
            )}
            <RecentLines server={server} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GuideCard() {
  const { t } = useTranslation();
  const points = ['privacy', 'history', 'trust', 'space'] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('electrum.guideTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="max-w-prose list-disc space-y-1.5 pl-5">
          {points.map((point) => (
            <li key={point}>{t(`electrum.guide.${point}`)}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function ElectrumPage() {
  const { t } = useTranslation();
  const overview = useElectrumOverview();
  const nodes = useNodes();
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('electrum.title')}</h1>
        <p className="max-w-3xl text-muted-foreground">{t('electrum.description')}</p>
      </div>
      {overview.isError ? (
        <ErrorPanel
          title={t('electrum.unavailable')}
          error={toOrchestratorError(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      ) : !overview.data ? (
        <Skeleton className="h-64" />
      ) : overview.data.servers.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="max-w-prose text-muted-foreground">{t('electrum.noNodes')}</p>
            <Button asChild>
              <Link to="/nodes/setup">{t('electrum.setUpNode')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        overview.data.servers.map((server) => (
          <ServerCard
            key={server.nodeId}
            server={server}
            overview={overview.data}
            node={nodes.data?.find((candidate) => candidate.profile.id === server.nodeId)}
          />
        ))
      )}
      <RemoteServers />
      <GuideCard />
    </div>
  );
}
