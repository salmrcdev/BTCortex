import { Link } from '@tanstack/react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import iconUrl from '@/assets/brand/btcortex-icon.png';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePreferences } from '@/stores/preferences';
import { NAVIGATION } from './navigation';

export function Sidebar() {
  const { t } = useTranslation();
  const collapsed = usePreferences((state) => state.sidebarCollapsed);
  const setCollapsed = usePreferences((state) => state.setSidebarCollapsed);

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-11 items-center gap-2 border-b border-sidebar-border',
          collapsed ? 'justify-center px-2' : 'px-3',
        )}
      >
        <img src={iconUrl} alt="" className="size-6" />
        {!collapsed && <span className="font-mono text-[15px] font-semibold tracking-tight">BTCortex</span>}
      </div>

      <nav aria-label={t('app.primaryNavigation')} className="flex-1 overflow-y-auto py-3">
        {NAVIGATION.map((group) => (
          <div key={group.labelKey} className="mb-4">
            {!collapsed && (
              <p className="px-4 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(group.labelKey)}
              </p>
            )}
            <ul className="space-y-0.5 px-2">
              {group.items.map((item) => {
                const label = t(item.labelKey);
                const link = (
                  <Link
                    to={item.to}
                    activeOptions={{ exact: item.to === '/' }}
                    className={cn(
                      'relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-150 hover:bg-muted',
                      collapsed && 'justify-center px-0',
                    )}
                    activeProps={{
                      className:
                        'bg-muted font-medium before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary',
                      'aria-current': 'page',
                    }}
                    aria-label={collapsed ? label : undefined}
                  >
                    <item.icon aria-hidden="true" className="size-4 shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </Link>
                );
                return (
                  <li key={item.to}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right">{label}</TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn('border-t border-sidebar-border p-2', collapsed && 'flex justify-center')}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={collapsed ? t('app.expandSidebar') : t('app.collapseSidebar')}
          onClick={() => {
            setCollapsed(!collapsed);
          }}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </Button>
      </div>
    </aside>
  );
}
