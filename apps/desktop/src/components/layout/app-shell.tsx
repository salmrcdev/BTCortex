import { Outlet, useRouterState } from '@tanstack/react-router';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { NETWORK_STRIPE_CLASSES } from '@/components/status/network-badge';
import { useNodes } from '@/features/nodes/queries';
import { useFirstRunGuide } from '@/features/welcome/queries';
import { cn } from '@/lib/utils';
import { CommandPalette } from './command-palette';
import { ShortcutsDialog, useGlobalShortcuts } from './shortcuts-dialog';
import { Sidebar } from './sidebar';
import { StatusBar } from './status-bar';

export function AppShell() {
  const { t } = useTranslation();
  const main = useRef<HTMLElement>(null);
  const nodes = useNodes();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useGlobalShortcuts();
  useFirstRunGuide();

  // The node in view, or else the first registered one, sets the window's network identity.
  const viewedId = /^\/nodes\/([^/]+)$/.exec(pathname)?.[1];
  const activeNode = nodes.data?.find((node) => node.profile.id === viewedId) ?? nodes.data?.[0];
  const network = activeNode?.profile.network;

  return (
    <div className="flex h-full flex-col">
      {network && network !== 'mainnet' && (
        <div className={cn('h-[3px] shrink-0', NETWORK_STRIPE_CLASSES[network])}>
          <span className="sr-only">{t('app.testNetworkNotice', { network: t(`networks.${network}`) })}</span>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {/* Hash routing owns the URL fragment, so the skip link moves focus itself. */}
        <button
          type="button"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
          onClick={() => main.current?.focus()}
        >
          {t('app.skipToContent')}
        </button>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <StatusBar activeNode={activeNode} />
          <main ref={main} id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto focus:outline-none">
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette />
      <ShortcutsDialog />
    </div>
  );
}
