import { useNavigate } from '@tanstack/react-router';
import { Info, PlugZap } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { DiscoveredNode } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { NetworkBadge } from '@/components/status/network-badge';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useConnectDiscovered, useDiscoveredNodes } from './queries';

// Bitcoin Core already on this computer, connected with one click
// (specification sections 5.1 and 25). BTCortex works out the address and
// cookie itself and never changes or starts a node it did not set up.

function DiscoveredNodeCard({ node }: { node: DiscoveredNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const connect = useConnectDiscovered();
  const helpId = useId();
  const name = t('nodes.discovered.defaultName', { network: t(`networks.${node.network}`) });
  const blocked = !node.running || node.rpcServer === 'off';
  const help = !node.running
    ? t('nodes.discovered.notRunningHelp')
    : node.rpcServer === 'off'
      ? t('nodes.discovered.rpcOffHelp')
      : node.authentication === 'password-in-config'
        ? t('nodes.discovered.passwordHelp')
        : undefined;

  const run = () => {
    connect.mutate(
      {
        dataDirectory: node.dataDirectory,
        network: node.network,
        name,
        useConfiguredPassword: node.authentication === 'password-in-config',
      },
      {
        onSuccess: (profile) => {
          toast.success(t('nodes.discovered.connected', { name: profile.name }));
          void navigate({ to: '/nodes/$nodeId', params: { nodeId: profile.id } });
        },
      },
    );
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">Bitcoin Core</h3>
        <NetworkBadge network={node.network} />
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t('nodes.discovered.folder')}</dt>
        <dd className="min-w-0 break-all font-mono text-[13px]">{node.dataDirectory}</dd>
        <dt className="text-muted-foreground">{t('nodes.discovered.state')}</dt>
        <dd>
          <StatusIndicator
            tone={node.running ? 'healthy' : 'inactive'}
            label={
              !node.running
                ? t('nodes.discovered.notRunning')
                : node.program === 'bitcoin-qt'
                  ? t('nodes.discovered.runningWindow')
                  : t('nodes.discovered.running')
            }
          />
        </dd>
        <dt className="text-muted-foreground">{t('nodes.discovered.contents')}</dt>
        <dd>
          {node.hasChainData ? t('nodes.discovered.chainData') : t('nodes.discovered.noChainData')}
          {node.walletFiles > 0 && ` · ${t('nodes.discovered.walletFiles', { count: node.walletFiles })}`}
        </dd>
      </dl>
      {help && (
        <p id={helpId} className="flex items-start gap-2 text-sm">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
          <span>{help}</span>
        </p>
      )}
      {connect.isError && (
        <ErrorPanel title={t('nodes.discovered.connectFailed')} error={toOrchestratorError(connect.error)} />
      )}
      <Button disabled={blocked || connect.isPending} aria-describedby={help ? helpId : undefined} onClick={run}>
        <PlugZap aria-hidden="true" />
        {connect.isPending
          ? t('nodes.discovered.connecting')
          : node.authentication === 'password-in-config'
            ? t('nodes.discovered.connectWithPassword')
            : t('nodes.discovered.connect')}
      </Button>
    </div>
  );
}

export function DiscoveredNodes() {
  const { t } = useTranslation();
  const headingId = useId();
  const discovered = useDiscoveredNodes();
  const candidates = (discovered.data ?? []).filter((node) => node.registeredAs === undefined);
  // Nothing to offer, or nothing found yet: the section stays out of the way.
  if (candidates.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div>
        <h2 id={headingId} className="text-base font-semibold">
          {t('nodes.discovered.title')}
        </h2>
        <p className="text-muted-foreground">{t('nodes.discovered.description')}</p>
      </div>
      <ul className="grid gap-4 lg:grid-cols-2">
        {candidates.map((node) => (
          <li key={`${node.dataDirectory}-${node.network}`}>
            <DiscoveredNodeCard node={node} />
          </li>
        ))}
      </ul>
    </section>
  );
}
