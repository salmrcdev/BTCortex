import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown, parseMarkdown } from '@/components/data/markdown';
import type { Block, LinkTarget } from '@/components/data/markdown';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Input } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { toOrchestratorError } from '@/lib/orchestrator';
import { cn } from '@/lib/utils';
import { DOCUMENT_GROUPS, DOCUMENTS, isDocumentId, loadDocument } from './documents';
import type { DocumentId } from './documents';

// Help & documentation (specification sections 24.1 and 33): the documents
// shipped with BTCortex, searchable, with links between them kept inside the
// window and sections that the F1 key and other pages can open directly.

export interface HelpSearch {
  doc?: DocumentId;
  section?: string;
}

const MAX_RESULTS = 40;

interface SearchResult {
  document: DocumentId;
  section: string;
  heading: string;
  snippet: string;
}

function blockText(block: Block): string[] {
  switch (block.kind) {
    case 'paragraph':
    case 'quote':
    case 'code':
      return [block.text];
    case 'list': {
      const flatten = (items: typeof block.items): string[] =>
        items.flatMap((item) => [item.text, ...flatten(item.children)]);
      return flatten(block.items);
    }
    case 'table':
      return block.rows.map((row) => row.join(' · '));
    default:
      return [];
  }
}

/** Plain text for snippets: inline Markdown marks removed. */
function plain(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*_]/g, '');
}

export function searchDocuments(sources: ReadonlyMap<DocumentId, string>, query: string): SearchResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const results: SearchResult[] = [];
  for (const [document, source] of sources) {
    let heading = '';
    let section = '';
    for (const block of parseMarkdown(source)) {
      if (block.kind === 'heading') {
        heading = plain(block.text);
        section = block.level === 1 ? '' : block.id;
        if (words.every((word) => heading.toLowerCase().includes(word))) {
          results.push({ document, section, heading, snippet: '' });
        }
        continue;
      }
      for (const text of blockText(block)) {
        const flat = plain(text);
        const lower = flat.toLowerCase();
        if (!words.every((word) => lower.includes(word))) continue;
        const at = Math.max(0, lower.indexOf(words[0] ?? '') - 60);
        results.push({
          document,
          section,
          heading,
          snippet: `${at > 0 ? '…' : ''}${flat.slice(at, at + 180)}${flat.length > at + 180 ? '…' : ''}`,
        });
        break;
      }
      if (results.length >= MAX_RESULTS) return results;
    }
  }
  return results;
}

function useDocument(id: DocumentId) {
  return useQuery({ queryKey: ['help', 'document', id], queryFn: () => loadDocument(id), staleTime: Infinity });
}

function useAllDocuments(enabled: boolean) {
  return useQuery({
    queryKey: ['help', 'all'],
    queryFn: async () =>
      new Map<DocumentId, string>(
        await Promise.all(DOCUMENTS.map(async ({ id }) => [id, await loadDocument(id)] as const)),
      ),
    enabled,
    staleTime: Infinity,
  });
}

function SearchResults({ query }: { query: string }) {
  const { t } = useTranslation();
  const all = useAllDocuments(true);
  const results = useMemo(() => (all.data ? searchDocuments(all.data, query) : []), [all.data, query]);
  if (!all.data) return <Skeleton className="h-40" />;
  if (results.length === 0) {
    return (
      <div role="status" className="space-y-1">
        <p className="font-medium">{t('help.noResults', { query })}</p>
        <p className="text-muted-foreground">{t('help.noResultsHint')}</p>
      </div>
    );
  }
  return (
    <section aria-label={t('help.results')} className="space-y-2">
      <p role="status" className="text-muted-foreground">
        {t('help.resultCount', { count: results.length })}
      </p>
      <ul className="space-y-2">
        {results.map((result, index) => (
          <li key={`${result.document}-${result.section}-${String(index)}`}>
            <Link
              to="/help"
              search={{ doc: result.document, ...(result.section ? { section: result.section } : {}) }}
              className="block rounded-lg border p-3 transition-colors duration-150 hover:bg-muted"
            >
              <span className="block font-medium">
                {t(`help.documents.${result.document}`)}
                {result.heading && ` › ${result.heading}`}
              </span>
              {result.snippet && <span className="mt-0.5 block text-muted-foreground">{result.snippet}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Article({ id, section }: { id: DocumentId; section: string | undefined }) {
  const { t } = useTranslation();
  const source = useDocument(id);
  const blocks = useMemo(() => (source.data ? parseMarkdown(source.data) : []), [source.data]);
  const outline = blocks.filter((block) => block.kind === 'heading' && block.level === 2);

  // Opening a section scrolls to it once the document is shown.
  useEffect(() => {
    if (blocks.length === 0) return;
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' });
    else document.getElementById('main')?.scrollTo({ top: 0 });
  }, [blocks, section]);

  const onLink = (target: LinkTarget, label: ReactNode, key: string): ReactNode | undefined => {
    const doc = target.document ?? id;
    if (!isDocumentId(doc)) return undefined;
    return (
      <Link
        key={key}
        to="/help"
        search={{ doc, ...(target.section ? { section: target.section } : {}) }}
        className="text-primary underline-offset-4 hover:underline"
      >
        {label}
      </Link>
    );
  };

  if (source.isError) {
    return <ErrorPanel title={t('help.failed')} error={toOrchestratorError(source.error)} />;
  }
  if (!source.data) return <Skeleton className="h-96" />;
  return (
    <article className="min-w-0 space-y-6">
      {outline.length > 2 && (
        <nav aria-label={t('help.onThisPage')} className="rounded-lg border p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('help.onThisPage')}
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {outline.map((heading) =>
              heading.kind === 'heading' ? (
                <li key={heading.id}>
                  <Link
                    to="/help"
                    search={{ doc: id, section: heading.id }}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {plain(heading.text)}
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        </nav>
      )}
      <Markdown blocks={blocks} onLink={onLink} />
    </article>
  );
}

export function HelpPage({ search }: { search: HelpSearch }) {
  const { t } = useTranslation();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const current = search.doc ?? 'USER_GUIDE';
  const searching = query.trim().length >= 2;
  return (
    <div className="mx-auto flex max-w-7xl gap-8 p-6">
      <aside className="sticky top-6 max-h-[calc(100vh-7rem)] w-64 shrink-0 space-y-4 self-start overflow-y-auto pr-1">
        <div className="space-y-1">
          <h1 className="font-mono text-xl font-semibold">{t('help.title')}</h1>
          <p className="text-muted-foreground">{t('help.description')}</p>
        </div>
        <div className="relative" role="search">
          <Search aria-hidden="true" className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <label htmlFor={searchId} className="sr-only">
            {t('help.search')}
          </label>
          <Input
            id={searchId}
            type="search"
            className="pl-8"
            placeholder={t('help.searchPlaceholder')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <nav aria-label={t('help.documentsLabel')} className="space-y-4">
          {DOCUMENT_GROUPS.map((group) => (
            <div key={group}>
              <p className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(`help.groups.${group}`)}
              </p>
              <ul className="space-y-0.5">
                {DOCUMENTS.filter((entry) => entry.group === group).map((entry) => (
                  <li key={entry.id}>
                    <Link
                      to="/help"
                      search={{ doc: entry.id }}
                      onClick={() => {
                        setQuery('');
                      }}
                      aria-current={!searching && entry.id === current ? 'page' : undefined}
                      className={cn(
                        'block rounded-md px-2 py-1 text-sm transition-colors duration-150 hover:bg-muted',
                        !searching && entry.id === current ? 'bg-muted font-medium' : 'text-muted-foreground',
                      )}
                    >
                      {t(`help.documents.${entry.id}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        {searching ? <SearchResults query={query.trim()} /> : <Article id={current} section={search.section} />}
      </div>
    </div>
  );
}
