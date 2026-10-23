import { useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useOverlays } from '@/stores/overlays';
import { usePreferences } from '@/stores/preferences';
import { helpFor } from '@/features/help/documents';
import { SHORTCUTS, shortcutFor } from './keyboard';

/** Listens for the application-wide shortcuts; mounted once, in the application shell. */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  const router = useRouter();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const shortcut = shortcutFor(event);
      if (shortcut === undefined) return;
      event.preventDefault();
      const overlays = useOverlays.getState();
      switch (shortcut) {
        case 'palette':
        case 'shortcuts':
          overlays.toggle(shortcut);
          return;
        case 'sidebar': {
          const preferences = usePreferences.getState();
          preferences.setSidebarCollapsed(!preferences.sidebarCollapsed);
          return;
        }
        case 'settings':
          overlays.close();
          void navigate({ to: '/settings' });
          return;
        case 'help': {
          overlays.close();
          const pathname = router.state.location.pathname;
          // On the help page itself, F1 stays where it is.
          if (pathname === '/help') return;
          const help = helpFor(pathname);
          void navigate({
            to: '/help',
            search: { doc: help.document, ...(help.section ? { section: help.section } : {}) },
          });
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [navigate, router]);
}

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key) => (
        <kbd key={key} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          {key}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutsDialog() {
  const { t } = useTranslation();
  const open = useOverlays((state) => state.open === 'shortcuts');
  const close = useOverlays((state) => state.close);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="max-w-md space-y-3 p-5">
        <DialogTitle>{t('shortcuts.title')}</DialogTitle>
        <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        <dl className="divide-y">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.id} className="flex items-center justify-between gap-4 py-2">
              <dt>{t(`shortcuts.items.${shortcut.id}`)}</dt>
              <dd>
                <Keys keys={shortcut.keys} />
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
