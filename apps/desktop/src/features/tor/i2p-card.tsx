import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { I2pRouterStatus } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { ExternalLink } from '@/components/data/external-link';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/format';
import { useCheckI2p, useI2pStatus } from './queries';

// I2P on Tor & Privacy (specification section 10; the i2p and i2pd research
// records): the I2P router on this computer, found by its SAM bridge, and
// where to get one. BTCortex neither installs nor runs the router; each node
// it set up can use it, from the node's Privacy section.

const ROUTER_DOWNLOADS = {
  i2pd: 'https://github.com/PurpleI2P/i2pd/releases',
  'java-i2p': 'https://i2p.net/en/downloads',
} as const;
/** Where the Java router's console starts and stops its SAM bridge. */
const JAVA_CLIENTS_PAGE = 'http://127.0.0.1:7657/configclients';

function RouterState({ status }: { status: I2pRouterStatus }) {
  const { t } = useTranslation();
  if (status.available) {
    const values = { address: status.samAddress, version: status.samVersion ?? '?' };
    return (
      <StatusIndicator
        tone="healthy"
        className="font-medium"
        label={
          status.program === null
            ? t('tor.i2p.found', values)
            : t('tor.i2p.foundProgram', { ...values, program: status.program })
        }
      />
    );
  }
  if (status.error !== null) {
    return <StatusIndicator tone="attention" className="font-medium" label={t('tor.i2p.unusable')} />;
  }
  if (status.runningWithoutSam !== null) {
    return <StatusIndicator tone="attention" className="font-medium" label={t('tor.i2p.withoutSam')} />;
  }
  return <StatusIndicator tone="inactive" className="font-medium" label={t('tor.i2p.none')} />;
}

function WhatToDo({ status }: { status: I2pRouterStatus }) {
  const { t } = useTranslation();
  if (status.available) {
    return (
      <p className="max-w-prose">
        {t('tor.i2p.useIt')}{' '}
        <Link to="/nodes" className="underline underline-offset-2">
          {t('tor.i2p.openNodes')}
        </Link>
      </p>
    );
  }
  if (status.runningWithoutSam === 'java-i2p') {
    return (
      <div className="space-y-2">
        <Note tone="warning">{t('tor.i2p.javaSamOff')}</Note>
        <CopyableValue value={JAVA_CLIENTS_PAGE} label={t('tor.i2p.clientsPage')} />
      </div>
    );
  }
  if (status.runningWithoutSam === 'i2pd') return <Note tone="info">{t('tor.i2p.i2pdSamPending')}</Note>;
  return (
    <div className="space-y-2">
      <h3 className="font-medium">{t('tor.i2p.getRouter')}</h3>
      <ul className="max-w-prose space-y-2">
        <li>
          <ExternalLink href={ROUTER_DOWNLOADS.i2pd}>i2pd</ExternalLink>
          <span className="block text-muted-foreground">{t('tor.i2p.i2pdHint')}</span>
        </li>
        <li>
          <ExternalLink href={ROUTER_DOWNLOADS['java-i2p']}>{t('tor.i2p.javaName')}</ExternalLink>
          <span className="block text-muted-foreground">{t('tor.i2p.javaHint')}</span>
        </li>
      </ul>
    </div>
  );
}

export function I2pCard() {
  const { t } = useTranslation();
  const status = useI2pStatus();
  const check = useCheckI2p();
  const onError = useErrorFeedback();
  const data = status.data;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>{t('tor.i2p.title')}</CardTitle>
          <CardDescription className="max-w-prose">{t('tor.i2p.description')}</CardDescription>
        </div>
        <Button
          variant="outline"
          disabled={check.isPending}
          onClick={() => {
            check.mutate(undefined, { onError });
          }}
        >
          {check.isPending ? t('tor.i2p.checking') : t('tor.i2p.check')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data ? (
          status.isError ? (
            <p className="text-muted-foreground">{t('tor.i2p.unavailable')}</p>
          ) : (
            <Skeleton className="h-10" />
          )
        ) : (
          <>
            <div className="space-y-1">
              <RouterState status={data} />
              {data.error !== null && <p className="max-w-prose text-muted-foreground">{data.error}</p>}
              <p className="text-xs text-muted-foreground">
                {t('tor.i2p.checked', { time: formatRelativeTime(new Date(data.checkedAt)) })}
              </p>
            </div>
            <WhatToDo status={data} />
            <Note tone="info">{t('tor.i2p.privacy')}</Note>
          </>
        )}
      </CardContent>
    </Card>
  );
}
