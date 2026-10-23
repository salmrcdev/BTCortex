import { Link } from '@tanstack/react-router';
import { ChevronRight, Plus, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NodeWithStatus } from '@btcortex/contracts';
import { Meter } from '@/components/data/meter';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { NetworkBadge } from '@/components/status/network-badge';
import { NodeStateIndicator } from '@/components/status/node-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber, formatPercent, formatRelativeTime } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { DiscoveredNodes } from './discovered-nodes';
import { RemoteNodeCard } from './remote-node';
import { useNodes } from './queries';

export function NodeSummaryCard({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const { profile, status } = node;
  const blockchain = status.snapshot?.blockchain;
  return (
    <Link
      to="/nodes/$nodeId"
      params={{ nodeId: profile.id }}
      aria-label={t('nodes.openNode', { name: profile.name })}
      className="group block rounded-lg border bg-card p-4 transition-colors duration-150 hover:bg-muted/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold">{profile.name}</h2>
            <NetworkBadge network={profile.network} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {profile.execution === 'managed' ? t('nodes.managed') : t('nodes.external')}
            {profile.runtimeVersion
              ? ` · ${t(`software.products.${profile.implementation}`)} ${profile.runtimeVersion}`
              : ''}
          </p>
        </div>
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <NodeStateIndicator status={status} />
        {blockchain && (
          <>
            <span>
              <span className="text-muted-foreground">{t('nodes.blocks')} </span>
              <span className="tabular">{formatNumber(blockchain.blocks)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">{t('nodes.peers')} </span>
              <span className="tabular">{formatNumber(status.snapshot?.network.connections ?? 0)}</span>
            </span>
          </>
        )}
      </div>

      {blockchain?.initialBlockDownload && (
        <div className="mt-3 space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t('nodes.progress')}</span>
            <span className="tabular">{formatPercent(blockchain.verificationProgress, 2)}</span>
          </div>
          <Meter
            role="progressbar"
            tone="primary"
            value={blockchain.verificationProgress}
            label={t('nodes.progress')}
            valueText={formatPercent(blockchain.verificationProgress, 2)}
          />
        </div>
      )}
      {status.error && status.state !== 'running' && <p className="mt-3 text-sm text-danger">{status.error.message}</p>}
      <p className="mt-3 text-xs text-muted-foreground">
        {t('nodes.lastChecked', { time: formatRelativeTime(new Date(status.checkedAt)) })}
      </p>
    </Link>
  );
}

export function NodesPage() {
  const { t } = useTranslation();
  const nodes = useNodes();

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-mono text-xl font-semibold">{t('nodes.title')}</h1>
          <p className="text-muted-foreground">{t('nodes.description')}</p>
        </div>
        {nodes.data && nodes.data.length > 0 && (
          <Button asChild>
            <Link to="/nodes/setup">
              <Plus aria-hidden="true" />
              {t('nodes.setUp')}
            </Link>
          </Button>
        )}
      </div>

      {nodes.isError ? (
        <ErrorPanel
          title={t('errors.orchestratorUnavailable')}
          error={toOrchestratorError(nodes.error)}
          onRetry={() => void nodes.refetch()}
        />
      ) : !nodes.data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : nodes.data.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center">
          <Server aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 text-base font-semibold">{t('nodes.emptyTitle')}</h2>
          <p className="mx-auto mt-1 max-w-prose text-muted-foreground">{t('nodes.emptyBody')}</p>
          <Button asChild size="lg" className="mt-5">
            <Link to="/nodes/setup">
              <Plus aria-hidden="true" />
              {t('nodes.setUp')}
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {nodes.data.map((node) => (
            <NodeSummaryCard key={node.profile.id} node={node} />
          ))}
        </div>
      )}

      <DiscoveredNodes />
      <RemoteNodeCard />
    </div>
  );
}
