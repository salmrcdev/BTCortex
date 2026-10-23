import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConfigDiagnostic } from '@btcortex/bitcoin-config';
import { cn } from '@/lib/utils';
import { lineRange } from './config-model';
import { DiagnosticLine, severityRank } from './diagnostic-line';

// Raw bitcoin.conf editor for advanced users: plain text with line numbers and
// the same live checks as the graphical editor.

/** Matches the textarea's `leading-5`. */
const LINE_HEIGHT_PX = 20;

export interface LineRequest {
  line: number;
  /** Changes on every request, so asking for the same line twice still works. */
  nonce: number;
}

export interface RawEditorProps {
  text: string;
  readOnly: boolean;
  diagnostics: ConfigDiagnostic[];
  lineRequest: LineRequest | undefined;
  /** Called once a line request has been shown, so that opening the tab again does not repeat it. */
  onLineShown: () => void;
  onChange: (text: string) => void;
  onShowLine: (line: number) => void;
}

const GUTTER_TONES = { error: 'font-semibold text-danger', warning: 'font-semibold text-warning', information: '' };

export function RawEditor({
  text,
  readOnly,
  diagnostics,
  lineRequest,
  onLineShown,
  onChange,
  onShowLine,
}: RawEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const lineCount = text.split('\n').length;
  const sorted = [...diagnostics].sort((a, b) => severityRank(a) - severityRank(b) || (a.line ?? 0) - (b.line ?? 0));
  const worstByLine = new Map<number, ConfigDiagnostic['severity']>();
  for (const diagnostic of [...sorted].reverse()) {
    if (diagnostic.line !== undefined) worstByLine.set(diagnostic.line, diagnostic.severity);
  }

  useEffect(() => {
    const element = textarea.current;
    if (!lineRequest || !element) return;
    const { start, end } = lineRange(element.value, lineRequest.line);
    element.focus();
    element.setSelectionRange(start, end);
    element.scrollTop = Math.max(0, (lineRequest.line - 4) * LINE_HEIGHT_PX);
    onLineShown();
  }, [lineRequest, onLineShown]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {t('config.editorLabel')}
        </label>
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {t('config.editorHelp')}
        </p>
        <div className="flex overflow-hidden rounded-md border border-input bg-background">
          <div
            aria-hidden="true"
            className="w-12 shrink-0 select-none overflow-hidden border-r bg-muted py-2 text-right font-mono text-[13px] text-muted-foreground"
          >
            <div style={{ transform: `translateY(-${String(scrollTop)}px)` }}>
              {Array.from({ length: lineCount }, (_, index) => {
                const severity = worstByLine.get(index + 1);
                return (
                  <div key={index} className={cn('h-5 pr-2 leading-5', severity && GUTTER_TONES[severity])}>
                    {index + 1}
                  </div>
                );
              })}
            </div>
          </div>
          <textarea
            ref={textarea}
            id={id}
            aria-describedby={`${id}-help ${id}-checks`}
            value={text}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            className="h-[28rem] min-w-0 flex-1 resize-y whitespace-pre bg-transparent px-3 py-2 font-mono text-[13px] leading-5 focus-visible:outline-offset-[-2px]"
            onChange={(event) => {
              onChange(event.target.value);
            }}
            onScroll={(event) => {
              setScrollTop(event.currentTarget.scrollTop);
            }}
          />
        </div>
      </div>

      <section id={`${id}-checks`} aria-label={t('config.problems')} className="space-y-2">
        <h3 className="text-sm font-medium">{t('config.problems')}</h3>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('config.noProblems')}</p>
        ) : (
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {sorted.map((diagnostic, index) => {
              const { line } = diagnostic;
              return (
                <li key={`${diagnostic.code}-${String(line)}-${String(index)}`}>
                  <DiagnosticLine
                    diagnostic={diagnostic}
                    location={
                      line === undefined ? (
                        t('config.wholeFile')
                      ) : (
                        <button
                          type="button"
                          className="cursor-pointer underline underline-offset-2 hover:text-foreground"
                          aria-label={t('config.showLine', { line })}
                          onClick={() => {
                            onShowLine(line);
                          }}
                        >
                          {t('config.line', { line })}
                        </button>
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
