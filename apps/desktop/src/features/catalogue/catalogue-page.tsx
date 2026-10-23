import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CATALOGUE_CATEGORIES, SUPPORT_LEVELS } from '@btcortex/contracts';
import type { CatalogueCategory, CatalogueEntrySummary, CatalogueIntegration, SupportLevel } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { StatusIndicator } from '@/components/status/status-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useCatalogue } from './queries';

// The Bitcoin Ecosystem Catalogue (specification section 6): every researched
// entry, its target support level, and what BTCortex can do with it today.
// The two are shown apart, so a target is never mistaken for a working
// integration.

type Show = 'all' | 'available' | 'native';

export function IntegrationBadge({ integration }: { integration: CatalogueIntegration }) {
  const { t } = useTranslation();
  if (integration.level !== null) return <Badge variant="success">{t('catalogue.available')}</Badge>;
  if (integration.status !== 'researched') return <Badge variant="outline">{t('catalogue.detectedOnly')}</Badge>;
  return <Badge>{t('catalogue.researchOnly')}</Badge>;
}

function matches(entry: CatalogueEntrySummary, words: string[]): boolean {
  const text = `${entry.name} ${entry.purpose}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

function EntryRow({ entry }: { entry: CatalogueEntrySummary }) {
  const { t } = useTranslation();
  const { state } = entry.integration;
  return (
    <li className="space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          to="/catalogue/$entryId"
          params={{ entryId: entry.id }}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {entry.name}
        </Link>
        <IntegrationBadge integration={entry.integration} />
      </div>
      <p className="line-clamp-2 text-muted-foreground">{entry.purpose}</p>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t('catalogue.target', { level: t(`catalogue.levels.${entry.targetLevel}`) })}</span>
        <span>{t(`catalogue.windows.${entry.windowsNative}`)}</span>
        <span className={entry.maintenance === 'active' ? undefined : 'font-medium text-foreground'}>
          {t(`catalogue.maintenance.${entry.maintenance}`)}
        </span>
        {entry.latestVersion && <span>{t('catalogue.latest', { version: entry.latestVersion })}</span>}
      </p>
      {/* Service health uses the same vocabulary as every other status in BTCortex. */}
      {state && <StatusIndicator className="text-sm" tone={state.health} label={state.summary} />}
    </li>
  );
}

export function CataloguePage() {
  const { t } = useTranslation();
  const catalogue = useCatalogue();
  const searchId = useId();
  const categoryId = useId();
  const levelId = useId();
  const showId = useId();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<CatalogueCategory | 'all'>('all');
  const [level, setLevel] = useState<SupportLevel | 'all'>('all');
  const [show, setShow] = useState<Show>('all');

  const entries = catalogue.data ?? [];
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = entries.filter(
    (entry) =>
      matches(entry, words) &&
      (category === 'all' || entry.category === category) &&
      (level === 'all' || entry.targetLevel === level) &&
      (show === 'all' ||
        (show === 'available' && entry.integration.level !== null) ||
        (show === 'native' && entry.windowsNative === 'yes')),
  );
  const groups = CATALOGUE_CATEGORIES.map((id) => ({
    id,
    entries: visible.filter((entry) => entry.category === id),
  })).filter((group) => group.entries.length > 0);
  const present = new Set(entries.map((entry) => entry.category));
  const filtered = words.length > 0 || category !== 'all' || level !== 'all' || show !== 'all';

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('catalogue.title')}</h1>
        <p className="max-w-3xl text-muted-foreground">{t('catalogue.description')}</p>
      </div>

      {catalogue.isError ? (
        <ErrorPanel
          title={t('catalogue.unavailable')}
          error={toOrchestratorError(catalogue.error)}
          onRetry={() => void catalogue.refetch()}
        />
      ) : !catalogue.data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor={searchId}>{t('catalogue.search')}</Label>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id={searchId}
                  type="search"
                  className="pl-8"
                  placeholder={t('catalogue.searchPlaceholder')}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                  }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor={categoryId} className="block">
                {t('catalogue.category')}
              </Label>
              <NativeSelect
                id={categoryId}
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value as CatalogueCategory | 'all');
                }}
              >
                <option value="all">{t('catalogue.allCategories')}</option>
                {CATALOGUE_CATEGORIES.filter((id) => present.has(id)).map((id) => (
                  <option key={id} value={id}>
                    {t(`catalogue.categories.${id}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor={levelId} className="block">
                {t('catalogue.level')}
              </Label>
              <NativeSelect
                id={levelId}
                value={level}
                onChange={(event) => {
                  setLevel(event.target.value as SupportLevel | 'all');
                }}
              >
                <option value="all">{t('catalogue.allLevels')}</option>
                {SUPPORT_LEVELS.map((id) => (
                  <option key={id} value={id}>
                    {t(`catalogue.levels.${id}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor={showId} className="block">
                {t('catalogue.show')}
              </Label>
              <NativeSelect
                id={showId}
                value={show}
                onChange={(event) => {
                  setShow(event.target.value as Show);
                }}
              >
                <option value="all">{t('catalogue.showAll')}</option>
                <option value="available">{t('catalogue.showAvailable')}</option>
                <option value="native">{t('catalogue.showNative')}</option>
              </NativeSelect>
            </div>
          </div>

          <p role="status" className="text-sm text-muted-foreground">
            {t('catalogue.counts', {
              count: visible.length,
              available: visible.filter((entry) => entry.integration.level !== null).length,
            })}
          </p>

          {groups.length === 0 ? (
            <div className="space-y-2 rounded-lg border bg-card p-6 text-center">
              <p className="font-medium">{t('catalogue.noResults')}</p>
              <p className="text-muted-foreground">{t('catalogue.noResultsHint')}</p>
              {filtered && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setText('');
                    setCategory('all');
                    setLevel('all');
                    setShow('all');
                  }}
                >
                  {t('catalogue.clearFilters')}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map((group) => (
                <section key={group.id} aria-labelledby={`category-${group.id}`} className="space-y-3">
                  <h2
                    id={`category-${group.id}`}
                    className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t(`catalogue.categories.${group.id}`)}
                  </h2>
                  <ul className="divide-y rounded-lg border bg-card px-4 py-3">
                    {group.entries.map((entry) => (
                      <EntryRow key={entry.id} entry={entry} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
