import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LightningConnectionWithStatus } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toOrchestratorError } from '@/lib/orchestrator';
import { cn } from '@/lib/utils';
import { ConnectPanel, LocalLndCard } from './connect-panel';
import { ChannelsTab, OverviewTab, PaymentsTab, PeersTab, RoutingTab } from './dashboard';
import { LightningNetworkBadge, lightningState } from './parts';
import { useLightningConnections, useLightningDashboard, useLocalLightning } from './queries';
import { LIGHTNING_TABS } from './search';
import type { LightningSearch, LightningTab } from './search';

// Lightning (specification section 11): the nodes BTCortex is connected to,
// a way to connect one (the LND on this computer in one click), and for the
// chosen node what it lets BTCortex read. The chosen node and tab are in the
// address, so a view can be returned to.

function ConnectionPicker({
  connections,
  selected,
  onSelect,
}: {
  connections: LightningConnectionWithStatus[];
  selected: string | undefined;
  onSelect: (connectionId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t('lightning.connections')}>
      {connections.map(({ connection, status }) => {
        const state = lightningState(status, t);
        const current = connection.id === selected;
        return (
          <li key={connection.id}>
            <Button
              variant="outline"
              aria-current={current ? 'true' : undefined}
              className={cn(
                'h-auto flex-col items-start gap-0.5 py-2 text-left',
                current && 'border-primary bg-primary/5',
              )}
              onClick={() => {
                onSelect(connection.id);
              }}
            >
              <span className="flex items-center gap-2 font-medium">
                {status.alias ?? connection.name}
                {status.network && <LightningNetworkBadge network={status.network} />}
              </span>
              <StatusIndicator tone={state.tone} label={state.label} className="text-xs font-normal" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function Dashboard({
  connection,
  tab,
  onTab,
  onRemoved,
}: {
  connection: LightningConnectionWithStatus;
  tab: LightningTab;
  onTab: (tab: LightningTab) => void;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const status = connection.status;
  // A locked wallet answers nothing but its state; LND must be unlocked first.
  const dashboard = useLightningDashboard(connection.connection.id, status.state !== 'locked');
  if (status.state === 'locked') return <Note tone="warning">{t('lightning.lockedHelp')}</Note>;
  if (dashboard.isError) {
    return (
      <ErrorPanel
        title={t('lightning.dashboardUnavailable')}
        error={toOrchestratorError(dashboard.error)}
        onRetry={() => void dashboard.refetch()}
      />
    );
  }
  if (!dashboard.data) return <Skeleton className="h-96" />;
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        onTab(value as LightningTab);
      }}
    >
      <TabsList>
        {LIGHTNING_TABS.map((name) => (
          <TabsTrigger key={name} value={name}>
            {t(`lightning.tabs.${name}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="overview" className="mt-4">
        <OverviewTab dashboard={dashboard.data} onRemoved={onRemoved} />
      </TabsContent>
      <TabsContent value="channels" className="mt-4">
        <ChannelsTab dashboard={dashboard.data} />
      </TabsContent>
      <TabsContent value="peers" className="mt-4">
        <PeersTab dashboard={dashboard.data} />
      </TabsContent>
      <TabsContent value="payments" className="mt-4">
        <PaymentsTab dashboard={dashboard.data} />
      </TabsContent>
      <TabsContent value="routing" className="mt-4">
        <RoutingTab dashboard={dashboard.data} />
      </TabsContent>
    </Tabs>
  );
}

export function LightningPage({ search }: { search: LightningSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const connections = useLightningConnections();
  const local = useLocalLightning();
  const [adding, setAdding] = useState(false);

  const go = (next: LightningSearch) => {
    void navigate({ to: '/lightning', search: next });
  };

  const list = connections.data ?? [];
  const selected = list.find((entry) => entry.connection.id === search.connection) ?? list[0];
  const tab = search.tab ?? 'overview';
  const connected = (connectionId: string) => {
    setAdding(false);
    go({ connection: connectionId });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-mono text-xl font-semibold">{t('lightning.title')}</h1>
          <p className="max-w-3xl text-muted-foreground">{t('lightning.description')}</p>
        </div>
        {list.length > 0 && !adding && (
          <Button
            variant="outline"
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus aria-hidden="true" />
            {t('lightning.addConnection')}
          </Button>
        )}
      </header>

      {connections.isError ? (
        <ErrorPanel
          title={t('lightning.unavailable')}
          error={toOrchestratorError(connections.error)}
          onRetry={() => void connections.refetch()}
        />
      ) : !connections.data ? (
        <Skeleton className="h-48" />
      ) : list.length === 0 ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {local.data ? (
            <LocalLndCard local={local.data} onConnected={connected} />
          ) : (
            local.data === null && (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground">{t('lightning.local.none')}</p>
                </CardContent>
              </Card>
            )
          )}
          <ConnectPanel local={local.data} onConnected={connected} localShownApart={Boolean(local.data)} />
        </div>
      ) : (
        <>
          {adding && (
            <ConnectPanel
              local={local.data}
              onConnected={connected}
              onCancel={() => {
                setAdding(false);
              }}
            />
          )}
          {list.length > 1 && (
            <ConnectionPicker
              connections={list}
              selected={selected?.connection.id}
              onSelect={(connectionId) => {
                go({ connection: connectionId, tab });
              }}
            />
          )}
          {selected && (
            <Dashboard
              key={selected.connection.id}
              connection={selected}
              tab={tab}
              onTab={(next) => {
                go({ connection: selected.connection.id, tab: next });
              }}
              onRemoved={() => {
                go({});
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
