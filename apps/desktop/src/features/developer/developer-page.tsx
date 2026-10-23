import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CircleCheck, CircleX } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeWithStatus, ProbeKind, ProtocolFeature, ProtocolFeatureCategory } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { NetworkBadge } from '@/components/status/network-badge';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Label, NativeSelect } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNodes } from '@/features/nodes/queries';
import { callOrchestrator, toOrchestratorError } from '@/lib/orchestrator';
import { ConvertTab } from './convert-tab';
import { DecodeTab } from './decode-tab';
import { UriTab } from './uri-tab';
import { CoinsTab } from './coins-tab';
import { EventsTab } from './events-tab';
import { NodePicker } from './shared';
import { DEVELOPER_TABS } from './tabs';
import type { DeveloperTab } from './tabs';

// Bitcoin developer tools (specification sections 15 and 24.1, area 21):
// decoding with the node, conversions, the node's protocol features by kind
// of rule, test networks with regtest block generation, and endpoint probes.
// The RPC workbench is each node's console.

const CATEGORIES: readonly ProtocolFeatureCategory[] = [
  'consensus',
  'relay-policy',
  'wallet-policy',
  'implementation',
  'experimental',
];
const STATE_TONE = { on: 'healthy', off: 'inactive', unavailable: 'unknown', unknown: 'unknown' } as const;
const PROBE_KINDS: readonly ProbeKind[] = ['tcp', 'http', 'electrum', 'bitcoin-rpc'];

function FeaturesTab({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const features = useQuery({
    queryKey: ['devtools', 'features', nodeId],
    queryFn: () => callOrchestrator('devtools.features', { nodeId }),
  });
  if (features.isError) {
    return (
      <ErrorPanel
        title={t('developer.features.failed')}
        error={toOrchestratorError(features.error)}
        onRetry={() => void features.refetch()}
      />
    );
  }
  if (!features.data) return <Skeleton className="h-64" />;
  const byCategory = (category: ProtocolFeatureCategory) =>
    features.data.features.filter((feature: ProtocolFeature) => feature.category === category);
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        {t('developer.features.intro', { version: features.data.version ?? '?' })}
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CATEGORIES.map((category) =>
          byCategory(category).length === 0 ? null : (
            <Card key={category}>
              <CardHeader>
                <CardTitle>{t(`developer.features.categories.${category}`)}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {byCategory(category).map((feature) => (
                    <li key={feature.id} className="space-y-0.5">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{feature.title}</span>
                        <StatusIndicator
                          tone={STATE_TONE[feature.state]}
                          label={t(`developer.features.states.${feature.state}`)}
                          className="text-sm"
                        />
                        {feature.since !== null && (
                          <Badge variant="outline">{t('developer.features.since', { version: feature.since })}</Badge>
                        )}
                      </p>
                      <p className="text-muted-foreground">{feature.detail}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ),
        )}
      </div>
    </div>
  );
}

function MineForm({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const feedback = useErrorFeedback();
  const [blocks, setBlocks] = useState('1');
  const [address, setAddress] = useState('');
  const mine = useMutation({
    mutationFn: () =>
      callOrchestrator('devtools.mine', {
        nodeId: node.profile.id,
        blocks: Math.min(1000, Math.max(1, Number(blocks) || 1)),
        ...(address.trim() === '' ? {} : { address: address.trim() }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nodes'] }),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        mine.mutate(undefined, { onError: feedback });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <div className="space-y-1">
          <Label htmlFor={`${id}-blocks`}>{t('developer.testnets.blocks')}</Label>
          <Input
            id={`${id}-blocks`}
            type="number"
            min={1}
            max={1000}
            value={blocks}
            onChange={(event) => {
              setBlocks(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-address`}>{t('developer.testnets.address')}</Label>
          <Input
            id={`${id}-address`}
            spellCheck={false}
            className="font-mono text-[12px]"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
            }}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('developer.testnets.addressHint')}</p>
      <Button type="submit" disabled={mine.isPending || node.status.state !== 'running'}>
        {t('developer.testnets.mine')}
      </Button>
      {mine.data && (
        <StatusIndicator
          tone="healthy"
          label={t('developer.testnets.mined', { count: mine.data.hashes.length, height: mine.data.height })}
        />
      )}
    </form>
  );
}

function TestnetsTab({ nodes }: { nodes: readonly NodeWithStatus[] }) {
  const { t } = useTranslation();
  const test = nodes.filter((node) => node.profile.network !== 'mainnet');
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">{t('developer.testnets.intro')}</p>
      {test.length === 0 ? (
        <div className="space-y-3">
          <p className="text-muted-foreground">{t('developer.testnets.none')}</p>
          <Button asChild>
            <Link to="/nodes/setup">{t('developer.testnets.setUp')}</Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {test.map((node) => (
            <Card key={node.profile.id}>
              <CardHeader>
                <CardTitle>{node.profile.name}</CardTitle>
                <NetworkBadge network={node.profile.network} />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <Link to="/nodes/$nodeId/console" params={{ nodeId: node.profile.id }}>
                      {t('developer.testnets.console')}
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/explorer" search={{ node: node.profile.id }}>
                      {t('developer.testnets.explorer')}
                    </Link>
                  </Button>
                </div>
                {node.profile.network === 'regtest' ? (
                  <MineForm node={node} />
                ) : (
                  <p className="text-muted-foreground">{t('developer.testnets.noMining')}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function EndpointsTab() {
  const { t } = useTranslation();
  const id = useId();
  const [kind, setKind] = useState<ProbeKind>('electrum');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('50001');
  const [tls, setTls] = useState(false);
  const [viaTor, setViaTor] = useState(false);
  const [path, setPath] = useState('/');
  const probe = useMutation({
    mutationFn: () =>
      callOrchestrator(
        'devtools.probe',
        {
          kind,
          host: host.trim(),
          port: Number(port),
          tls: kind === 'http' || kind === 'electrum' ? tls : false,
          viaTor,
          ...(kind === 'http' ? { path: path.trim() || '/' } : {}),
        },
        { timeoutMs: 60_000 },
      ),
  });
  const portNumber = Number(port);
  const valid = host.trim() !== '' && Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65_536;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">{t('developer.endpoints.intro')}</p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) probe.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_7rem]">
          <div className="space-y-1">
            <Label htmlFor={`${id}-kind`}>{t('developer.endpoints.kind')}</Label>
            <NativeSelect
              id={`${id}-kind`}
              className="w-full"
              value={kind}
              onChange={(event) => {
                const next = PROBE_KINDS.find((candidate) => candidate === event.target.value);
                if (next) setKind(next);
              }}
            >
              {PROBE_KINDS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {t(`developer.endpoints.kinds.${candidate}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-host`}>{t('developer.endpoints.host')}</Label>
            <Input
              id={`${id}-host`}
              spellCheck={false}
              value={host}
              onChange={(event) => {
                setHost(event.target.value);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-port`}>{t('developer.endpoints.port')}</Label>
            <Input
              id={`${id}-port`}
              type="number"
              min={1}
              max={65_535}
              value={port}
              onChange={(event) => {
                setPort(event.target.value);
              }}
            />
          </div>
        </div>
        {kind === 'http' && (
          <div className="max-w-md space-y-1">
            <Label htmlFor={`${id}-path`}>{t('developer.endpoints.path')}</Label>
            <Input
              id={`${id}-path`}
              spellCheck={false}
              value={path}
              onChange={(event) => {
                setPath(event.target.value);
              }}
            />
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          {(kind === 'http' || kind === 'electrum') && (
            <label className="flex items-center gap-2">
              <Checkbox
                checked={tls}
                onChange={(event) => {
                  setTls(event.target.checked);
                }}
              />
              {t('developer.endpoints.tls')}
            </label>
          )}
          <label className="flex items-center gap-2">
            <Checkbox
              checked={viaTor}
              onChange={(event) => {
                setViaTor(event.target.checked);
              }}
            />
            {t('developer.endpoints.viaTor')}
          </label>
        </div>
        <Button type="submit" disabled={!valid || probe.isPending}>
          {t('developer.endpoints.probe')}
        </Button>
      </form>
      {probe.isError && <ErrorPanel title={t('developer.endpoints.failed')} error={toOrchestratorError(probe.error)} />}
      {probe.data && (
        <Card>
          <CardHeader>
            <CardTitle>{t('developer.endpoints.result')}</CardTitle>
            <StatusIndicator
              tone={probe.data.reachable ? 'healthy' : 'failed'}
              label={probe.data.reachable ? t('developer.endpoints.reachable') : t('developer.endpoints.unreachable')}
            />
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="space-y-2">
              {probe.data.steps.map((step) => (
                <li key={step.name} className="flex gap-3">
                  {step.ok ? (
                    <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
                  )}
                  <div className="min-w-0">
                    <p>
                      <span className="font-medium">{step.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground tabular">
                        {t('developer.endpoints.took', { ms: step.durationMs })}
                      </span>
                    </p>
                    <p className="break-words text-muted-foreground">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            {probe.data.answer !== null && probe.data.answer !== '' && (
              <pre className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[12px]">
                {probe.data.answer}
              </pre>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function DeveloperPage({ tab }: { tab: DeveloperTab | undefined }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const nodes = useNodes();
  const [nodeId, setNodeId] = useState<string>();
  const list = nodes.data ?? [];
  const chosen =
    list.find((node) => node.profile.id === nodeId) ?? list.find((node) => node.status.state === 'running') ?? list[0];
  const needsNode = (current: DeveloperTab) =>
    current === 'decode' || current === 'uri' || current === 'coins' || current === 'features' || current === 'events';
  const current = tab ?? 'decode';
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('developer.title')}</h1>
        <p className="max-w-3xl text-muted-foreground">{t('developer.description')}</p>
      </div>
      <Tabs
        value={current}
        onValueChange={(value) => {
          const next = DEVELOPER_TABS.find((candidate) => candidate === value);
          if (next) void navigate({ to: '/developer', search: { tab: next }, replace: true });
        }}
      >
        <TabsList>
          {DEVELOPER_TABS.map((candidate) => (
            <TabsTrigger key={candidate} value={candidate}>
              {t(`developer.tabs.${candidate}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {needsNode(current) && list.length > 0 && chosen && (
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <NodePicker nodes={list} value={chosen.profile.id} onChange={setNodeId} />
            <Button asChild variant="outline">
              <Link to="/nodes/$nodeId/console" params={{ nodeId: chosen.profile.id }}>
                {t('developer.workbench')}
              </Link>
            </Button>
          </div>
        )}
        <div className="mt-4">
          {needsNode(current) && !nodes.data ? (
            <Skeleton className="h-40" />
          ) : needsNode(current) && !chosen ? (
            <p className="text-muted-foreground">{t('developer.noNode')}</p>
          ) : null}
          <TabsContent value="decode">{chosen && <DecodeTab key={chosen.profile.id} node={chosen} />}</TabsContent>
          <TabsContent value="uri">
            {chosen && <UriTab key={chosen.profile.id} nodeId={chosen.profile.id} />}
          </TabsContent>
          <TabsContent value="coins">
            {chosen && <CoinsTab key={chosen.profile.id} nodeId={chosen.profile.id} />}
          </TabsContent>
          <TabsContent value="convert">
            <ConvertTab />
          </TabsContent>
          <TabsContent value="features">
            {chosen && <FeaturesTab key={chosen.profile.id} nodeId={chosen.profile.id} />}
          </TabsContent>
          <TabsContent value="events">
            {chosen && <EventsTab key={chosen.profile.id} nodeId={chosen.profile.id} />}
          </TabsContent>
          <TabsContent value="testnets">
            <TestnetsTab nodes={list} />
          </TabsContent>
          <TabsContent value="endpoints">
            <EndpointsTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
