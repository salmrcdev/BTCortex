import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type {
  InstalledProduct,
  InstalledSoftware,
  IntegrityReport,
  NodeWithStatus,
  SoftwareUpdate,
} from '@btcortex/contracts';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { JobProgress } from '@/components/feedback/job-progress';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatDate } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useJob, useNodes } from '@/features/nodes/queries';
import { UPDATE_STAGES, useInstalledSoftware, useSoftwareActions, useSoftwareUpdates } from './queries';

// Software BTCortex installed from verified releases (specification sections
// 6 and 17.3): what was verified, newer releases, side-by-side updates, a check
// of every file, safe removal, and moving a node to a newer version of its own
// software. Bitcoin Knots shows only once BTCortex installed it, and a node
// never moves between Bitcoin Core and Knots, which follow different chains.

const PRODUCTS: readonly InstalledProduct[] = ['bitcoin-core', 'bitcoin-knots', 'sparrow', 'tor', 'hwi'];

/** A release version as numbers: 31.1 → [31, 1, 0, 0]; 29.4.2.knots20260508 → [29, 4, 2, 20260508]. */
function versionParts(version: string): number[] {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:\.knots(\d{8}))?$/.exec(version);
  return match ? [match[1], match[2], match[3], match[4]].map((part) => Number(part ?? 0)) : [];
}

/** Release versions, compared part by part. */
function isNewer(candidate: string, than: string): boolean {
  const a = versionParts(candidate);
  const b = versionParts(than);
  if (a.length === 0 || b.length === 0) return false;
  for (let index = 0; index < a.length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function UpdateStatus({ product, update }: { product: InstalledProduct; update: SoftwareUpdate | undefined }) {
  const { t } = useTranslation();
  const actions = useSoftwareActions();
  const onError = useErrorFeedback();
  const updates = useSoftwareUpdates();
  const [jobId, setJobId] = useState<string>();
  const job = useJob(jobId);
  const state = job.data?.state;
  const latest = update?.latest ?? null;

  // A finished job is reported once, however often the page renders afterwards.
  const reported = useRef<string>(undefined);
  useEffect(() => {
    if (state !== 'succeeded' || !latest || jobId === undefined || reported.current === jobId) return;
    reported.current = jobId;
    toast.success(t('software.updated', { product: t(`software.products.${product}`), version: latest }));
    void actions.refresh();
  }, [state, latest, jobId, actions, product, t]);

  if (updates.isPending) return <p className="text-muted-foreground">{t('software.checking')}</p>;
  if (job.data && (state === 'queued' || state === 'running')) {
    return (
      <div className="space-y-2">
        <p className="font-medium">{t('software.updating')}</p>
        <JobProgress
          job={job.data}
          stages={UPDATE_STAGES.map((stage) => ({ id: stage, label: t(`software.stages.${stage}`) }))}
        />
      </div>
    );
  }
  if (job.data?.state === 'failed' && job.data.error) {
    return (
      <ErrorPanel
        title={t('software.updateFailed')}
        error={toOrchestratorError({ code: -32000, message: job.data.error.message, data: job.data.error })}
      />
    );
  }
  if (!update || update.error) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <StatusIndicator tone="attention" label={t('software.checkFailed', { reason: update?.error ?? '' })} />
        <Button variant="outline" onClick={() => void updates.refetch()}>
          <RefreshCw aria-hidden="true" />
          {t('software.checkAgain')}
        </Button>
      </div>
    );
  }
  if (update.updateAvailable && latest) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <StatusIndicator
          tone="attention"
          label={t('software.updateAvailable', { latest, installed: update.installed ?? '' })}
        />
        <Button
          disabled={actions.update.isPending}
          onClick={() => {
            actions.update.mutate(product, {
              onSuccess: ({ jobId: started }) => {
                setJobId(started);
              },
              onError,
            });
          }}
        >
          {t('software.update', { version: latest })}
        </Button>
      </div>
    );
  }
  if (update.installed === null) {
    return <p className="text-muted-foreground">{latest ? t('software.notInstalledLatest', { latest }) : null}</p>;
  }
  return (
    <div className="space-y-1">
      <StatusIndicator tone="healthy" label={t('software.upToDate', { version: update.installed })} />
      {update.held && <p className="text-muted-foreground">{update.held}</p>}
    </div>
  );
}

function IntegrityResult({ report }: { report: IntegrityReport }) {
  const { t } = useTranslation();
  if (!report.recorded) return <p className="text-muted-foreground">{t('software.verifyUnrecorded')}</p>;
  const problems = report.missing.length + report.changed.length;
  return problems === 0 ? (
    <StatusIndicator tone="healthy" label={t('software.verifyOk', { count: report.checked })} />
  ) : (
    <div className="space-y-1">
      <StatusIndicator
        tone="failed"
        label={t('software.verifyProblems', { missing: report.missing.length, changed: report.changed.length })}
      />
      <ul className="list-inside list-disc font-mono text-xs">
        {[...report.missing, ...report.changed].map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </div>
  );
}

function VersionActions({ item, nodes }: { item: InstalledSoftware; nodes: readonly NodeWithStatus[] }) {
  const { t } = useTranslation();
  const actions = useSoftwareActions();
  const onError = useErrorFeedback();
  const [report, setReport] = useState<IntegrityReport>();
  const product = t(`software.products.${item.product}`);
  const blocked =
    item.usedBy.length > 0
      ? t('software.removeInUse', { nodes: item.usedBy.map((node) => node.name).join(', ') })
      : item.running
        ? item.product === 'tor'
          ? t('software.removeRunningTor')
          : t('software.removeRunning')
        : undefined;
  // Only forward, and only within the node's own software: Bitcoin Core does not promise that an
  // older version reads an upgraded data directory, and a Knots node follows another chain.
  const movable =
    item.product === 'bitcoin-core' || item.product === 'bitcoin-knots'
      ? nodes.filter(
          (node) =>
            node.profile.execution === 'managed' &&
            node.profile.implementation === item.product &&
            node.profile.runtimeVersion !== null &&
            isNewer(item.version, node.profile.runtimeVersion),
        )
      : [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={actions.verify.isPending}
          onClick={() => {
            actions.verify.mutate({ product: item.product, version: item.version }, { onSuccess: setReport, onError });
          }}
        >
          {t('software.verify')}
        </Button>
        <ConfirmButton
          label={t('software.remove')}
          title={t('software.removeTitle', { product, version: item.version })}
          confirmLabel={t('software.removeConfirm')}
          destructive
          disabled={blocked !== undefined || actions.remove.isPending}
          onConfirm={() => {
            actions.remove.mutate(
              { product: item.product, version: item.version },
              {
                onSuccess: ({ removedBytes }) =>
                  toast.success(
                    t('software.removed', { product, version: item.version, size: formatBytes(removedBytes) }),
                  ),
                onError,
              },
            );
          }}
        >
          <p>{t('software.removeBody', { size: formatBytes(item.bytes) })}</p>
        </ConfirmButton>
        {movable.map((node) => (
          <ConfirmButton
            key={node.profile.id}
            label={t('software.moveNode', { node: node.profile.name })}
            title={t('software.moveTitle', { node: node.profile.name, product, version: item.version })}
            confirmLabel={t('software.moveConfirm')}
            destructive
            disabled={actions.useRuntime.isPending}
            onConfirm={() => {
              actions.useRuntime.mutate(
                { nodeId: node.profile.id, version: item.version },
                {
                  onSuccess: () =>
                    toast.success(t('software.moved', { node: node.profile.name, product, version: item.version })),
                  onError,
                },
              );
            }}
          >
            <p>{t('software.moveBody', { product })}</p>
          </ConfirmButton>
        ))}
      </div>
      {blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}
      {report && <IntegrityResult report={report} />}
    </div>
  );
}

function ProductCard({
  product,
  versions,
  update,
  nodes,
}: {
  product: InstalledProduct;
  versions: readonly InstalledSoftware[];
  update: SoftwareUpdate | undefined;
  nodes: readonly NodeWithStatus[];
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`software.products.${product}`)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <UpdateStatus product={product} update={update} />
        {versions.length === 0 ? (
          <p className="text-muted-foreground">{t('software.noVersions')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('software.versionHeading')}</TableHead>
                <TableHead>{t('software.verifiedHeading')}</TableHead>
                <TableHead>{t('software.signaturesHeading')}</TableHead>
                <TableHead>{t('software.codeSigningHeading')}</TableHead>
                <TableHead className="text-right">{t('software.sizeHeading')}</TableHead>
                <TableHead>{t('software.usedByHeading')}</TableHead>
                <TableHead>{t('software.actionsHeading')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((item) => (
                <TableRow key={item.version} className="align-top">
                  <TableCell className="tabular font-medium">{item.version}</TableCell>
                  <TableCell>{formatDate(item.verifiedAt)}</TableCell>
                  <TableCell>
                    {t('software.signatures', { valid: item.signatures.valid, required: item.signatures.required })}
                  </TableCell>
                  <TableCell>{t(`software.codeSigning.${item.codeSigning}`)}</TableCell>
                  <TableCell className="tabular text-right">{formatBytes(item.bytes)}</TableCell>
                  <TableCell>
                    {item.usedBy.length > 0
                      ? item.usedBy.map((node) => node.name).join(', ')
                      : item.running
                        ? item.product === 'tor'
                          ? t('software.runningTor')
                          : t('software.running')
                        : t('software.unused')}
                  </TableCell>
                  <TableCell>
                    <VersionActions item={item} nodes={nodes} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function SoftwarePage() {
  const { t } = useTranslation();
  const installed = useInstalledSoftware();
  const updates = useSoftwareUpdates();
  const nodes = useNodes();
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('software.title')}</h1>
        <p className="max-w-3xl text-muted-foreground">{t('software.description')}</p>
      </div>
      {installed.isError ? (
        <ErrorPanel
          title={t('software.unavailable')}
          error={toOrchestratorError(installed.error)}
          onRetry={() => void installed.refetch()}
        />
      ) : !installed.data ? (
        <Skeleton className="h-64" />
      ) : (
        PRODUCTS.filter(
          (product) => product !== 'bitcoin-knots' || installed.data.some((item) => item.product === product),
        ).map((product) => (
          <ProductCard
            key={product}
            product={product}
            versions={installed.data.filter((item) => item.product === product)}
            update={updates.data?.find((item) => item.product === product)}
            nodes={nodes.data ?? []}
          />
        ))
      )}
    </div>
  );
}
