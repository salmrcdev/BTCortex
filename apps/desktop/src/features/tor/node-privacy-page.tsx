import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { Info, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { NodePrivacy, NodePrivacyChange, NodeTorMode, NodeWithStatus } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { StatusIndicator } from '@/components/status/status-indicator';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/form-controls';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useConfigurePrivacy, useI2pStatus, useNodePrivacy, useTorStatus } from './queries';

// How a node reaches its peers, and routing it through BTCortex's tor
// (specification section 10: Bitcoin Core routing integration, onion services
// and privacy warnings). Each choice states what it hides and what stays
// visible (privacy-networking.md §2.21); applying one asks first. I2P peers,
// through an I2P router the user runs, can come on top of any of them.

type Mode = Exclude<NodeTorMode, 'custom'>;
const MODES: readonly Mode[] = ['off', 'onion-peers', 'all-traffic', 'tor-only'];
const NETWORK_NAMES = ['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns'] as const;

function Note({ tone, children }: { tone: 'info' | 'warning'; children: ReactNode }) {
  const Icon = tone === 'info' ? Info : TriangleAlert;
  return (
    <p className="flex max-w-prose items-start gap-2">
      <Icon
        aria-hidden="true"
        className={tone === 'info' ? 'mt-0.5 size-4 shrink-0 text-info' : 'mt-0.5 size-4 shrink-0 text-warning'}
      />
      <span>{children}</span>
    </p>
  );
}

function networkName(name: string, t: TFunction): string {
  return (NETWORK_NAMES as readonly string[]).includes(name)
    ? t(`privacy.networkNames.${name as (typeof NETWORK_NAMES)[number]}`)
    : name;
}

function CurrentCard({ node, privacy }: { node: NodeWithStatus; privacy: NodePrivacy }) {
  const { t } = useTranslation();
  const router = useI2pStatus().data;
  const running = node.status.state === 'running';
  const usesTor = privacy.mode !== 'off';
  const routerGone = privacy.i2p && router?.available === false;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('privacy.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <StatusIndicator
            tone={privacy.mode === 'custom' ? 'unknown' : usesTor ? 'healthy' : 'inactive'}
            label={t(`privacy.modes.${privacy.mode}`)}
            className="font-medium"
          />
          <p className="max-w-prose text-muted-foreground">{t(`privacy.modeDescriptions.${privacy.mode}`)}</p>
        </div>
        {privacy.i2p && (
          <div className="space-y-1">
            <StatusIndicator tone={routerGone ? 'attention' : 'healthy'} label={t('privacy.i2p.on')} />
            {routerGone && <Note tone="warning">{t('privacy.i2p.routerGone', { address: router.samAddress })}</Note>}
          </div>
        )}
        {privacy.onionService && (
          <div className="space-y-1">
            <p className="font-medium">{t('privacy.onionAddress')}</p>
            {privacy.onionAddress ? (
              <CopyableValue value={privacy.onionAddress} label={t('privacy.onionAddress')} className="max-w-full" />
            ) : (
              <p className="text-muted-foreground">{t('privacy.onionAddressPending')}</p>
            )}
          </div>
        )}
        {privacy.restartRequired && <Note tone="warning">{t('privacy.restartRequired')}</Note>}
        <div className="space-y-2">
          <h3 className="font-medium">{t('privacy.networksTitle')}</h3>
          {!running || privacy.networks.length === 0 ? (
            <p className="text-muted-foreground">{t('privacy.networksStopped')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('privacy.networkHeading')}</TableHead>
                  <TableHead>{t('privacy.reachableHeading')}</TableHead>
                  <TableHead>{t('privacy.proxyHeading')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {privacy.networks.map((network) => (
                  <TableRow key={network.name}>
                    <TableCell>{networkName(network.name, t)}</TableCell>
                    <TableCell>
                      <StatusIndicator
                        tone={network.reachable ? 'healthy' : 'inactive'}
                        label={network.reachable ? t('common.yes') : t('common.no')}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-[13px]">
                      {network.proxy === '' ? t('privacy.direct') : network.proxy}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ChangeCard({ node, privacy }: { node: NodeWithStatus; privacy: NodePrivacy }) {
  const { t } = useTranslation();
  const tor = useTorStatus();
  const router = useI2pStatus().data;
  const configure = useConfigurePrivacy(node.profile.id);
  const onError = useErrorFeedback();
  // The page remounts this card when the stored settings change, which resets the choice.
  const [choice, setChoice] = useState<NodePrivacyChange>(() => ({
    mode: privacy.mode === 'custom' ? 'off' : privacy.mode,
    onionService: privacy.onionService === true,
    privateBroadcast: privacy.privateBroadcast,
    i2p: privacy.i2p,
  }));

  const usesTor = choice.mode !== 'off';
  const effective: NodePrivacyChange = {
    mode: choice.mode,
    onionService: usesTor && choice.onionService,
    privateBroadcast: usesTor && privacy.privateBroadcastSupported && choice.privateBroadcast,
    i2p: choice.i2p === true,
  };
  const unchanged =
    privacy.mode === effective.mode &&
    privacy.onionService === effective.onionService &&
    privacy.privateBroadcast === effective.privateBroadcast &&
    privacy.i2p === effective.i2p;
  // I2P can always be turned off, and turned on once a router answers.
  const i2pAvailable = router?.available === true;
  const i2pChangeable = i2pAvailable || privacy.i2p || effective.i2p;
  const torMissing = usesTor && tor.data?.state === 'not-installed';
  const running = node.status.state === 'running' || node.status.state === 'starting';

  const apply = () => {
    configure.mutate(effective, {
      onSuccess: ({ restarting }) => {
        toast.success(restarting ? t('privacy.appliedRestarting') : t('privacy.applied'));
      },
      onError,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('privacy.changeTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioCards<Mode>
          label={t('privacy.modeLabel')}
          value={choice.mode}
          onValueChange={(mode) => {
            setChoice((previous) => ({ ...previous, mode }));
          }}
          options={MODES.map((mode) => ({
            value: mode,
            title: t(`privacy.modes.${mode}`),
            description: t(`privacy.modeDescriptions.${mode}`),
            ...(mode === privacy.mode ? { badge: <Badge variant="outline">{t('privacy.current')}</Badge> } : {}),
          }))}
        />
        <label className="flex max-w-prose items-start gap-2">
          <Checkbox
            checked={effective.onionService}
            disabled={!usesTor}
            onChange={(event) => {
              const onionService = event.currentTarget.checked;
              setChoice((previous) => ({ ...previous, onionService }));
            }}
          />
          <span>
            <span className="font-medium">{t('privacy.onionService')}</span>
            <span className="block text-muted-foreground">
              {usesTor ? t('privacy.onionServiceHint') : t('privacy.onionServiceNeedsTor')}
            </span>
          </span>
        </label>
        <label className="flex max-w-prose items-start gap-2">
          <Checkbox
            checked={effective.privateBroadcast}
            disabled={!usesTor || !privacy.privateBroadcastSupported}
            onChange={(event) => {
              const privateBroadcast = event.currentTarget.checked;
              setChoice((previous) => ({ ...previous, privateBroadcast }));
            }}
          />
          <span>
            <span className="font-medium">{t('privacy.privateBroadcast')}</span>
            <span className="block text-muted-foreground">
              {!privacy.privateBroadcastSupported
                ? t('privacy.privateBroadcastUnsupported')
                : usesTor
                  ? t('privacy.privateBroadcastHint')
                  : t('privacy.onionServiceNeedsTor')}
            </span>
          </span>
        </label>
        <label className="flex max-w-prose items-start gap-2">
          <Checkbox
            checked={effective.i2p}
            disabled={!i2pChangeable}
            onChange={(event) => {
              const i2p = event.currentTarget.checked;
              setChoice((previous) => ({ ...previous, i2p }));
            }}
          />
          <span>
            <span className="font-medium">{t('privacy.i2p.label')}</span>
            <span className="block text-muted-foreground">
              {i2pAvailable ? (
                router.program === null ? (
                  t('privacy.i2p.hintUnnamed')
                ) : (
                  t('privacy.i2p.hint', { router: router.program })
                )
              ) : (
                <>
                  {t('privacy.i2p.needsRouter')}{' '}
                  <Link to="/tor" className="underline underline-offset-2">
                    {t('privacy.openTor')}
                  </Link>
                </>
              )}
            </span>
          </span>
        </label>
        {torMissing && (
          <Note tone="warning">
            {t('privacy.torMissing')}{' '}
            <Link to="/tor" className="underline underline-offset-2">
              {t('privacy.openTor')}
            </Link>
          </Note>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={unchanged || torMissing || configure.isPending}>{t('privacy.review')}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>{t('privacy.confirmTitle', { node: node.profile.name })}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="font-medium text-foreground">{t(`privacy.modes.${effective.mode}`)}</p>
                <p>{t(`privacy.modeDescriptions.${effective.mode}`)}</p>
                {effective.mode === 'off' && privacy.mode !== 'off' && <p>{t('privacy.confirmDirect')}</p>}
                {effective.mode === 'tor-only' && (
                  <p>{effective.i2p ? t('privacy.confirmTorOnlyI2p') : t('privacy.confirmTorOnly')}</p>
                )}
                {effective.onionService && <p>{t('privacy.confirmOnion')}</p>}
                {effective.i2p && !privacy.i2p && <p>{t('privacy.confirmI2p')}</p>}
                {!effective.i2p && privacy.i2p && <p>{t('privacy.confirmNoI2p')}</p>}
                {usesTor && <p>{t('privacy.confirmTorFirst')}</p>}
                <p>{running ? t('privacy.confirmRestart') : t('privacy.confirmStopped')}</p>
              </div>
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={apply}>
                {running ? t('privacy.confirm') : t('privacy.confirmNoRestart')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

export function NodePrivacyPage({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const privacy = useNodePrivacy(node.profile.id);
  if (privacy.isError) {
    return (
      <ErrorPanel
        title={t('privacy.unavailable')}
        error={toOrchestratorError(privacy.error)}
        onRetry={() => void privacy.refetch()}
      />
    );
  }
  if (!privacy.data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-6">
      <CurrentCard node={node} privacy={privacy.data} />
      {privacy.data.manageable ? (
        <ChangeCard
          key={`${privacy.data.mode}|${String(privacy.data.onionService)}|${String(privacy.data.privateBroadcast)}|${String(privacy.data.i2p)}`}
          node={node}
          privacy={privacy.data}
        />
      ) : (
        privacy.data.readOnlyReason && <Note tone="info">{privacy.data.readOnlyReason}</Note>
      )}
    </div>
  );
}
