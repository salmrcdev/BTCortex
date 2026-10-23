import { HardDrive, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { DiskUsage, ManagedFolder, StorageForecast } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { capacityTone, Meter } from '@/components/data/meter';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatList, formatPercent, formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useDiskUsage, useDiskUsageActions } from './queries';

// Storage across BTCortex (specification section 27): the volumes its data is
// on, each folder with the service that owns it, the leftovers of BTCortex's
// own that can be removed safely, and how fast each node's block files grow.
// Blockchain data, indexes, wallets, backups and exports are never deleted
// from here; WSL2 and Docker disks are shown but belong to those programs.

/** A forecast this close is worth a warning rather than a remark. */
const SOON_DAYS = 30;

function Volumes({ usage }: { usage: DiskUsage }) {
  const { t } = useTranslation();
  const names = new Map(usage.folders.map((folder) => [folder.id, folder.ownerName]));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {usage.volumes.map((volume) => {
        const used = volume.totalBytes > 0 ? (volume.totalBytes - volume.freeBytes) / volume.totalBytes : 0;
        return (
          <Card key={volume.root}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 font-mono">
                <HardDrive aria-hidden="true" className="size-4 text-muted-foreground" />
                {volume.root}
              </CardTitle>
              <Badge variant="outline">{t(`diskUsage.kinds.${volume.kind}`)}</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              <Meter
                value={used}
                tone={capacityTone(used)}
                label={t('diskUsage.used', { root: volume.root })}
                valueText={formatPercent(used)}
              />
              <p>
                {t('diskUsage.free', {
                  used: formatPercent(used),
                  free: formatBytes(volume.freeBytes),
                  total: formatBytes(volume.totalBytes),
                })}
              </p>
              <p className="text-muted-foreground">
                {t('diskUsage.holds', {
                  names: formatList([...new Set(volume.folders.map((id) => names.get(id) ?? id))]),
                })}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Forecast({ forecast }: { forecast: StorageForecast }) {
  const { t } = useTranslation();
  const measured = t('diskUsage.days', { count: Math.max(1, Math.round(forecast.measuredDays)) });
  if (forecast.daysUntilFull === null) {
    return (
      <li className="space-y-1 py-3">
        <p className="font-medium">{forecast.name}</p>
        <p className="text-muted-foreground">{t('diskUsage.notGrowing', { measured })}</p>
      </li>
    );
  }
  const text = t('diskUsage.growing', {
    growth: formatBytes(forecast.growthBytesPerDay),
    measured,
    volume: forecast.volume,
    left:
      forecast.daysUntilFull > 365
        ? t('diskUsage.moreThanAYear')
        : t('diskUsage.days', { count: Math.max(1, Math.round(forecast.daysUntilFull)) }),
  });
  return (
    <li className="space-y-1 py-3">
      <p className="font-medium">{forecast.name}</p>
      {forecast.daysUntilFull < SOON_DAYS ? (
        <Note tone="warning">
          {text} {t('diskUsage.soon', { volume: forecast.volume })}
        </Note>
      ) : (
        <p className="text-muted-foreground">{text}</p>
      )}
    </li>
  );
}

function CleanupButton({ folder, blocked }: { folder: ManagedFolder; blocked: boolean }) {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const { clean } = useDiskUsageActions();
  const cleanup = folder.cleanup;
  if (!cleanup) return null;
  const size = formatBytes(cleanup.bytes);
  return (
    <ConfirmButton
      label={t('diskUsage.clean', { size })}
      title={t(`diskUsage.cleanTitle.${cleanup.kind}`)}
      confirmLabel={t('diskUsage.cleanConfirm')}
      destructive
      disabled={blocked || clean.isPending}
      onConfirm={() => {
        clean.mutate(cleanup.kind, {
          onSuccess: (result) => {
            toast.success(t('diskUsage.cleaned', { count: result.files, size: formatBytes(result.freedBytes) }));
          },
          onError,
        });
      }}
    >
      <p>{t(`diskUsage.cleanBody.${cleanup.kind}`, { count: cleanup.files, size })}</p>
    </ConfirmButton>
  );
}

function Folders({ usage }: { usage: DiskUsage }) {
  const { t } = useTranslation();
  const folders = [...usage.folders].sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('diskUsage.folders')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {usage.cleanupBlockedBy !== null && <Note tone="info">{usage.cleanupBlockedBy}</Note>}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('diskUsage.owner')}</TableHead>
                <TableHead>{t('diskUsage.location')}</TableHead>
                <TableHead className="text-right">{t('diskUsage.size')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('diskUsage.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {folders.map((folder) => {
                const other = folder.owner === 'wsl' || folder.owner === 'docker';
                return (
                  <TableRow key={folder.id}>
                    <TableCell className="min-w-56">
                      <span className="flex flex-wrap items-center gap-2">
                        {folder.route === null ? (
                          <span className="font-medium">{folder.ownerName}</span>
                        ) : (
                          <a href={`#${folder.route}`} className="font-medium underline-offset-2 hover:underline">
                            {folder.ownerName}
                          </a>
                        )}
                        {folder.readOnly && (
                          <Badge variant="outline">{t(other ? 'diskUsage.notUsed' : 'diskUsage.readOnly')}</Badge>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t(`diskUsage.owners.${folder.owner}`)}
                      </span>
                    </TableCell>
                    {/* Takes the room the other columns leave and shortens long paths, which can still be copied whole. */}
                    <TableCell className="w-full max-w-0">
                      <CopyableValue
                        value={folder.path}
                        truncate="start"
                        label={t('diskUsage.locationOf', { name: folder.ownerName })}
                      />
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap text-right">
                      {folder.bytes === null ? t('diskUsage.notMeasured') : formatBytes(folder.bytes)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <CleanupButton folder={folder} blocked={usage.cleanupBlockedBy !== null} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function DiskUsagePage() {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const usage = useDiskUsage();
  const { measure } = useDiskUsageActions();
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-mono text-xl font-semibold">{t('diskUsage.title')}</h1>
          <p className="max-w-prose text-muted-foreground">{t('diskUsage.description')}</p>
        </div>
        <Button
          variant="outline"
          disabled={measure.isPending || usage.isPending}
          onClick={() => {
            measure.mutate(undefined, { onError });
          }}
        >
          <RefreshCw aria-hidden="true" className={measure.isPending ? 'motion-safe:animate-spin' : undefined} />
          {t('diskUsage.measure')}
        </Button>
      </div>
      {usage.isError ? (
        <ErrorPanel
          title={t('diskUsage.unavailable')}
          error={toOrchestratorError(usage.error)}
          onRetry={() => void usage.refetch()}
        />
      ) : usage.data === undefined ? (
        <div className="space-y-3" aria-busy="true">
          <p className="text-muted-foreground">{t('diskUsage.measuring')}</p>
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <p className="text-muted-foreground">
            {t('diskUsage.measuredAt', { time: formatTimestamp(usage.data.measuredAt) })}
          </p>
          <Volumes usage={usage.data} />
          <Card>
            <CardHeader>
              <CardTitle>{t('diskUsage.growth')}</CardTitle>
            </CardHeader>
            <CardContent>
              {usage.data.forecasts.length === 0 ? (
                <p className="text-muted-foreground">{t('diskUsage.noForecast')}</p>
              ) : (
                <ul className="divide-y">
                  {usage.data.forecasts.map((forecast) => (
                    <Forecast key={forecast.nodeId} forecast={forecast} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Folders usage={usage.data} />
          <Note tone="info">{t('diskUsage.never')}</Note>
          <p className="max-w-prose text-muted-foreground">{t('diskUsage.virtual')}</p>
        </>
      )}
    </div>
  );
}
