import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Info, TriangleAlert, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { NodeWithStatus, SparrowConnectionVia } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { JobProgress } from '@/components/feedback/job-progress';
import { StatusIndicator } from '@/components/status/status-indicator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatList, formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useJob } from '@/features/nodes/queries';
import { useConnectSparrow, useOpenSparrow, useSparrowStatus, walletKeys } from './queries';
import type { SparrowConsent } from './queries';

const STAGES = [
  'resolving',
  'fetching-checksums',
  'verifying-signatures',
  'downloading',
  'extracting',
  'verifying-executables',
  'finalising',
  'checking',
  'configuring',
  'launching',
] as const;

function Note({ tone, children }: { tone: 'info' | 'warning'; children: string }) {
  const Icon = tone === 'info' ? Info : TriangleAlert;
  return (
    <p className="flex items-start gap-2 text-sm">
      <Icon
        aria-hidden="true"
        className={tone === 'info' ? 'mt-0.5 size-4 shrink-0 text-info' : 'mt-0.5 size-4 shrink-0 text-warning'}
      />
      <span>{children}</span>
    </p>
  );
}

/**
 * Connects Sparrow to this node with one action (specification section 8):
 * to its RPC interface, or to the Electrum server BTCortex runs next to it.
 */
export function SparrowCard({ node, via = 'node' }: { node: NodeWithStatus; via?: SparrowConnectionVia }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const nodeId = node.profile.id;
  const status = useSparrowStatus(nodeId, via);
  const connect = useConnectSparrow(nodeId, via);
  const electrum = via === 'electrum';
  const open = useOpenSparrow(nodeId);
  const [jobId, setJobId] = useState<string>();
  const [confirmChanges, setConfirmChanges] = useState(false);
  const job = useJob(jobId);
  const blockchain = node.status.snapshot?.blockchain;

  const finished = job.data?.state === 'succeeded' || job.data?.state === 'failed';
  useEffect(() => {
    if (!finished) return;
    void queryClient.invalidateQueries({ queryKey: walletKeys.sparrowAll(nodeId) });
    if (job.data?.state === 'succeeded') {
      toast.success(
        electrum
          ? t('wallets.sparrowConnectedElectrum', { name: node.profile.name })
          : t('wallets.sparrowConnected', { name: node.profile.name }),
      );
    }
  }, [finished, job.data?.state, nodeId, node.profile.name, queryClient, t, electrum]);

  const start = (consent: SparrowConsent) => {
    connect.mutate(consent, {
      onSuccess: ({ jobId: started }) => {
        setJobId(started);
      },
    });
  };

  const sparrow = status.data;
  const running = job.data?.state === 'running' || job.data?.state === 'queued';
  const otherServer = sparrow?.connection.otherServer;
  const fixedNetworks = sparrow?.connection.fixedStartupNetworks ?? [];
  const consent: SparrowConsent = {
    replaceExistingServer: otherServer !== undefined,
    resetStartupNetwork: fixedNetworks.length > 0,
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wallet aria-hidden="true" className="size-4 text-muted-foreground" />
          <CardTitle>{t('wallets.sparrowTitle')}</CardTitle>
        </div>
        {sparrow && (
          <StatusIndicator
            tone={sparrow.connection.usesThisNode ? 'healthy' : 'inactive'}
            label={
              sparrow.connection.usesThisNode
                ? electrum
                  ? t('wallets.usesThisServer')
                  : t('wallets.usesThisNode')
                : t('wallets.notConnected')
            }
          />
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground">
          {electrum ? t('wallets.sparrowElectrumDescription') : t('wallets.sparrowDescription')}
        </p>
        {!sparrow ? (
          status.isError ? (
            <ErrorPanel title={t('errors.actionFailed')} error={toOrchestratorError(status.error)} />
          ) : (
            <Skeleton className="h-10" />
          )
        ) : sparrow.unsupportedReason ? (
          <Note tone="info">{sparrow.unsupportedReason}</Note>
        ) : (
          <>
            <p className="text-sm">
              {sparrow.installed
                ? t('wallets.sparrowInstalled', {
                    version: sparrow.installed.version,
                    date: formatTimestamp(sparrow.installed.verifiedAt),
                  })
                : t('wallets.sparrowNotInstalled')}
            </p>
            {!electrum && blockchain?.pruned && <Note tone="info">{t('wallets.prunedNote')}</Note>}
            {!electrum && blockchain?.initialBlockDownload && <Note tone="info">{t('wallets.syncingNote')}</Note>}
            {sparrow.running && !sparrow.connection.usesThisNode && (
              <Note tone="warning">{t('wallets.closeSparrowFirst')}</Note>
            )}

            {job.data && (job.data.state !== 'succeeded' || running) && (
              <JobProgress
                job={job.data}
                stages={STAGES.map((stage) => ({
                  id: stage,
                  label:
                    electrum && stage === 'configuring'
                      ? t('wallets.stages.configuringElectrum')
                      : t(`wallets.stages.${stage}`),
                }))}
              />
            )}
            {job.data?.state === 'failed' && job.data.error && (
              <ErrorPanel
                title={t('wallets.connectFailed')}
                error={toOrchestratorError({ code: -32000, message: job.data.error.message, data: job.data.error })}
              />
            )}
            {connect.isError && (
              <ErrorPanel title={t('errors.actionFailed')} error={toOrchestratorError(connect.error)} />
            )}

            <div className="flex flex-wrap gap-2">
              {sparrow.connection.usesThisNode ? (
                <Button
                  disabled={open.isPending}
                  onClick={() => {
                    open.mutate(undefined, {
                      onError: (error) =>
                        toast.error(t('errors.actionFailed'), { description: toOrchestratorError(error).message }),
                    });
                  }}
                >
                  <ExternalLink aria-hidden="true" />
                  {t('wallets.openSparrow')}
                </Button>
              ) : (
                <Button
                  disabled={running || connect.isPending}
                  onClick={() => {
                    if (consent.replaceExistingServer || consent.resetStartupNetwork) setConfirmChanges(true);
                    else start(consent);
                  }}
                >
                  {electrum ? t('wallets.useSparrowElectrum') : t('wallets.useSparrow')}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmChanges} onOpenChange={setConfirmChanges}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('wallets.consentTitle')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {otherServer && (
                <p>
                  {electrum
                    ? t('wallets.consentServerElectrum', { server: otherServer.server ?? otherServer.serverType })
                    : t('wallets.consentServer', { server: otherServer.server ?? otherServer.serverType })}
                </p>
              )}
              {fixedNetworks.length > 0 && (
                <p>
                  {t('wallets.consentStartupNetwork', {
                    current: formatList(fixedNetworks.map((network) => t(`networks.${network}`))),
                    network: t(`networks.${node.profile.network}`),
                  })}
                </p>
              )}
              <p>{t('wallets.consentBackup')}</p>
            </div>
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                start(consent);
              }}
            >
              {electrum ? t('wallets.consentConfirmElectrum') : t('wallets.consentConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
