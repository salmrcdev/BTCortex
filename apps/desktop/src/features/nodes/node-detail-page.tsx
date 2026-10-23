import { followsKnotsFork } from '@btcortex/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { Play, RotateCw, ScrollText, Square, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { NodeWithStatus } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { capacityTone, Meter } from '@/components/data/meter';
import { StatTile } from '@/components/data/stat-tile';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { NetworkBadge } from '@/components/status/network-badge';
import { NodeStateIndicator } from '@/components/status/node-state';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import {
  formatBytes,
  formatCompact,
  formatDuration,
  formatFeeRate,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTimestamp,
  formatVirtualBytes,
  truncateMiddle,
} from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { ConfigurationPage } from '@/features/config/configuration-page';
import { ConsolePage } from '@/features/console/console-page';
import { MempoolPage } from '@/features/mempool/mempool-page';
import { PeersPage } from '@/features/peers/peers-page';
import { StoragePage } from '@/features/storage/storage-page';
import { NodePrivacyPage } from '@/features/tor/node-privacy-page';
import { SparrowCard } from '@/features/wallets/sparrow-card';
import { useElectrumServerOf } from '@/features/electrum/queries';
import { useNode, useNodeAction } from './queries';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { Note } from '@/components/feedback/note';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[12rem_1fr] items-baseline gap-3 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function useActionFeedback() {
  return useErrorFeedback();
}

function NodeActions({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const start = useNodeAction('nodes.start');
  const stop = useNodeAction('nodes.stop');
  const restart = useNodeAction('nodes.restart');
  const remove = useNodeAction('nodes.remove');
  const reportFailure = useActionFeedback();
  const { profile, status } = node;
  const [removing, setRemoving] = useState(false);
  // Read when the removal is asked about: the dialog says what happens to the node's Electrum server.
  const electrum = useElectrumServerOf(profile.id, removing);
  const electrumServer = electrum.data ?? null;
  const managed = profile.execution === 'managed';
  // A managed bitcoind that runs but does not answer as it should can still be stopped, and is never removed.
  const processRunning = managed && status.processRunning === true && status.state !== 'stopping';
  const canStart = managed && !processRunning && (status.state === 'stopped' || status.state === 'failed');
  // Only nodes BTCortex set up: those on other computers or run by the user are stopped where they run.
  const canStop = managed && (status.state === 'running' || status.state === 'starting' || processRunning);
  const canRestart = managed && status.state === 'running';

  return (
    <div className="flex flex-wrap gap-2">
      {canRestart && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={restart.isPending}>
              <RotateCw aria-hidden="true" />
              {t('node.restart')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>{t('node.restartTitle', { name: profile.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('node.restartBody')}</AlertDialogDescription>
            <div className="mt-3">
              <NetworkBadge network={profile.network} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  restart.mutate(profile.id, {
                    onSuccess: () => toast.success(t('node.restartRequested', { name: profile.name })),
                    onError: reportFailure,
                  });
                }}
              >
                {t('node.restartConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {canStart && (
        <Button
          disabled={start.isPending}
          onClick={() => {
            start.mutate(profile.id, {
              onSuccess: () => toast.success(t('node.startRequested', { name: profile.name })),
              onError: reportFailure,
            });
          }}
        >
          <Play aria-hidden="true" />
          {t('node.start')}
        </Button>
      )}
      {canStop && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={stop.isPending}>
              <Square aria-hidden="true" />
              {t('node.stop')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>{t('node.stopTitle', { name: profile.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('node.stopBody')}</AlertDialogDescription>
            <div className="mt-3">
              <NetworkBadge network={profile.network} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                destructive
                onClick={() => {
                  stop.mutate(profile.id, {
                    onSuccess: () => toast.success(t('node.stopRequested', { name: profile.name })),
                    onError: reportFailure,
                  });
                }}
              >
                {t('node.stopConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {!canStop && (
        <AlertDialog open={removing} onOpenChange={setRemoving}>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" disabled={remove.isPending}>
              <Trash2 aria-hidden="true" />
              {t('node.remove')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>{t('node.removeTitle', { name: profile.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {profile.dataDirectory ? t('node.removeBodyKept', { path: profile.dataDirectory }) : t('node.removeBody')}
            </AlertDialogDescription>
            <div className="mt-3">
              <NetworkBadge network={profile.network} />
            </div>
            {electrum.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                {t('node.removeElectrumChecking')}
              </p>
            )}
            {electrum.isError && <p className="text-sm text-muted-foreground">{t('node.removeElectrumUnknown')}</p>}
            {electrumServer && (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{t('node.removeElectrum')}</p>
                {(electrumServer.remoteAccess.onion !== null || electrumServer.remoteAccess.addressKept === true) && (
                  <p>{t('node.removeElectrumOnion')}</p>
                )}
                {electrumServer.dataDirectory && (
                  <p>{t('node.removeElectrumIndex', { path: electrumServer.dataDirectory })}</p>
                )}
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                destructive
                disabled={electrum.isPending}
                onClick={() => {
                  remove.mutate(profile.id, {
                    onSuccess: (result) => {
                      const keptIndex =
                        'electrumIndexKept' in result && typeof result.electrumIndexKept === 'string'
                          ? result.electrumIndexKept
                          : null;
                      toast.success(t('node.removed', { name: profile.name }), {
                        description:
                          keptIndex === null ? undefined : t('node.removedElectrumIndex', { path: keptIndex }),
                      });
                      void navigate({ to: '/nodes' });
                    },
                    onError: reportFailure,
                  });
                }}
              >
                {t('node.removeConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function NodeDashboard({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const { profile, status } = node;
  const snapshot = status.snapshot;
  const stale = snapshot !== undefined && status.state !== 'running';

  if (!snapshot) {
    return status.error ? (
      <ErrorPanel title={t('errors.nodeUnavailable')} error={toOrchestratorError(status.error)} />
    ) : (
      <Card>
        <CardContent className="pt-4 text-muted-foreground">{status.detail ?? t('node.notAvailable')}</CardContent>
      </Card>
    );
  }

  const { blockchain, network, mempool, traffic } = snapshot;
  const mempoolFraction = mempool.maxMemoryBytes > 0 ? mempool.memoryUsageBytes / mempool.maxMemoryBytes : 0;
  const warnings = [...new Set([...blockchain.warnings, ...network.warnings])];

  return (
    <div className="space-y-4">
      {stale && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2"
        >
          <TriangleAlert aria-hidden="true" className="size-4 text-warning" />
          {t('nodes.staleData', { time: formatTimestamp(snapshot.takenAt) })}
        </p>
      )}
      {status.error && status.state !== 'running' && (
        <ErrorPanel title={t('errors.nodeUnavailable')} error={toOrchestratorError(status.error)} />
      )}

      <section aria-labelledby="sync-heading" className="space-y-3">
        <h2 id="sync-heading" className="text-base font-semibold">
          {t('node.synchronisation')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label={t('node.blocks')}
            value={formatCompact(blockchain.blocks)}
            context={formatNumber(blockchain.blocks)}
          />
          <StatTile
            label={t('node.headers')}
            value={formatCompact(blockchain.headers)}
            context={formatNumber(blockchain.headers)}
          />
          <StatTile
            label={t('node.verificationProgress')}
            value={formatPercent(blockchain.verificationProgress, 2)}
            context={
              <Meter
                role="progressbar"
                tone="primary"
                value={blockchain.verificationProgress}
                label={t('node.verificationProgress')}
                valueText={formatPercent(blockchain.verificationProgress, 2)}
                className="mt-1"
              />
            }
          />
          <StatTile
            label={t('node.estimate')}
            value={
              blockchain.initialBlockDownload
                ? status.syncEstimate
                  ? t('node.estimateLabel', { duration: formatDuration(status.syncEstimate.remainingSeconds * 1000) })
                  : '—'
                : t('node.complete')
            }
            context={
              blockchain.initialBlockDownload
                ? (status.syncEstimate?.basis ?? t('node.estimateUnavailable'))
                : undefined
            }
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('node.chain')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Field label={t('node.bestBlockHash')}>
                <CopyableValue value={blockchain.bestBlockHash} label={t('node.bestBlockHash')} />
              </Field>
              <Field label={t('node.medianTime')}>
                <span title={formatTimestamp(new Date(blockchain.medianTime * 1000))}>
                  {formatRelativeTime(new Date(blockchain.medianTime * 1000))}
                </span>
              </Field>
              <Field label={t('node.initialDownload')}>
                {blockchain.initialBlockDownload ? t('node.inProgress') : t('node.complete')}
              </Field>
              <Field label={t('node.sizeOnDisk')}>{formatBytes(blockchain.sizeOnDiskBytes)}</Field>
              <Field label={t('node.pruned')}>
                {!blockchain.pruned
                  ? t('node.prunedNo')
                  : blockchain.pruneTargetBytes
                    ? t('node.prunedYes', { size: formatBytes(blockchain.pruneTargetBytes) })
                    : t('node.prunedManual')}
              </Field>
              {blockchain.pruned && blockchain.pruneHeight !== undefined && (
                <Field label={t('node.pruneHeight')}>
                  <span className="tabular">{formatNumber(blockchain.pruneHeight)}</span>
                </Field>
              )}
              <Field label={t('node.difficulty')}>
                <span className="tabular">{formatCompact(blockchain.difficulty)}</span>
              </Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('node.network')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Field label={t('node.connections')}>
                {formatNumber(network.connections)}
                <span className="text-muted-foreground">
                  {' '}
                  ({t('node.connectionsDetail', { incoming: network.connectionsIn, outgoing: network.connectionsOut })})
                </span>
              </Field>
              <Field label={t('node.networkActive')}>
                {network.networkActive ? t('node.active') : t('node.paused')}
              </Field>
              <Field label={t('node.software')}>
                <span className="font-mono text-[13px]">{network.subversion}</span>
              </Field>
              <Field label={t('node.reachableNetworks')}>{network.reachableNetworks.join(', ') || '—'}</Field>
              <Field label={t('node.relayFee')}>{formatFeeRate(network.relayFeeBtcPerKvB)}</Field>
              <Field label={t('node.uptime')}>{formatDuration(snapshot.uptimeSeconds * 1000)}</Field>
              <Field label={t('node.traffic')}>
                {t('node.received')} {formatBytes(traffic.bytesReceived)} · {t('node.sent')}{' '}
                {formatBytes(traffic.bytesSent)}
              </Field>
            </dl>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{t('node.mempool')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label={t('node.mempoolTransactions')} value={formatCompact(mempool.transactions)} />
              <StatTile label={t('node.mempoolSize')} value={formatVirtualBytes(mempool.virtualBytes)} />
              <StatTile label={t('node.mempoolMinimumFee')} value={formatFeeRate(mempool.minimumFeeBtcPerKvB)} />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t('node.mempoolMemory')}</span>
                <span className="tabular">
                  {t('node.mempoolMemoryOf', {
                    used: formatBytes(mempool.memoryUsageBytes),
                    max: formatBytes(mempool.maxMemoryBytes),
                  })}{' '}
                  ({formatPercent(mempoolFraction)})
                </span>
              </div>
              <Meter
                tone={capacityTone(mempoolFraction)}
                value={mempoolFraction}
                label={t('node.mempoolMemory')}
                valueText={formatPercent(mempoolFraction)}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('node.mempoolLocalNotice')}</p>
            <Link
              to="/nodes/$nodeId/mempool"
              params={{ nodeId: profile.id }}
              className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
            >
              {t('node.analyseMempool')}
            </Link>
          </CardContent>
        </Card>
      </div>

      {warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('node.warnings')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {followsKnotsFork(node) && <Note tone="warning">{t('walletsPage.otherChain', { node: node.profile.name })}</Note>}
      <SparrowCard node={node} />

      <Card>
        <CardHeader>
          <CardTitle>{t('node.peersTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p>
            {t('node.peersSummary', {
              count: network.connections,
              incoming: network.connectionsIn,
              outgoing: network.connectionsOut,
            })}
          </p>
          <Link
            to="/nodes/$nodeId/peers"
            params={{ nodeId: profile.id }}
            className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('node.managePeers')}
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('node.details')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            {profile.runtimeVersion && (
              <Field label={t('node.runtime')}>
                {t(`software.products.${profile.implementation}`)} {profile.runtimeVersion}
              </Field>
            )}
            {profile.dataDirectory && (
              <Field label={t('node.dataDirectory')}>
                <CopyableValue value={profile.dataDirectory} label={t('node.dataDirectory')} />
              </Field>
            )}
            <Field label={t('node.rpcEndpoint')}>
              <span className="font-mono text-[13px]">{profile.rpcEndpoint}</span>
            </Field>
          </dl>
          <Link
            to="/logs"
            search={{ source: `node:${profile.id}:debug` }}
            className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            <ScrollText aria-hidden="true" className="size-4" />
            {t('node.openLog')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export type NodeSection = 'overview' | 'peers' | 'privacy' | 'mempool' | 'storage' | 'configuration' | 'console';

function SectionNav({ nodeId, section }: { nodeId: string; section: NodeSection }) {
  const { t } = useTranslation();
  const linkClass =
    'inline-flex h-9 items-center border-b-2 px-3 text-sm font-medium transition-colors duration-150 hover:text-foreground';
  // Exact matching: by prefix, the router would also mark Overview as the current page on every sub-section.
  const state = (item: NodeSection) => ({
    activeOptions: { exact: true },
    ...(item === section
      ? { 'aria-current': 'page' as const, className: `${linkClass} border-primary text-foreground` }
      : { className: `${linkClass} border-transparent text-muted-foreground` }),
  });
  return (
    <nav aria-label={t('node.sectionsLabel')} className="border-b">
      <ul className="-mb-px flex gap-1">
        <li>
          <Link to="/nodes/$nodeId" params={{ nodeId }} {...state('overview')}>
            {t('node.sections.overview')}
          </Link>
        </li>
        <li>
          <Link to="/nodes/$nodeId/peers" params={{ nodeId }} {...state('peers')}>
            {t('node.sections.peers')}
          </Link>
        </li>
        <li>
          <Link to="/nodes/$nodeId/privacy" params={{ nodeId }} {...state('privacy')}>
            {t('node.sections.privacy')}
          </Link>
        </li>
        <li>
          <Link to="/nodes/$nodeId/mempool" params={{ nodeId }} {...state('mempool')}>
            {t('node.sections.mempool')}
          </Link>
        </li>
        <li>
          <Link to="/nodes/$nodeId/storage" params={{ nodeId }} {...state('storage')}>
            {t('node.sections.storage')}
          </Link>
        </li>
        <li>
          <Link to="/nodes/$nodeId/configuration" params={{ nodeId }} {...state('configuration')}>
            {t('node.sections.configuration')}
          </Link>
        </li>
        <li>
          <Link to="/nodes/$nodeId/console" params={{ nodeId }} {...state('console')}>
            {t('node.sections.console')}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

export function NodeDetailPage({ nodeId, section = 'overview' }: { nodeId: string; section?: NodeSection }) {
  const { t } = useTranslation();
  const node = useNode(nodeId);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <Breadcrumbs
        trail={[
          <Link key="nodes" to="/nodes">
            {t('navigation.nodes')}
          </Link>,
          ...(section === 'overview' || !node.data
            ? []
            : [
                <Link key="node" to="/nodes/$nodeId" params={{ nodeId }}>
                  {node.data.profile.name}
                </Link>,
              ]),
        ]}
        current={section === 'overview' ? node.data?.profile.name : t(`node.sections.${section}`)}
      />
      {node.isError ? (
        <ErrorPanel
          title={t('errors.nodeUnavailable')}
          error={toOrchestratorError(node.error)}
          onRetry={() => void node.refetch()}
        />
      ) : !node.data ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1
                  className="truncate font-mono text-xl font-semibold"
                  title={truncateMiddle(node.data.profile.name, 40, 0)}
                >
                  {node.data.profile.name}
                </h1>
                <NetworkBadge network={node.data.profile.network} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                <NodeStateIndicator status={node.data.status} />
                {node.data.status.detail && <span className="text-muted-foreground">{node.data.status.detail}</span>}
              </div>
            </div>
            <NodeActions node={node.data} />
          </div>
          <SectionNav nodeId={nodeId} section={section} />
          {section === 'configuration' ? (
            <ConfigurationPage node={node.data} />
          ) : section === 'peers' ? (
            <PeersPage node={node.data} />
          ) : section === 'privacy' ? (
            <NodePrivacyPage node={node.data} />
          ) : section === 'mempool' ? (
            <MempoolPage node={node.data} />
          ) : section === 'storage' ? (
            <StoragePage node={node.data} />
          ) : section === 'console' ? (
            <ConsolePage node={node.data} />
          ) : (
            <NodeDashboard node={node.data} />
          )}
        </>
      )}
    </div>
  );
}
