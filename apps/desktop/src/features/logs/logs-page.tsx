import {
  Bug,
  CircleX,
  ClipboardCopy,
  FolderOpen,
  Info,
  Package,
  Pause,
  Play,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useDeferredValue, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { LogEntry, LogSeverity, LogSource } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, NativeSelect } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatLogTime, formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { cn } from '@/lib/utils';
import { useCreateBundle, useLogEntries, useLogSources, useRevealBundle } from './queries';

// Logs & diagnostics (specification section 20): every log BTCortex knows in
// one place, filtered by source, severity, time and text, live or paused,
// plus a sanitised diagnostic bundle for sharing.

const PERIODS = [
  { id: '15m', ms: 15 * 60_000 },
  { id: '1h', ms: 60 * 60_000 },
  { id: '24h', ms: 24 * 60 * 60_000 },
  { id: '7d', ms: 7 * 24 * 60 * 60_000 },
  { id: 'all', ms: undefined },
] as const;
type PeriodId = (typeof PERIODS)[number]['id'];

const SEVERITIES: readonly LogSeverity[] = ['error', 'warning', 'info', 'debug'];
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

const SEVERITY_STYLE: Record<LogSeverity, { icon: LucideIcon; tone: string }> = {
  error: { icon: CircleX, tone: 'text-danger' },
  warning: { icon: TriangleAlert, tone: 'text-warning' },
  info: { icon: Info, tone: 'text-info' },
  debug: { icon: Bug, tone: 'text-muted-foreground' },
};

function useSourceLabel() {
  const { t } = useTranslation();
  return (source: LogSource | undefined): string => {
    if (!source) return '—';
    const name = source.nodeName ?? source.nodeId ?? '';
    switch (source.kind) {
      case 'application':
        return t('logs.sources.application');
      case 'shell':
        return t('logs.sources.shell');
      case 'bitcoin-core':
        return t('logs.sources.node', { name });
      case 'bitcoin-core-console':
        return t('logs.sources.nodeConsole', { name });
      case 'tor':
        return t('logs.sources.tor');
      case 'fulcrum':
        return t('logs.sources.fulcrum', { name });
    }
  };
}

function SeverityLabel({ severity }: { severity: LogSeverity }) {
  const { t } = useTranslation();
  const { icon: Icon, tone } = SEVERITY_STYLE[severity];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden="true" className={cn('size-4 shrink-0', tone)} />
      {t(`logs.severity.${severity}`)}
    </span>
  );
}

function LogRow({ entry, source }: { entry: LogEntry; source: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const hasContext = entry.context !== undefined && Object.keys(entry.context).length > 0;
  return (
    <>
      <TableRow className="align-top">
        <TableCell className="tabular py-1.5 align-top" title={formatTimestamp(entry.time)}>
          {entry.timeEstimated && <span title={t('logs.timeEstimated')}>≈ </span>}
          {formatLogTime(entry.time)}
        </TableCell>
        <TableCell className="py-1.5 align-top">
          <SeverityLabel severity={entry.severity} />
        </TableCell>
        <TableCell className="py-1.5 align-top">{source}</TableCell>
        <TableCell className="max-w-48 truncate py-1.5 align-top font-mono text-[13px]" title={entry.component}>
          {entry.component ?? '—'}
        </TableCell>
        <TableCell className="min-w-96 whitespace-pre-wrap break-words py-1.5 align-top font-mono text-[13px]">
          {entry.message}
          {hasContext && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={detailsId}
              className="ml-2 cursor-pointer font-sans text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                setExpanded(!expanded);
              }}
            >
              {expanded ? t('logs.hideDetails') : t('logs.showDetails')}
            </button>
          )}
        </TableCell>
      </TableRow>
      {hasContext && expanded && (
        <TableRow id={detailsId} className="hover:bg-transparent">
          <TableCell colSpan={5} className="whitespace-pre-wrap bg-muted/40 py-2 font-mono text-[13px]">
            {JSON.stringify(entry.context, null, 2)}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function DiagnosticsCard() {
  const { t } = useTranslation();
  const create = useCreateBundle();
  const reveal = useRevealBundle();
  const bundle = create.data;
  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>{t('logs.bundleTitle')}</CardTitle>
          <CardDescription className="max-w-3xl">{t('logs.bundleDescription')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          disabled={create.isPending}
          onClick={() => {
            create.mutate(undefined, {
              onSuccess: () => toast.success(t('logs.bundleCreated')),
            });
          }}
        >
          <Package aria-hidden="true" />
          {create.isPending ? t('logs.bundleCreating') : t('logs.bundleCreate')}
        </Button>
        {create.isError && <ErrorPanel title={t('logs.bundleFailed')} error={toOrchestratorError(create.error)} />}
        {bundle && (
          <div role="status" className="space-y-2 rounded-md border p-3">
            <p>
              {t('logs.bundleSaved', { size: formatBytes(bundle.sizeBytes) })}{' '}
              <span className="break-all font-mono text-[13px]">{bundle.path}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={reveal.isPending}
                onClick={() => {
                  reveal.mutate(bundle.path, {
                    onError: (error) =>
                      toast.error(t('errors.actionFailed'), { description: toOrchestratorError(error).message }),
                  });
                }}
              >
                <FolderOpen aria-hidden="true" />
                {t('logs.bundleReveal')}
              </Button>
            </div>
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                {t('logs.bundleFiles', { count: bundle.files.length })}
              </summary>
              <ul className="mt-2 space-y-0.5 font-mono text-[13px]">
                {bundle.files.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LogsPage({ initialSource }: { initialSource?: string | undefined }) {
  const { t } = useTranslation();
  const ids = { search: useId(), severity: useId(), period: useId() };
  const sources = useLogSources();
  const sourceLabel = useSourceLabel();
  const [chosen, setChosen] = useState<ReadonlySet<string> | undefined>(
    initialSource === undefined ? undefined : new Set([initialSource]),
  );
  const [severity, setSeverity] = useState<LogSeverity>('info');
  const [period, setPeriod] = useState<PeriodId>('24h');
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(true);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const deferredSearch = useDeferredValue(search);

  const available = sources.data ?? [];
  // Until the user chooses, every log that exists is shown.
  const selected = chosen ?? new Set(available.filter((source) => source.exists).map((source) => source.id));
  const entries = useLogEntries(
    {
      sourceIds: available.filter((source) => selected.has(source.id)).map((source) => source.id),
      minimumSeverity: severity,
      search: deferredSearch,
      periodMs: PERIODS.find((choice) => choice.id === period)?.ms,
      limit,
    },
    live,
  );
  const byId = new Map(available.map((source) => [source.id, source]));
  const rows = entries.data?.entries ?? [];

  const toggleSource = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setChosen(next);
  };

  const copyVisible = async () => {
    const text = rows
      .map(
        (entry) =>
          `${entry.time} ${entry.severity.toUpperCase()} [${sourceLabel(byId.get(entry.sourceId))}]${entry.component ? ` ${entry.component}` : ''} ${entry.message}`,
      )
      .join('\n');
    await navigator.clipboard.writeText(text);
    toast.success(t('logs.copied', { count: rows.length }));
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('logs.title')}</h1>
        <p className="text-muted-foreground">{t('logs.description')}</p>
      </div>

      {sources.isError ? (
        <ErrorPanel
          title={t('logs.unavailable')}
          error={toOrchestratorError(sources.error)}
          onRetry={() => void sources.refetch()}
        />
      ) : !sources.data ? (
        <Skeleton className="h-40" />
      ) : (
        <section aria-labelledby={`${ids.search}-heading`} className="space-y-3">
          <h2 id={`${ids.search}-heading`} className="sr-only">
            {t('logs.entriesHeading')}
          </h2>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="mb-1 text-sm font-medium">{t('logs.sourcesLabel')}</legend>
            {available.map((source) => (
              <label
                key={source.id}
                className={cn('flex items-center gap-2', !source.exists && 'text-muted-foreground')}
              >
                <Checkbox
                  checked={selected.has(source.id)}
                  disabled={!source.exists}
                  onChange={(event) => {
                    toggleSource(source.id, event.target.checked);
                  }}
                />
                <span>
                  {sourceLabel(source)}
                  {!source.exists && ` (${t('logs.noFileYet')})`}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor={ids.severity} className="text-sm font-medium">
                {t('logs.severityLabel')}
              </label>
              <NativeSelect
                id={ids.severity}
                value={severity}
                className="block w-52"
                onChange={(event) => {
                  const value = SEVERITIES.find((choice) => choice === event.target.value);
                  if (value) setSeverity(value);
                }}
              >
                {SEVERITIES.map((choice) => (
                  <option key={choice} value={choice}>
                    {t(`logs.minimum.${choice}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={ids.period} className="text-sm font-medium">
                {t('logs.periodLabel')}
              </label>
              <NativeSelect
                id={ids.period}
                value={period}
                className="block w-44"
                onChange={(event) => {
                  const value = PERIODS.find((choice) => choice.id === event.target.value);
                  if (value) setPeriod(value.id);
                }}
              >
                {PERIODS.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {t(`logs.periods.${choice.id}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="min-w-64 flex-1 space-y-1">
              <label htmlFor={ids.search} className="text-sm font-medium">
                {t('logs.searchLabel')}
              </label>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id={ids.search}
                  type="search"
                  value={search}
                  placeholder={t('logs.searchPlaceholder')}
                  className="pl-8"
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                />
              </div>
            </div>
            <Button
              variant="outline"
              aria-pressed={live}
              onClick={() => {
                setLive(!live);
              }}
            >
              {live ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              {live ? t('logs.pauseLive') : t('logs.resumeLive')}
            </Button>
            <Button variant="outline" disabled={rows.length === 0} onClick={() => void copyVisible()}>
              <ClipboardCopy aria-hidden="true" />
              {t('logs.copyVisible')}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground" aria-live="polite">
            {live ? t('logs.liveOn') : t('logs.liveOff')} · {t('logs.shownCount', { count: rows.length })}
            {entries.data && ` · ${t('logs.window', { size: formatBytes(entries.data.windowBytes, 0) })}`}
          </p>

          {entries.isError ? (
            <ErrorPanel
              title={t('logs.unavailable')}
              error={toOrchestratorError(entries.error)}
              onRetry={() => void entries.refetch()}
            />
          ) : selected.size === 0 ? (
            <p className="py-6 text-muted-foreground">{t('logs.noSourceChosen')}</p>
          ) : !entries.data ? (
            <Skeleton className="h-64" />
          ) : rows.length === 0 ? (
            <p className="py-6 text-muted-foreground">{t('logs.empty')}</p>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>{t('logs.columns.time')}</TableHead>
                    <TableHead>{t('logs.columns.severity')}</TableHead>
                    <TableHead>{t('logs.columns.source')}</TableHead>
                    <TableHead>{t('logs.columns.component')}</TableHead>
                    <TableHead>{t('logs.columns.message')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((entry) => (
                    <LogRow key={entry.id} entry={entry} source={sourceLabel(byId.get(entry.sourceId))} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {entries.data?.limited && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-muted-foreground">{t('logs.limited', { count: limit })}</p>
              {limit < MAX_LIMIT && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setLimit(MAX_LIMIT);
                  }}
                >
                  {t('logs.showMore', { count: MAX_LIMIT })}
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <DiagnosticsCard />
    </div>
  );
}
