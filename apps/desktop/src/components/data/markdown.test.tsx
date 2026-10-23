import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown, parseMarkdown, resolveLink, slugify } from './markdown';

const SAMPLE = [
  '# Title',
  '',
  'A paragraph with `code`, **bold**, _emphasis_ and a [link](https://example.org/x).',
  'It continues here.',
  '',
  '## Tor & Privacy',
  '',
  '- First item',
  '  - Nested item',
  '- Second item with [another document](SECURITY_MODEL.md#threats-and-controls)',
  '',
  '| Name | Value |',
  '| ---- | ----- |',
  '| a \\| b | `c` |',
  '',
  '```text',
  '<script>alert(1)</script>',
  '```',
  '',
  '## Tor & Privacy',
].join('\n');

describe('Markdown', () => {
  it('reads the blocks the documentation uses', () => {
    const blocks = parseMarkdown(SAMPLE);
    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'table',
      'code',
      'heading',
    ]);
    expect(blocks[1]).toEqual({
      kind: 'paragraph',
      text: 'A paragraph with `code`, **bold**, _emphasis_ and a [link](https://example.org/x). It continues here.',
    });
    // Repeated headings get distinct anchors, as on GitHub.
    expect(blocks[2]).toMatchObject({ id: 'tor--privacy' });
    expect(blocks[6]).toMatchObject({ id: 'tor--privacy-1' });
    expect(blocks[3]).toMatchObject({
      kind: 'list',
      items: [
        { text: 'First item', children: [{ text: 'Nested item', children: [] }] },
        { text: 'Second item with [another document](SECURITY_MODEL.md#threats-and-controls)', children: [] },
      ],
    });
    expect(blocks[4]).toEqual({ kind: 'table', header: ['Name', 'Value'], rows: [['a | b', '`c`']] });
  });

  it('sorts links into documents, sections and the web', () => {
    expect(resolveLink('https://bitcoincore.org/')).toEqual({ external: 'https://bitcoincore.org/' });
    expect(resolveLink('USER_GUIDE.md')).toEqual({ document: 'USER_GUIDE' });
    expect(resolveLink('./TESTING.md#integration')).toEqual({ document: 'TESTING', section: 'integration' });
    expect(resolveLink('#monitoring')).toEqual({ section: 'monitoring' });
    expect(resolveLink('../design-system/btcortex/MASTER.md')).toBeUndefined();
    expect(resolveLink('http://example.org')).toBeUndefined();
    expect(slugify('Logs & diagnostics')).toBe('logs--diagnostics');
  });

  it('renders elements, never markup from the text', () => {
    const { container } = render(
      <Markdown
        blocks={parseMarkdown(SAMPLE)}
        onLink={(target, label, key) =>
          target.document ? (
            <a key={key} href={`#/help/${target.document}`}>
              {label}
            </a>
          ) : undefined
        }
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeDefined();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('emphasis').tagName).toBe('EM');
    expect(screen.getByRole('link', { name: 'another document' }).getAttribute('href')).toBe('#/help/SECURITY_MODEL');
    expect(screen.getByRole('link', { name: /^link/ }).getAttribute('href')).toBe('https://example.org/x');
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>').tagName).toBe('PRE');
  });
});
