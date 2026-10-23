import { Search } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BitcoinNetwork, OptionCategory } from '@btcortex/bitcoin-config';
import { Input } from '@/components/ui/form-controls';
import { cn } from '@/lib/utils';
import { CATEGORY_ORDER } from './config-model';
import type { OptionState } from './config-model';
import { OptionRow } from './option-row';

// Graphical bitcoin.conf editor (specification section 5.6). The first view
// shows what the file sets; the categories show every option BTCortex knows;
// search looks through all of them.

type View = 'in-file' | OptionCategory;

export interface SettingsEditorProps {
  states: OptionState[];
  unknown: { key: string; value: string; line: number }[];
  network: BitcoinNetwork;
  readOnly: boolean;
  onChange: (key: string, values: string[] | undefined) => void;
  onShowLine: (line: number) => void;
}

function inFile(state: OptionState): boolean {
  return state.values !== undefined || state.changed || state.ignoredLines.length > 0;
}

export function SettingsEditor({ states, unknown, network, readOnly, onChange, onShowLine }: SettingsEditorProps) {
  const { t } = useTranslation();
  const searchId = useId();
  const [view, setView] = useState<View>('in-file');
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();

  const visible = states.filter((state) => {
    if (term !== '') {
      return state.definition.key.includes(term) || state.definition.description.toLowerCase().includes(term);
    }
    return view === 'in-file' ? inFile(state) : state.definition.category === view;
  });
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    states: visible.filter((state) => state.definition.category === category),
  })).filter((group) => group.states.length > 0);
  const visibleUnknown =
    term === ''
      ? view === 'in-file'
        ? unknown
        : []
      : unknown.filter((setting) => setting.key.toLowerCase().includes(term));
  const inFileCount = states.filter(inFile).length + unknown.length;

  const navItem = (item: View, label: string, count: number) => (
    <li key={item}>
      <button
        type="button"
        aria-current={term === '' && view === item ? 'true' : undefined}
        className={cn(
          'flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-muted',
          term === '' && view === item && 'bg-muted font-medium',
        )}
        onClick={() => {
          setView(item);
          setQuery('');
        }}
      >
        <span>{label}</span>
        <span className="tabular text-xs text-muted-foreground">{count}</span>
      </button>
    </li>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="space-y-4 lg:sticky lg:top-0 lg:self-start">
        <div className="space-y-1.5">
          <label htmlFor={searchId} className="text-sm font-medium">
            {t('config.search')}
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={searchId}
              type="search"
              // Focus lands here when the option row the user was on disappears.
              data-config-focus=""
              value={query}
              placeholder={t('config.searchPlaceholder')}
              className="pl-8"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
        </div>
        <nav aria-label={t('config.categoriesLabel')}>
          <ul className="space-y-0.5">
            {navItem('in-file', t('config.inFile'), inFileCount)}
            {CATEGORY_ORDER.map((category) =>
              navItem(
                category,
                t(`config.categories.${category}`),
                states.filter((state) => state.definition.category === category).length,
              ),
            )}
          </ul>
        </nav>
      </div>

      <div className="min-w-0">
        <h3 className="sr-only" aria-live="polite">
          {term !== ''
            ? t('config.searchResults')
            : view === 'in-file'
              ? t('config.inFile')
              : t(`config.categories.${view}`)}
        </h3>
        {groups.length === 0 && visibleUnknown.length === 0 && (
          <p className="py-4 text-muted-foreground">
            {term !== '' ? t('config.noResults', { query: query.trim() }) : t('config.noSetSettings')}
          </p>
        )}
        {groups.map((group) => (
          <section key={group.category} aria-labelledby={`${searchId}-${group.category}`} className="mb-4">
            <h4
              id={`${searchId}-${group.category}`}
              // A single category needs no visible heading; the navigation already names it.
              className={cn(
                'pt-2 text-sm font-semibold text-muted-foreground',
                term === '' && view !== 'in-file' && 'sr-only',
              )}
            >
              {t(`config.categories.${group.category}`)}
            </h4>
            {group.states.map((state) => (
              <OptionRow
                key={state.definition.key}
                state={state}
                network={network}
                readOnly={readOnly}
                onChange={onChange}
                onShowLine={onShowLine}
              />
            ))}
          </section>
        ))}
        {visibleUnknown.length > 0 && (
          <section aria-labelledby={`${searchId}-unknown`} className="space-y-2 pt-2">
            <h4 id={`${searchId}-unknown`} className="text-sm font-semibold text-muted-foreground">
              {t('config.otherOptions')}
            </h4>
            <p className="text-muted-foreground">{t('config.otherOptionsHelp')}</p>
            <ul className="space-y-1">
              {visibleUnknown.map((setting) => (
                <li key={setting.line} className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-[13px]">
                    {setting.key}={setting.value}
                  </span>
                  <button
                    type="button"
                    className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    aria-label={t('config.showLine', { line: setting.line })}
                    onClick={() => {
                      onShowLine(setting.line);
                    }}
                  >
                    {t('config.line', { line: setting.line })}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
