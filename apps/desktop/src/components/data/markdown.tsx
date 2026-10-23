import type { ReactNode } from 'react';
import { ExternalLink } from '@/components/data/external-link';
import { cn } from '@/lib/utils';

// A small Markdown renderer for BTCortex's own documentation (specification
// section 24.1, Help & Documentation). It knows the subset the documents use —
// headings, paragraphs, nested lists, tables, fenced code, quotes, rules and
// inline code, emphasis and links — and builds React elements, never HTML, so
// nothing in a document can run in the window.

export type Block =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' };

export interface ListItem {
  text: string;
  children: ListItem[];
  ordered: boolean;
}

/** GitHub's anchor rule: lower case, punctuation removed, spaces to hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function parseList(lines: string[]): ListItem[] {
  const root: ListItem[] = [];
  const stack: { indent: number; items: ListItem[] }[] = [{ indent: -1, items: root }];
  for (const line of lines) {
    const match = LIST_ITEM.exec(line);
    if (!match) {
      // A continuation line belongs to the last item.
      const items = stack[stack.length - 1]?.items;
      const last = items?.[items.length - 1];
      if (last) last.text += ` ${line.trim()}`;
      continue;
    }
    const indent = match[1]?.length ?? 0;
    while (stack.length > 1 && (stack[stack.length - 1]?.indent ?? -1) >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (!parent) continue;
    const item: ListItem = { text: match[3] ?? '', children: [], ordered: /\d/.test(match[2] ?? '') };
    parent.items.push(item);
    stack.push({ indent, items: item.children });
  }
  return root;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  const seen = new Map<string, number>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const text = (heading[2] ?? '').trim();
      const base = slugify(text);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      blocks.push({
        kind: 'heading',
        level: heading[1]?.length ?? 1,
        text,
        id: count === 0 ? base : `${base}-${String(count)}`,
      });
      index += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? '')) {
      const header = splitRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
        rows.push(splitRow(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const body: string[] = [];
      while (index < lines.length && (lines[index] ?? '').trim() !== '') {
        body.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'list', ordered: /^\s*\d/.test(line), items: parseList(body) });
      continue;
    }
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (index < lines.length && (lines[index] ?? '').startsWith('>')) {
        body.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', text: body.join(' ') });
      continue;
    }
    const body: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() !== '' &&
      !/^(#{1,6}\s|```|>)/.test(lines[index] ?? '') &&
      !LIST_ITEM.test(lines[index] ?? '')
    ) {
      body.push((lines[index] ?? '').trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: body.join(' ') });
  }
  return blocks;
}

export interface LinkTarget {
  /** Another document of the same set, by its file name without `.md`. */
  document?: string;
  section?: string;
  external?: string;
}

/** Where a link in a document leads: another document, a section, or the web. */
export function resolveLink(href: string): LinkTarget | undefined {
  if (href.startsWith('https://')) return { external: href };
  if (href.startsWith('#')) return { section: href.slice(1) };
  const local = /^(?:\.\/)?([A-Z0-9_]+)\.md(?:#(.+))?$/.exec(href);
  if (local?.[1]) return { document: local[1], ...(local[2] ? { section: local[2] } : {}) };
  return undefined;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(_[^_\s][^_]*_)|(\*[^*\s][^*]*\*)/g;

type LinkRenderer = (target: LinkTarget, label: ReactNode, key: string) => ReactNode | undefined;

function renderInline(text: string, onLink: LinkRenderer, key = ''): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    const id = `${key}${String(start)}`;
    if (token.startsWith('`')) {
      nodes.push(
        <code key={id} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={id}>{renderInline(token.slice(2, -2), onLink, `${id}-`)}</strong>);
    } else if (token.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const label = renderInline(parts?.[1] ?? '', onLink, `${id}-`);
      const target = resolveLink(parts?.[2] ?? '');
      nodes.push(
        target?.external ? (
          <ExternalLink key={id} href={target.external}>
            {label}
          </ExternalLink>
        ) : (
          ((target ? onLink(target, label, id) : undefined) ?? <span key={id}>{label}</span>)
        ),
      );
    } else {
      nodes.push(<em key={id}>{renderInline(token.slice(1, -1), onLink, `${id}-`)}</em>);
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function List({
  items,
  ordered,
  onLink,
  depth = 0,
}: {
  items: ListItem[];
  ordered: boolean;
  onLink: LinkRenderer;
  depth?: number;
}) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={cn('space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc', depth > 0 && 'mt-1')}>
      {items.map((item, index) => (
        // Items have no identity beyond their position in a fixed document.
        <li key={`${String(depth)}-${String(index)}`}>
          {renderInline(item.text, onLink)}
          {item.children.length > 0 && (
            <List
              items={item.children}
              ordered={item.children[0]?.ordered ?? false}
              onLink={onLink}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </Tag>
  );
}

const HEADING_CLASSES: Record<number, string> = {
  1: 'font-mono text-xl font-semibold',
  2: 'mt-8 border-b pb-1 text-lg font-semibold',
  3: 'mt-6 text-base font-semibold',
  4: 'mt-4 font-semibold',
};

export interface MarkdownProps {
  blocks: readonly Block[];
  /** Renders a link to another document or a section, with this key; undefined leaves the label unlinked. */
  onLink: LinkRenderer;
}

export function Markdown({ blocks, onLink: link }: MarkdownProps) {
  return (
    <div className="space-y-3 leading-relaxed">
      {blocks.map((block, index) => {
        const key = String(index);
        switch (block.kind) {
          case 'heading': {
            const Tag = `h${String(Math.min(block.level, 4))}` as 'h1' | 'h2' | 'h3' | 'h4';
            return (
              <Tag key={key} id={block.id} className={cn('scroll-mt-4', HEADING_CLASSES[Math.min(block.level, 4)])}>
                {renderInline(block.text, link)}
              </Tag>
            );
          }
          case 'paragraph':
            return <p key={key}>{renderInline(block.text, link)}</p>;
          case 'list':
            return <List key={key} items={block.items} ordered={block.ordered} onLink={link} />;
          case 'code':
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-[13px] leading-snug"
              >
                {block.text}
              </pre>
            );
          case 'quote':
            return (
              <blockquote key={key} className="border-l-2 pl-3 text-muted-foreground">
                {renderInline(block.text, link)}
              </blockquote>
            );
          case 'rule':
            return <hr key={key} />;
          case 'table':
            return (
              <div key={key} className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {block.header.map((cell, column) => (
                        <th key={String(column)} scope="col" className="px-3 py-2 text-left align-top font-medium">
                          {renderInline(cell, link)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={String(rowIndex)} className="border-t">
                        {row.map((cell, column) => (
                          <td key={String(column)} className="px-3 py-2 align-top">
                            {renderInline(cell, link)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
