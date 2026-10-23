import { Link } from '@tanstack/react-router';
import { HardDrive, Info, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { IndexId, IndexStatus, NodeWithStatus, StorageOverview, StorageWarning } from '@btcortex/contracts';
import { BarList } from '@/components/charts/bar-list';
import { CopyableValue } from '@/components/data/copyable-value';
import { capacityTone, Meter } from '@/components/data/meter';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes, formatDate, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { cn } from '@/lib/utils';
import { useElectrumOverview } from '@/features/electrum/queries';
import { useStorageActions, useStorageOverview } from './queries';

// Storage and indexing (specification section 5.10): where the node keeps its
// data, how much room is left, how it prunes, which indexes it builds, what
// changing any of that would mean, and the maintenance Bitcoin Core supports.
// Changes are offered only for nodes BTCortex set up, always after a
// confirmation that says what will happen.

const WARNING_STYLE: Record<StorageWarning['severity'], { box: string; icon: string }> = {
  danger: { box: 'border-danger/40 bg-danger/10', icon: 'text-danger' },
  warning: { box: 'border-warning/40 bg-warning/10', icon: 'text-warning' },
  info: { box: 'border-border bg-card', icon: 'text-info' },
};

/** Indexes that need every block, which Bitcoin Core refuses together with pruning. */
const NEEDS_EVERY_BLOCK: ReadonlySet<IndexId> = new Set(['txindex', 'txospenderindex']);
const MIB_PER_GIB = 1024;

function RemoveIndexFiles({ nodeId, warning }: { nodeId: string; warning: StorageWarning }) {
  const { t } = useTranslation();
  const actions = useStorageActions(nodeId);
  const onError = useErrorFeedback();
  const part = warning.part;
  if (!part) return null;
  return (
    <ConfirmButton
      label={t('storage.actions.removeFiles')}
      title={t('storage.actions.removeFilesTitle', { part: t(`storage.parts.${part}`).toLowerCase() })}
      confirmLabel={t('storage.actions.removeFilesConfirm')}
      destructive
      disabled={actions.removeIndexFiles.isPending}
      onConfirm={() => {
        actions.removeIndexFiles.mutate(part, {
          onSuccess: ({ removedBytes }) =>
            toast.success(t('storage.actions.removed', { size: formatBytes(removedBytes) })),
          onError,
        });
      }}
    >
      <p>{t('storage.actions.removeFilesBody', { size: formatBytes(warning.bytes ?? 0) })}</p>
    </ConfirmButton>
  );
}

function WarningMessage({ warning, overview }: { warning: StorageWarning; overview: StorageOverview }) {
  const { t } = useTranslation();
  const free = formatBytes(overview.volume?.freeBytes ?? 0);
  const size = formatBytes(warning.bytes ?? 0);
  switch (warning.code) {
    case 'disk-critical':
      return <>{t('storage.warnings.disk-critical', { free })}</>;
    case 'disk-low':
      return <>{t('storage.warnings.disk-low', { free })}</>;
    case 'chain-will-not-fit':
      return <>{t('storage.warnings.chain-will-not-fit', { needed: size, free })}</>;
    case 'hard-disk':
      return <>{t('storage.warnings.hard-disk')}</>;
    case 'external-drive':
      return <>{t('storage.warnings.external-drive')}</>;
    case 'unused-index':
      return warning.part === 'old-coinstatsindex' ? (
        <>{t('storage.warnings.unused-old-index', { size })}</>
      ) : (
        <>
          {t('storage.warnings.unused-index', {
            part: t(`storage.parts.${warning.part ?? 'other'}`).toLowerCase(),
            size,
          })}
        </>
      );
  }
}

function Warnings({ nodeId, overview }: { nodeId: string; overview: StorageOverview }) {
  if (overview.warnings.length === 0) return null;
  return (
    <ul className="space-y-2">
      {overview.warnings.map((warning) => {
        const style = WARNING_STYLE[warning.severity];
        const Icon = warning.severity === 'info' ? Info : TriangleAlert;
        return (
          <li
            key={`${warning.code}-${warning.part ?? ''}`}
            className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2', style.box)}
          >
            <span className="flex min-w-0 flex-1 items-start gap-2">
              <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', style.icon)} />
              <span>
                <WarningMessage warning={warning} overview={overview} />
              </span>
            </span>
            {warning.code === 'unused-index' && overview.manageable && overview.local && (
              <RemoveIndexFiles nodeId={nodeId} warning={warning} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Disk({ overview }: { overview: StorageOverview }) {
  const { t } = useTranslation();
  const { volume } = overview;
  if (!volume) return null;
  const used = volume.totalBytes > 0 ? (volume.totalBytes - volume.freeBytes) / volume.totalBytes : 0;
  // The meter agrees with the free-space warning above it, which counts what is left rather than a share.
  const codes = new Set(overview.warnings.map((warning) => warning.code));
  const tone = codes.has('disk-critical') ? 'danger' : codes.has('disk-low') ? 'warning' : capacityTone(used);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('storage.diskTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex items-center gap-2 font-medium">
          <HardDrive aria-hidden="true" className="size-4 text-muted-foreground" />
          {t(`storage.diskKind.${volume.kind}`)}
        </p>
        <p className="text-muted-foreground">
          {t('storage.diskDetails', { root: volume.root })}
          {volume.bus && `, ${t('storage.diskBus', { bus: volume.bus })}`}
          {volume.model && ` · ${volume.model}`}
        </p>
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t('storage.diskUsed')}</span>
            <span className="tabular">
              {t('storage.diskFree', { free: formatBytes(volume.freeBytes), total: formatBytes(volume.totalBytes) })}
            </span>
          </div>
          <Meter tone={tone} value={used} label={t('storage.diskUsed')} valueText={formatPercent(used)} />
        </div>
      </CardContent>
    </Card>
  );
}

function NodeData({ overview }: { overview: StorageOverview }) {
  const { t } = useTranslation();
  const parts = (overview.breakdown ?? []).filter(
    (part) => part.bytes > 0 || part.id === 'blocks' || part.id === 'chainstate',
  );
  const total = parts.reduce((sum, part) => sum + part.bytes, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('storage.dataTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {overview.breakdown && <p>{t('storage.dataTotal', { size: formatBytes(total) })}</p>}
        <p className="text-muted-foreground">
          {t('storage.blockFiles', { size: formatBytes(overview.blockFilesBytes) })}
        </p>
        {overview.breakdown && (
          <BarList
            caption={t('storage.breakdownCaption')}
            rows={parts.map((part) => ({
              key: part.id,
              label: t(`storage.parts.${part.id}`),
              value: part.bytes,
              valueText: formatBytes(part.bytes),
            }))}
            labelHeading={t('storage.partHeading')}
            valueHeading={t('storage.sizeHeading')}
            shareHeading={t('storage.shareHeading')}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Asks for a prune target in whole GiB; Bitcoin Core takes MiB. */
function PruneTargetDialog({
  nodeId,
  overview,
  label,
  title,
  body,
}: {
  nodeId: string;
  overview: StorageOverview;
  label: string;
  title: string;
  body: string;
}) {
  const { t } = useTranslation();
  const fieldId = useId();
  const actions = useStorageActions(nodeId);
  const onError = useErrorFeedback();
  const current = overview.pruning.targetBytes;
  const [text, setText] = useState(String(current === null ? 10 : Math.max(1, Math.round(current / 1024 ** 3))));
  const gib = Number(text);
  const valid = /^\d+$/.test(text.trim()) && gib >= 1;
  // Pruning is refused together with these indexes, so switching it on switches them off.
  const blocking = overview.indexes
    .filter((index) => NEEDS_EVERY_BLOCK.has(index.id))
    .filter((index) => index.enabled || overview.configured?.indexes[index.id] === true);
  return (
    <ConfirmButton
      label={label}
      title={title}
      confirmLabel={overview.pruning.enabled ? t('storage.actions.saveAndRestart') : t('storage.actions.pruneConfirm')}
      destructive
      disabled={actions.configure.isPending}
      confirmDisabled={!valid}
      onConfirm={() => {
        actions.configure.mutate(
          {
            pruning: { mode: 'automatic', targetMiB: gib * MIB_PER_GIB },
            ...(blocking.length > 0 ? { indexes: Object.fromEntries(blocking.map((index) => [index.id, false])) } : {}),
          },
          { onSuccess: () => toast.success(t('storage.actions.configured')), onError },
        );
      }}
    >
      <p>{body}</p>
      {!overview.pruning.enabled && (
        <ul className="list-inside list-disc space-y-1">
          <li>{t('storage.toPruned.deletes')}</li>
          <li>{t('storage.toPruned.electrum')}</li>
          <li>{t('storage.toPruned.rescan')}</li>
        </ul>
      )}
      {blocking.length > 0 && <p>{t('storage.actions.pruneIndexesOff')}</p>}
      <div className="space-y-1 pt-1 text-foreground">
        <Label htmlFor={fieldId} className="block">
          {t('storage.actions.target')}
        </Label>
        <Input
          id={fieldId}
          inputMode="numeric"
          className="w-32"
          value={text}
          aria-invalid={!valid}
          aria-describedby={`${fieldId}-help`}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <p id={`${fieldId}-help`} className={cn('text-xs', valid ? 'text-muted-foreground' : 'text-danger')}>
          {valid ? t('storage.actions.targetHelp') : t('storage.actions.targetInvalid')}
        </p>
      </div>
    </ConfirmButton>
  );
}

function Unprune({ nodeId, overview }: { nodeId: string; overview: StorageOverview }) {
  const { t } = useTranslation();
  const actions = useStorageActions(nodeId);
  const onError = useErrorFeedback();
  const full = overview.expectedFullBytes;
  const needed = full === null ? 0 : Math.max(0, full - overview.blockFilesBytes);
  const noRoom = overview.volume !== null && needed > overview.volume.freeBytes;
  return (
    <ConfirmButton
      label={t('storage.actions.unprune')}
      title={t('storage.actions.unpruneTitle')}
      confirmLabel={t('storage.actions.unpruneConfirm')}
      destructive
      disabled={actions.configure.isPending}
      confirmDisabled={noRoom}
      onConfirm={() => {
        actions.configure.mutate(
          { pruning: { mode: 'off' } },
          { onSuccess: () => toast.success(t('storage.actions.configuredReindex')), onError },
        );
      }}
    >
      <p>{t('storage.actions.unpruneBody', { size: full === null ? '—' : formatBytes(full, 0) })}</p>
      {noRoom && (
        <p className="text-danger">
          {t('storage.actions.unpruneNoRoom', {
            needed: formatBytes(needed, 0),
            free: formatBytes(overview.volume?.freeBytes ?? 0, 0),
          })}
        </p>
      )}
    </ConfirmButton>
  );
}

function Pruning({ nodeId, overview }: { nodeId: string; overview: StorageOverview }) {
  const { t } = useTranslation();
  const { pruning } = overview;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('storage.pruningTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="font-medium">
          {!pruning.enabled
            ? t('storage.pruningOff')
            : pruning.automatic
              ? t('storage.pruningOn', { target: formatBytes(pruning.targetBytes ?? 0) })
              : t('storage.pruningManual')}
        </p>
        {pruning.enabled && pruning.pruneHeight !== null && (
          <p>
            {t('storage.pruneHeight', {
              height: formatNumber(pruning.pruneHeight),
              date: pruning.pruneTime === null ? '—' : formatDate(new Date(pruning.pruneTime * 1000)),
            })}
          </p>
        )}
        <section aria-labelledby="pruning-consequences" className="space-y-1">
          <h3 id="pruning-consequences" className="font-medium">
            {pruning.enabled ? t('storage.toFullTitle') : t('storage.toPrunedTitle')}
          </h3>
          <ul className="list-inside list-disc space-y-1 text-muted-foreground">
            {pruning.enabled ? (
              <>
                <li>
                  {t('storage.toFull.download', {
                    size: overview.expectedFullBytes === null ? '—' : formatBytes(overview.expectedFullBytes, 0),
                  })}
                </li>
                <li>{t('storage.toFull.space')}</li>
              </>
            ) : (
              <>
                <li>{t('storage.toPruned.deletes')}</li>
                <li>{t('storage.toPruned.txindex')}</li>
                <li>{t('storage.toPruned.electrum')}</li>
                <li>{t('storage.toPruned.rescan')}</li>
              </>
            )}
          </ul>
        </section>
        {overview.manageable && (
          <div className="flex flex-wrap gap-2 pt-1">
            {pruning.enabled ? (
              <>
                <PruneTargetDialog
                  nodeId={nodeId}
                  overview={overview}
                  label={t('storage.actions.changeTarget')}
                  title={t('storage.actions.changeTargetTitle')}
                  body={t('storage.actions.changeTargetBody')}
                />
                <Unprune nodeId={nodeId} overview={overview} />
              </>
            ) : (
              <PruneTargetDialog
                nodeId={nodeId}
                overview={overview}
                label={t('storage.actions.prune')}
                title={t('storage.actions.pruneTitle')}
                body={t('storage.actions.pruneBody')}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IndexSwitch({ nodeId, index, overview }: { nodeId: string; index: IndexStatus; overview: StorageOverview }) {
  const { t } = useTranslation();
  const actions = useStorageActions(nodeId);
  const onError = useErrorFeedback();
  const name = t(`storage.indexes.${index.id}.name`);
  const lowerName = name.charAt(0).toLowerCase() + name.slice(1);
  // What the configuration asks for wins: the switch shows the state after the next restart.
  const on = overview.configured?.indexes[index.id] ?? index.enabled;
  const impossible = !on && NEEDS_EVERY_BLOCK.has(index.id) && overview.pruning.enabled;
  return (
    <ConfirmButton
      label={on ? t('storage.actions.switchOff') : t('storage.actions.switchOn')}
      title={
        on
          ? t('storage.actions.switchOffTitle', { name: lowerName })
          : t('storage.actions.switchOnTitle', { name: lowerName })
      }
      confirmLabel={t('storage.actions.saveAndRestart')}
      disabled={impossible || actions.configure.isPending}
      onConfirm={() => {
        actions.configure.mutate(
          { indexes: { [index.id]: !on } },
          { onSuccess: () => toast.success(t('storage.actions.configured')), onError },
        );
      }}
    >
      <p>{on ? t('storage.actions.switchOffBody') : t('storage.actions.switchOnBody')}</p>
    </ConfirmButton>
  );
}

function IndexRow({ nodeId, index, overview }: { nodeId: string; index: IndexStatus; overview: StorageOverview }) {
  const { t } = useTranslation();
  const tip = overview.chain.height;
  const progress = tip > 0 && index.bestBlockHeight !== null ? Math.min(1, index.bestBlockHeight / tip) : 0;
  const impossible = NEEDS_EVERY_BLOCK.has(index.id) && !index.enabled && overview.pruning.enabled;
  const configured = overview.configured?.indexes[index.id];
  return (
    <li className="space-y-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="font-medium">{t(`storage.indexes.${index.id}.name`)}</p>
        <div className="flex items-center gap-3">
          <StatusIndicator
            tone={!index.enabled ? 'inactive' : index.synced ? 'healthy' : 'working'}
            label={
              !index.enabled
                ? t('storage.indexStatus.off')
                : index.synced
                  ? t('storage.indexStatus.ready')
                  : t('storage.indexStatus.building', { percent: formatPercent(progress, 1) })
            }
          />
          {overview.manageable && <IndexSwitch nodeId={nodeId} index={index} overview={overview} />}
        </div>
      </div>
      <p className="text-muted-foreground">{t(`storage.indexes.${index.id}.purpose`)}</p>
      {index.enabled && !index.synced && (
        <div className="space-y-1 pt-1">
          <Meter
            tone="info"
            role="progressbar"
            value={progress}
            label={t(`storage.indexes.${index.id}.name`)}
            valueText={formatPercent(progress, 1)}
          />
          <p className="tabular text-xs text-muted-foreground">
            {t('storage.indexHeight', {
              height: formatNumber(index.bestBlockHeight ?? 0),
              tip: formatNumber(tip),
            })}
          </p>
        </div>
      )}
      {index.bytes !== null && index.bytes > 0 && (
        <p className="tabular text-xs text-muted-foreground">{formatBytes(index.bytes)}</p>
      )}
      {configured !== undefined && configured !== index.enabled && (
        <p className="text-xs text-muted-foreground">{configured ? t('storage.pendingOn') : t('storage.pendingOff')}</p>
      )}
      {impossible && <p className="text-xs text-muted-foreground">{t('storage.txindexPruned')}</p>}
    </li>
  );
}

function Indexes({ nodeId, overview }: { nodeId: string; overview: StorageOverview }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('storage.indexesTitle')}</CardTitle>
          <CardDescription>{t('storage.indexesDescription')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {overview.indexes.map((index) => (
            <IndexRow key={index.id} nodeId={nodeId} index={index} overview={overview} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Maintenance({ nodeId, overview }: { nodeId: string; overview: StorageOverview }) {
  const { t } = useTranslation();
  const actions = useStorageActions(nodeId);
  const onError = useErrorFeedback();
  const verification = actions.verify.data;
  const busy = actions.reindex.isPending;
  const reindexStarted = () => toast.success(t('storage.actions.reindexStarted'));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('storage.actions.maintenanceTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={actions.verify.isPending}
              onClick={() => {
                actions.verify.mutate(undefined, { onError });
              }}
            >
              {actions.verify.isPending ? t('common.loading') : t('storage.actions.verify')}
            </Button>
            <p className="text-muted-foreground">{t('storage.actions.verifyHelp')}</p>
          </div>
          {verification && (
            <p role="status" className={verification.valid ? undefined : 'text-danger'}>
              {verification.valid
                ? t('storage.actions.verifyOk', {
                    blocks: verification.blocks,
                    duration: formatDuration(verification.durationMs),
                  })
                : t('storage.actions.verifyFailed')}
            </p>
          )}
        </div>
        {overview.manageable ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <ConfirmButton
                label={t('storage.actions.reindexChainstate')}
                title={t('storage.actions.reindexChainstateTitle')}
                confirmLabel={t('storage.actions.reindexConfirm')}
                destructive
                disabled={busy || overview.pruning.enabled}
                onConfirm={() => {
                  actions.reindex.mutate('chainstate', { onSuccess: reindexStarted, onError });
                }}
              >
                <p>{t('storage.actions.reindexChainstateBody')}</p>
              </ConfirmButton>
              <p className="text-muted-foreground">{t('storage.actions.reindexChainstateHelp')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ConfirmButton
                label={t('storage.actions.reindexFull')}
                title={t('storage.actions.reindexFullTitle')}
                confirmLabel={t('storage.actions.reindexConfirm')}
                destructive
                disabled={busy}
                onConfirm={() => {
                  actions.reindex.mutate('full', { onSuccess: reindexStarted, onError });
                }}
              >
                <p>
                  {overview.pruning.enabled
                    ? t('storage.actions.reindexFullPrunedBody', {
                        size: overview.expectedFullBytes === null ? '—' : formatBytes(overview.expectedFullBytes, 0),
                      })
                    : t('storage.actions.reindexFullBody')}
                </p>
              </ConfirmButton>
              <p className="text-muted-foreground">{t('storage.actions.reindexFullHelp')}</p>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">{t('storage.notManageable')}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** The node's Electrum server index, which lives outside the node's own folder. */
function ElectrumIndex({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const electrum = useElectrumOverview();
  const server = electrum.data?.servers.find((candidate) => candidate.nodeId === nodeId);
  if (!server || server.state === 'not-set-up' || server.dataDirectory === null) {
    return (
      <p className="text-muted-foreground">
        {t('storage.electrumIndexNone')}{' '}
        <Link to="/electrum" className="underline underline-offset-2">
          {t('navigation.electrum')}
        </Link>
      </p>
    );
  }
  return (
    <div className="grid gap-x-4 sm:grid-cols-[16rem_1fr_auto] sm:items-baseline">
      <span className="text-muted-foreground">{t('storage.electrumIndex')}</span>
      <span className="min-w-0">
        <CopyableValue value={server.dataDirectory} label={t('storage.electrumIndex')} />
      </span>
      <span className="tabular text-muted-foreground sm:text-right">
        {server.indexBytes === null ? '—' : formatBytes(server.indexBytes)}
      </span>
    </div>
  );
}

function WalletsAndLocations({ nodeId, overview }: { nodeId: string; overview: StorageOverview }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('storage.walletsTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {overview.wallets && (
          <p>
            {overview.wallets.count === 0
              ? t('storage.walletsNone')
              : t('storage.wallets', { count: overview.wallets.count, size: formatBytes(overview.wallets.bytes) })}
          </p>
        )}
        {overview.pruning.enabled && overview.pruning.pruneTime !== null && (
          <p className="text-muted-foreground">
            {t('storage.walletsPruned', { date: formatDate(new Date(overview.pruning.pruneTime * 1000)) })}
          </p>
        )}
        <section aria-labelledby="storage-locations" className="space-y-2">
          <h3 id="storage-locations" className="font-medium">
            {t('storage.locationsHeading')}
          </h3>
          <dl className="space-y-2">
            {overview.locations.map((location) => (
              <div key={location.id} className="grid gap-x-4 sm:grid-cols-[16rem_1fr_auto] sm:items-baseline">
                <dt className="text-muted-foreground">{t(`storage.locations.${location.id}`)}</dt>
                <dd className="min-w-0">
                  <CopyableValue value={location.path} label={t(`storage.locations.${location.id}`)} />
                </dd>
                <dd className="tabular text-muted-foreground sm:text-right">
                  {location.bytes === null ? '—' : formatBytes(location.bytes)}
                </dd>
              </div>
            ))}
          </dl>
          <ElectrumIndex nodeId={nodeId} />
        </section>
      </CardContent>
    </Card>
  );
}

export function StoragePage({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const nodeId = node.profile.id;
  const running = node.status.state === 'running';
  const overview = useStorageOverview(nodeId, running);
  if (!running) return <p className="py-6 text-muted-foreground">{t('storage.notRunning')}</p>;
  if (overview.isError) {
    return (
      <ErrorPanel
        title={t('storage.unavailable')}
        error={toOrchestratorError(overview.error)}
        onRetry={() => void overview.refetch()}
      />
    );
  }
  if (!overview.data) return <Skeleton className="h-64" />;
  const data = overview.data;
  return (
    <div className="space-y-4">
      {!data.local && (
        <p className="flex items-start gap-2 rounded-md border px-3 py-2">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
          <span>{t('storage.remote')}</span>
        </p>
      )}
      <Warnings nodeId={nodeId} overview={data} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Disk overview={data} />
        <Pruning nodeId={nodeId} overview={data} />
      </div>
      <NodeData overview={data} />
      <Indexes nodeId={nodeId} overview={data} />
      <Maintenance nodeId={nodeId} overview={data} />
      <WalletsAndLocations nodeId={nodeId} overview={data} />
    </div>
  );
}
