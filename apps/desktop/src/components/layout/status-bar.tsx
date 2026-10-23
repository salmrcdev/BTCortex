import { Link } from '@tanstack/react-router';
import { Moon, Search, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NodeWithStatus, OrchestratorStatus } from '@btcortex/contracts';
import { NetworkBadge } from '@/components/status/network-badge';
import { NodeStateIndicator } from '@/components/status/node-state';
import { StatusIndicator } from '@/components/status/status-indicator';
import type { StatusTone } from '@/components/status/status-indicator';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatNumber } from '@/lib/format';
import { useOrchestratorStatus } from '@/stores/orchestrator-status';
import { useOverlays } from '@/stores/overlays';
import { usePreferences, useResolvedTheme } from '@/stores/preferences';
import { AlertsButton } from '@/features/monitoring/health-panels';

const STATUS_TONES: Record<OrchestratorStatus['state'], StatusTone> = {
  starting: 'working',
  running: 'healthy',
  restarting: 'attention',
  stopped: 'inactive',
  failed: 'failed',
};

/** The node the status bar reports on; its network is always visible (specification section 5.4). */
function ActiveNode({ node }: { node: NodeWithStatus }) {
  const blocks = node.status.snapshot?.blockchain.blocks;
  return (
    <Link
      to="/nodes/$nodeId"
      params={{ nodeId: node.profile.id }}
      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
    >
      <NetworkBadge network={node.profile.network} />
      <span className="truncate font-medium">{node.profile.name}</span>
      <NodeStateIndicator status={node.status} className="text-sm" />
      {blocks !== undefined && <span className="tabular text-muted-foreground">#{formatNumber(blocks)}</span>}
    </Link>
  );
}

export function StatusBar({ activeNode }: { activeNode: NodeWithStatus | undefined }) {
  const { t } = useTranslation();
  const status = useOrchestratorStatus((state) => state.status);
  const theme = useResolvedTheme();
  const toggleTheme = usePreferences((state) => state.toggleTheme);
  const showOverlay = useOverlays((state) => state.show);

  const indicator = (
    <StatusIndicator
      tone={STATUS_TONES[status.state]}
      label={`${t('orchestrator.label')}: ${t(`orchestrator.${status.state}`)}`}
      className="text-sm"
    />
  );

  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b bg-background px-4">
      <div className="min-w-0">{activeNode && <ActiveNode node={activeNode} />}</div>
      <div className="flex items-center gap-3">
        <div role="status" aria-live="polite">
          {status.detail ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>{indicator}</span>
              </TooltipTrigger>
              <TooltipContent>{status.detail}</TooltipContent>
            </Tooltip>
          ) : (
            indicator
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              className="h-7 gap-2 px-2 text-muted-foreground"
              onClick={() => {
                showOverlay('palette');
              }}
            >
              <Search aria-hidden="true" />
              {t('app.search')}
              <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">Ctrl K</kbd>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('app.searchHint')}</TooltipContent>
        </Tooltip>
        <AlertsButton />
        <Button
          variant="ghost"
          size="icon"
          aria-label={theme === 'dark' ? t('app.switchToLight') : t('app.switchToDark')}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </Button>
      </div>
    </header>
  );
}
