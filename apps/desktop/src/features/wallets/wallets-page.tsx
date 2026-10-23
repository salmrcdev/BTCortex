import { Link } from '@tanstack/react-router';
import { DatabaseZap, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { followsKnotsFork } from '@btcortex/contracts';
import type { NodeWithStatus } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { NetworkBadge } from '@/components/status/network-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { useElectrumOverview } from '@/features/electrum/queries';
import { useNodes } from '@/features/nodes/queries';
import { toOrchestratorError } from '@/lib/orchestrator';
import { ElectrumWalletCard } from './electrum-wallet-card';
import { SparrowCard } from './sparrow-card';

// Wallet integrations (specification sections 8 and 24.1, area 6): the
// desktop wallets BTCortex sets up and connects to your own node — Sparrow
// and Electrum — where hardware wallets sign, and how other wallets reach the
// node's Electrum server. The wallets themselves, and their keys, stay inside
// those programs.

function NodePicker({
  nodes,
  chosen,
  onChoose,
}: {
  nodes: readonly NodeWithStatus[];
  chosen: string;
  onChoose: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <RadioCards
      label={t('walletsPage.node')}
      value={chosen}
      onValueChange={onChoose}
      className="md:grid-cols-2"
      options={nodes.map((node) => ({
        value: node.profile.id,
        title: node.profile.name,
        description: t(`nodeState.${node.status.state}`),
        badge: <NetworkBadge network={node.profile.network} />,
      }))}
    />
  );
}

function WalletsForNode({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const electrum = useElectrumOverview();
  const server = electrum.data?.servers.find((entry) => entry.nodeId === node.profile.id);
  const ready = server?.state === 'ready';
  return (
    <div className="space-y-6">
      {!ready && (
        <Note tone="info">
          {server && server.state !== 'not-set-up' ? t('walletsPage.serverNotReady') : t('walletsPage.noServer')}{' '}
          <Link to="/electrum" className="text-primary underline-offset-4 hover:underline">
            {t('walletsPage.openElectrum')}
          </Link>
        </Note>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <SparrowCard
          key={`${node.profile.id}-${ready ? 'electrum' : 'node'}`}
          node={node}
          via={ready ? 'electrum' : 'node'}
        />
        <ElectrumWalletCard node={node} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound aria-hidden="true" className="size-4 text-muted-foreground" />
              {t('walletsPage.hardware.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground">{t('walletsPage.hardware.body')}</p>
            <Button asChild variant="outline">
              <Link to="/hardware">{t('walletsPage.hardware.open')}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DatabaseZap aria-hidden="true" className="size-4 text-muted-foreground" />
              {t('walletsPage.others.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground">
              {ready ? t('walletsPage.others.ready') : t('walletsPage.others.needsServer')}
            </p>
            <Button asChild variant="outline">
              <Link to="/electrum">{t('walletsPage.others.open')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function WalletsPage() {
  const { t } = useTranslation();
  const nodes = useNodes();
  const [chosen, setChosen] = useState<string>();
  const list = nodes.data ?? [];
  const node =
    list.find((entry) => entry.profile.id === chosen) ??
    list.find((entry) => entry.status.state === 'running') ??
    list[0];
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="font-mono text-xl font-semibold">{t('walletsPage.title')}</h1>
        <p className="max-w-prose text-muted-foreground">{t('walletsPage.description')}</p>
      </div>
      {nodes.isError ? (
        <ErrorPanel
          title={t('walletsPage.unavailable')}
          error={toOrchestratorError(nodes.error)}
          onRetry={() => void nodes.refetch()}
        />
      ) : !nodes.data ? (
        <Skeleton className="h-64" />
      ) : !node ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="max-w-prose text-muted-foreground">{t('walletsPage.noNodes')}</p>
            <Button asChild>
              <Link to="/nodes/setup">{t('walletsPage.setUpNode')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {list.length > 1 && <NodePicker nodes={list} chosen={node.profile.id} onChoose={setChosen} />}
          {followsKnotsFork(node) && (
            <Note tone="warning">{t('walletsPage.otherChain', { node: node.profile.name })}</Note>
          )}
          <WalletsForNode key={node.profile.id} node={node} />
        </>
      )}
    </div>
  );
}
