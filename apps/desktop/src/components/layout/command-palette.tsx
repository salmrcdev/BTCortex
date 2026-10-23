import { useNavigate } from '@tanstack/react-router';
import type { NavigateOptions } from '@tanstack/react-router';
import { Compass, Keyboard, Moon, PanelLeft, Plus, Search, Server, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useNodes } from '@/features/nodes/queries';
import { cn } from '@/lib/utils';
import { useOverlays } from '@/stores/overlays';
import { usePreferences, useResolvedTheme } from '@/stores/preferences';
import { NAVIGATION } from './navigation';

// The global command palette (specification section 24): every page, every
// node and its sections, a few safe actions, and lookups in the explorer.
// Nothing here changes a node or a service; those actions keep their own
// confirmations on their pages.

type Group = 'pages' | 'nodes' | 'actions' | 'explorer';
const GROUPS: readonly Group[] = ['explorer', 'pages', 'nodes', 'actions'];
const NODE_SECTIONS = ['peers', 'privacy', 'mempool', 'storage', 'configuration', 'console'] as const;

interface Command {
  id: string;
  group: Group;
  label: string;
  /** Extra words the command is found by. */
  keywords: string;
  icon: LucideIcon;
  run: () => void;
  /** Shown only once something is typed, to keep the first view short. */
  onlyWhenSearching?: boolean;
}

/** Text the explorer can look up: a block height, a hash, an address, or raw hexadecimal. */
export function looksLikeChainData(text: string): boolean {
  return (
    /^\d{1,7}$/.test(text) ||
    /^[0-9a-f]{64}$/i.test(text) ||
    /^(bc|tb|bcrt)1[02-9ac-hj-np-z]{6,87}$/i.test(text) ||
    /^[123mn][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(text) ||
    (/^[0-9a-f]+$/i.test(text) && text.length >= 20 && text.length % 2 === 0)
  );
}

function matches(command: Command, words: readonly string[]): boolean {
  const haystack = `${command.label} ${command.keywords}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const open = useOverlays((state) => state.open === 'palette');
  const close = useOverlays((state) => state.close);
  const show = useOverlays((state) => state.show);
  const theme = useResolvedTheme();
  const toggleTheme = usePreferences((state) => state.toggleTheme);
  const collapsed = usePreferences((state) => state.sidebarCollapsed);
  const setCollapsed = usePreferences((state) => state.setSidebarCollapsed);
  const nodes = useNodes();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();
  const listId = `${id}-list`;

  const commands = useMemo((): Command[] => {
    const go = (options: NavigateOptions) => () => {
      void navigate(options);
    };
    const pages = NAVIGATION.flatMap((group) =>
      group.items.map((item): Command => ({
        id: `page:${item.to}`,
        group: 'pages',
        label: t(item.labelKey),
        keywords: t(group.labelKey),
        icon: item.icon,
        run: go({ to: item.to }),
      })),
    );
    const nodeCommands = (nodes.data ?? []).flatMap(({ profile }) => [
      {
        id: `node:${profile.id}`,
        group: 'nodes' as const,
        label: profile.name,
        keywords: `${t('palette.node')} ${t(`networks.${profile.network}`)}`,
        icon: Server,
        run: go({ to: '/nodes/$nodeId', params: { nodeId: profile.id } }),
      },
      ...NODE_SECTIONS.map((section): Command => ({
        id: `node:${profile.id}:${section}`,
        group: 'nodes',
        label: `${profile.name} › ${t(`node.sections.${section}`)}`,
        keywords: t('palette.node'),
        icon: Server,
        run: go({ to: `/nodes/$nodeId/${section}`, params: { nodeId: profile.id } }),
        onlyWhenSearching: true,
      })),
    ]);
    const actions: Command[] = [
      {
        id: 'action:setup',
        group: 'actions',
        label: t('palette.actions.setUpNode'),
        keywords: t('palette.actions.setUpNodeKeywords'),
        icon: Plus,
        run: go({ to: '/nodes/setup' }),
      },
      {
        id: 'action:welcome',
        group: 'actions',
        label: t('palette.actions.welcome'),
        keywords: t('palette.actions.welcomeKeywords'),
        icon: Compass,
        run: go({ to: '/welcome' }),
      },
      {
        id: 'action:theme',
        group: 'actions',
        label: theme === 'dark' ? t('app.switchToLight') : t('app.switchToDark'),
        keywords: t('palette.actions.themeKeywords'),
        icon: theme === 'dark' ? Sun : Moon,
        run: toggleTheme,
      },
      {
        id: 'action:sidebar',
        group: 'actions',
        label: collapsed ? t('app.expandSidebar') : t('app.collapseSidebar'),
        keywords: t('palette.actions.sidebarKeywords'),
        icon: PanelLeft,
        run: () => {
          setCollapsed(!collapsed);
        },
      },
      {
        id: 'action:shortcuts',
        group: 'actions',
        label: t('palette.actions.shortcuts'),
        keywords: t('palette.actions.shortcutsKeywords'),
        icon: Keyboard,
        run: () => {
          show('shortcuts');
        },
      },
    ];
    return [...pages, ...nodeCommands, ...actions];
  }, [t, navigate, nodes.data, theme, toggleTheme, collapsed, setCollapsed, show]);

  const text = query.trim();
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const results: Command[] = [
    ...(looksLikeChainData(text)
      ? [
          {
            id: 'explorer',
            group: 'explorer' as const,
            label: t('palette.explorer', { text }),
            keywords: '',
            icon: Search,
            run: () => {
              void navigate({ to: '/explorer', search: { q: text } });
            },
          },
        ]
      : []),
    ...commands.filter((command) =>
      words.length === 0 ? command.onlyWhenSearching !== true : matches(command, words),
    ),
  ].sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
  const current = Math.min(active, Math.max(0, results.length - 1));
  const optionId = (index: number) => `${id}-option-${String(index)}`;

  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
  });

  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    command.run();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        close();
        setQuery('');
        setActive(0);
      }}
    >
      <DialogContent className="overflow-hidden p-0">
        <DialogTitle className="sr-only">{t('palette.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('palette.description')}</DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length > 0 ? optionId(current) : undefined}
            aria-label={t('palette.title')}
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={t('palette.placeholder')}
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (results.length === 0) return;
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setActive((current + step + results.length) % results.length);
              } else if (event.key === 'Home' && results.length > 0) {
                event.preventDefault();
                setActive(0);
              } else if (event.key === 'End' && results.length > 0) {
                event.preventDefault();
                setActive(results.length - 1);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(results[current]);
              }
            }}
          />
        </div>
        {results.length === 0 ? (
          <div className="space-y-1 px-4 py-6 text-center" role="status">
            <p className="font-medium">{t('palette.nothing', { text })}</p>
            <p className="text-muted-foreground">{t('palette.suggestion')}</p>
          </div>
        ) : (
          // The grouped listbox of the WAI-ARIA authoring practices; focus stays in the search field.
          <div
            id={listId}
            role="listbox"
            aria-label={t('palette.results')}
            className="max-h-[60vh] overflow-y-auto p-2"
          >
            {GROUPS.filter((group) => results.some((command) => command.group === group)).map((group) => (
              <ul key={group} role="group" aria-labelledby={`${id}-${group}`}>
                <li
                  role="presentation"
                  id={`${id}-${group}`}
                  className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {t(`palette.groups.${group}`)}
                </li>
                {results.map((command, index) =>
                  command.group !== group ? null : (
                    <li
                      key={command.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === current}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm',
                        index === current ? 'bg-muted text-foreground' : 'text-muted-foreground',
                      )}
                      onMouseMove={() => {
                        if (index !== current) setActive(index);
                      }}
                      onClick={() => {
                        run(command);
                      }}
                    >
                      <command.icon aria-hidden="true" className="size-4 shrink-0" />
                      <span className="truncate">{command.label}</span>
                    </li>
                  ),
                )}
              </ul>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
