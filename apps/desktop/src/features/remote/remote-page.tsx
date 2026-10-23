import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Globe, House, ShieldCheck, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { endpointParts, isLocalNetworkHost, isLoopbackHost } from '@btcortex/contracts';
import type { RemoteServiceKind, RemoteTestResult } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { NodeStateIndicator } from '@/components/status/node-state';
import { StatusIndicator } from '@/components/status/status-indicator';
import type { StatusTone } from '@/components/status/status-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { lightningState } from '@/features/lightning/parts';
import { useLightningConnections } from '@/features/lightning/queries';
import { useNodes } from '@/features/nodes/queries';
import { useRemoteElectrumServers } from '@/features/electrum/queries';
import { useRemoteExplorers } from '@/features/explorer/queries';
import { usePaymentServers } from '@/features/payments/queries';
import { callOrchestrator, toOrchestratorError } from '@/lib/orchestrator';

// Remote infrastructure (specification sections 24.1, area 22, and 26): every
// service BTCortex reaches on another computer, grouped by the computer, with
// how it is reached, what BTCortex may do there, and a connection test. Each
// permission comes from the service's own credentials; BTCortex never logs in
// to those computers, so it has no operating-system access to them.

export type Reach = 'tor' | 'local-network' | 'internet';

interface RemoteService {
  kind: RemoteServiceKind;
  id: string;
  name: string;
  address: string;
  status: ReactNode;
  /** What the credentials let BTCortex do; keys of `remote.capabilities`. */
  capability: string;
  route: '/nodes' | '/lightning' | '/payments' | '/electrum' | '/explorer';
}

export function reachOf(host: string): Reach {
  if (host.toLowerCase().endsWith('.onion')) return 'tor';
  return isLocalNetworkHost(host) ? 'local-network' : 'internet';
}

/** The host of `host:port`, `[ipv6]:port` or a URL, in lower case. */
export function hostOf(address: string): string {
  if (/^https?:\/\//i.test(address)) return endpointParts(address).hostname.replace(/^\[|\]$/g, '');
  const bracketed = /^\[([^\]]+)\]/.exec(address);
  if (bracketed?.[1]) return bracketed[1].toLowerCase();
  return (address.split(':')[0] ?? address).toLowerCase();
}

const REACH_ICONS: Record<Reach, LucideIcon> = { tor: Waypoints, 'local-network': House, internet: Globe };
const PAYMENT_TONES: Record<string, StatusTone> = {
  checking: 'working',
  online: 'healthy',
  synchronising: 'working',
  unreachable: 'failed',
  unauthorised: 'attention',
};

function TestButton({ kind, id }: { kind: RemoteServiceKind; id: string }) {
  const { t } = useTranslation();
  const test = useMutation({
    mutationFn: () => callOrchestrator('remote.test', { kind, id }, { timeoutMs: 90_000 }),
  });
  const result: RemoteTestResult | undefined = test.data;
  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        disabled={test.isPending}
        onClick={() => {
          test.mutate();
        }}
      >
        {test.isPending ? t('remote.testing') : t('remote.test')}
      </Button>
      {result && (
        <p role="status" className="text-sm">
          <StatusIndicator
            tone={result.ok ? 'healthy' : 'failed'}
            label={
              result.ok && result.latencyMs !== null
                ? t('remote.answered', { ms: result.latencyMs })
                : t('remote.noAnswer')
            }
          />
          <span className="block text-muted-foreground">{result.detail}</span>
        </p>
      )}
    </div>
  );
}

export function RemotePage() {
  const { t } = useTranslation();
  const nodes = useNodes();
  const lightning = useLightningConnections();
  const payments = usePaymentServers();
  const electrum = useRemoteElectrumServers();
  const explorers = useRemoteExplorers();

  const services: RemoteService[] = [
    ...(nodes.data ?? [])
      .filter(
        ({ profile }) =>
          profile.execution !== 'managed' && !isLoopbackHost(endpointParts(profile.rpcEndpoint).hostname),
      )
      .map(({ profile, status }) => ({
        kind: 'bitcoin-node' as const,
        id: profile.id,
        name: profile.name,
        address: profile.rpcEndpoint,
        status: <NodeStateIndicator status={status} />,
        capability: 'bitcoin-node',
        route: '/nodes' as const,
      })),
    ...(lightning.data ?? [])
      .filter(({ connection }) => !connection.local && !isLoopbackHost(hostOf(connection.restAddress)))
      .map(({ connection, status }) => {
        const state = lightningState(status, t);
        return {
          kind: 'lightning' as const,
          id: connection.id,
          name: connection.name,
          address: connection.restAddress,
          status: <StatusIndicator tone={state.tone} label={state.label} />,
          capability: `lightning-${connection.macaroon.access}`,
          route: '/lightning' as const,
        };
      }),
    ...(payments.data ?? []).map(({ server, status }) => ({
      kind: 'payments' as const,
      id: server.id,
      name: server.name,
      address: server.url,
      status: (
        <StatusIndicator tone={PAYMENT_TONES[status.state] ?? 'unknown'} label={t(`payments.states.${status.state}`)} />
      ),
      capability: 'payments',
      route: '/payments' as const,
    })),
    ...(electrum.data ?? []).map(({ server, status }) => ({
      kind: 'electrum' as const,
      id: server.id,
      name: server.name,
      address: `${server.host}:${String(server.port)}`,
      status: (
        <StatusIndicator
          tone={status.state === 'online' ? 'healthy' : status.state === 'unknown' ? 'unknown' : 'failed'}
          label={t(`electrum.remoteServers.states.${status.state}`)}
        />
      ),
      capability: 'electrum',
      route: '/electrum' as const,
    })),
    ...(explorers.data ?? []).map(({ explorer, status }) => ({
      kind: 'explorer' as const,
      id: explorer.id,
      name: explorer.name,
      address: explorer.url,
      status: (
        <StatusIndicator
          tone={status.state === 'online' ? 'healthy' : status.state === 'unknown' ? 'unknown' : 'failed'}
          label={t(`explorer.remote.states.${status.state}`)}
        />
      ),
      capability: 'explorer',
      route: '/explorer' as const,
    })),
  ];

  const hosts = new Map<string, RemoteService[]>();
  for (const service of services) {
    const host = hostOf(service.address);
    hosts.set(host, [...(hosts.get(host) ?? []), service]);
  }
  const failure = nodes.error ?? lightning.error ?? payments.error ?? electrum.error ?? explorers.error;
  const loading = !nodes.data || !lightning.data || !payments.data || !electrum.data || !explorers.data;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="font-mono text-xl font-semibold">{t('remote.title')}</h1>
        <p className="max-w-prose text-muted-foreground">{t('remote.description')}</p>
      </div>
      {failure ? (
        <ErrorPanel title={t('remote.unavailable')} error={toOrchestratorError(failure)} />
      ) : loading ? (
        <Skeleton className="h-48" />
      ) : hosts.size === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="max-w-prose text-muted-foreground">{t('remote.none')}</p>
          </CardContent>
        </Card>
      ) : (
        [...hosts].map(([host, entries]) => {
          const reach = reachOf(host);
          const Icon = REACH_ICONS[reach];
          return (
            <Card key={host}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 font-mono">
                  <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                  <span className="break-all">{host}</span>
                </CardTitle>
                <Badge variant={reach === 'internet' ? 'warning' : 'outline'}>{t(`remote.reach.${reach}`)}</Badge>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {entries.map((service) => (
                    <li
                      key={`${service.kind}-${service.id}`}
                      className="grid gap-3 py-3 md:grid-cols-[1fr_1fr_auto] md:items-start"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <Link to={service.route} className="font-medium underline-offset-2 hover:underline">
                            {service.name}
                          </Link>
                          <Badge variant="neutral">{t(`remote.kinds.${service.kind}`)}</Badge>
                        </p>
                        <p className="break-all font-mono text-xs text-muted-foreground">{service.address}</p>
                        {service.status}
                      </div>
                      <p className="flex items-start gap-2 text-muted-foreground">
                        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        <span>
                          {t(`remote.capabilities.${service.capability}`, {
                            defaultValue: t('remote.capabilities.lightning-custom'),
                          })}
                        </span>
                      </p>
                      <TestButton kind={service.kind} id={service.id} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('remote.add.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="max-w-prose text-muted-foreground">{t('remote.add.body')}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/nodes">{t('remote.add.node')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/lightning">{t('remote.add.lightning')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/payments">{t('remote.add.payments')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/electrum">{t('remote.add.electrum')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/explorer">{t('remote.add.explorer')}</Link>
            </Button>
          </div>
          <p className="max-w-prose text-muted-foreground">{t('remote.add.noLogin')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
