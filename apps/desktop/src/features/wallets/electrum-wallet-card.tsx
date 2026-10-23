import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink as ExternalLinkIcon, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { NodeWithStatus } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { JobProgress } from '@/components/feedback/job-progress';
import { Note } from '@/components/feedback/note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useJob } from '@/features/nodes/queries';
import { useElectrumWalletStatus, useOpenElectrumWallet, walletKeys } from './queries';

const STAGES = [
  'checking',
  'resolving',
  'downloading',
  'verifying-signatures',
  'verifying-executables',
  'finalising',
  'launching',
] as const;

/** Opens Electrum with the node's Electrum server, without changing Electrum's settings (specification section 8). */
export function ElectrumWalletCard({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const nodeId = node.profile.id;
  const status = useElectrumWalletStatus(nodeId);
  const open = useOpenElectrumWallet(nodeId);
  const [jobId, setJobId] = useState<string>();
  const job = useJob(jobId);

  const finished = job.data?.state === 'succeeded' || job.data?.state === 'failed';
  useEffect(() => {
    if (!finished) return;
    void queryClient.invalidateQueries({ queryKey: walletKeys.electrum(nodeId) });
    if (job.data?.state === 'succeeded') toast.success(t('wallets.electrumOpened'));
  }, [finished, job.data?.state, nodeId, queryClient, t]);

  const electrum = status.data;
  const working = job.data?.state === 'running' || job.data?.state === 'queued';
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wallet aria-hidden="true" className="size-4 text-muted-foreground" />
          <CardTitle>{t('wallets.electrumTitle')}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground">{t('wallets.electrumDescription')}</p>
        {!electrum ? (
          status.isError ? (
            <ErrorPanel title={t('errors.actionFailed')} error={toOrchestratorError(status.error)} />
          ) : (
            <Skeleton className="h-10" />
          )
        ) : (
          <>
            <p className="text-sm">
              {electrum.opens === 'application'
                ? t('wallets.electrumApplication', {
                    version: electrum.application?.version ?? t('wallets.electrumUnknownVersion'),
                  })
                : electrum.opens === 'verified' && electrum.installed
                  ? t('wallets.electrumVerified', {
                      version: electrum.installed.version,
                      date: formatTimestamp(electrum.installed.verifiedAt),
                    })
                  : t('wallets.electrumInstall', { version: electrum.latest ?? '' })}
            </p>
            {electrum.applicationOutdated && electrum.latest && (
              <Note tone="warning">{t('wallets.electrumOutdated', { latest: electrum.latest })}</Note>
            )}
            {electrum.ownWalletsFolder && (
              <p className="text-sm text-muted-foreground">
                {t(electrum.otherElectrumWallets ? 'wallets.electrumOwnFolderOther' : 'wallets.electrumOwnFolder', {
                  folder: electrum.ownWalletsFolder,
                })}
              </p>
            )}
            {electrum.unavailableReason && <Note tone="info">{electrum.unavailableReason}</Note>}
            {electrum.running && <Note tone="warning">{t('wallets.electrumCloseFirst')}</Note>}
            {job.data && (job.data.state !== 'succeeded' || working) && (
              <JobProgress
                job={job.data}
                stages={STAGES.map((stage) => ({ id: stage, label: t(`wallets.electrumStages.${stage}`) }))}
              />
            )}
            {job.data?.state === 'failed' && job.data.error && (
              <ErrorPanel
                title={t('wallets.electrumFailed')}
                error={toOrchestratorError({ code: -32000, message: job.data.error.message, data: job.data.error })}
              />
            )}
            <Button
              disabled={working || open.isPending || electrum.unavailableReason !== undefined}
              onClick={() => {
                open.mutate(undefined, {
                  onSuccess: ({ jobId: started }) => {
                    setJobId(started);
                  },
                  onError: (error) =>
                    toast.error(t('errors.actionFailed'), { description: toOrchestratorError(error).message }),
                });
              }}
            >
              <ExternalLinkIcon aria-hidden="true" />
              {t('wallets.openElectrum')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('wallets.electrumNothingChanged')}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
