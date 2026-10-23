import type { ConfigSection } from './networks';
import { isConfigSection } from './networks';

// Lossless model of bitcoin.conf. Untouched lines are written back byte for
// byte, so comments, ordering, blank lines and options BTCortex does not know
// survive every edit (specification section 5.6).
//
// Parsing follows Bitcoin Core's GetConfigOptions (src/common/config.cpp) and
// InterpretKey (src/common/args.cpp) exactly, because any difference would let
// an edit look harmless here while Bitcoin Core reads it otherwise:
// - everything after `#` is a comment; only space, tab, CR and LF are trimmed;
// - `[name]` opens a section, with the name taken verbatim (`[ regtest ]` is
//   an unknown section, not regtest);
// - `key=value` becomes the option `<section>.key`, and the section is
//   whatever comes before the first dot: `regtest.rpcport` in the global
//   scope belongs to regtest, `.rpcuser` to the global scope, and a prefixed
//   key inside a section is an unknown option that Bitcoin Core ignores;
// - any other non-empty line is a parse error.

export type ConfigLine =
  | { kind: 'blank'; raw: string }
  | { kind: 'comment'; raw: string }
  | { kind: 'section'; raw: string; name: string }
  | {
      kind: 'setting';
      raw: string;
      /** Option name without section prefix, for example `prune`. */
      key: string;
      value: string;
      /** Scope from a `[section]` header or a `section.` prefix; `null` is the global scope. */
      scope: string | null;
      /** True when the scope came from a `section.key=` prefix. */
      prefixed: boolean;
      /** Text after `#`, if any. */
      comment: string | undefined;
    }
  | { kind: 'invalid'; raw: string; reason: string };

export interface ParseIssue {
  line: number;
  message: string;
}

export type SettingLine = Extract<ConfigLine, { kind: 'setting' }>;

/** Bitcoin Core trims these characters only (TrimString with " \t\r\n"). */
export function trimLikeBitcoinCore(text: string): string {
  return text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
}

function parseLine(raw: string, section: string | null): ConfigLine {
  const hash = raw.indexOf('#');
  const content = trimLikeBitcoinCore(hash === -1 ? raw : raw.slice(0, hash));
  const comment = hash === -1 ? undefined : raw.slice(hash + 1);

  if (content === '') return trimLikeBitcoinCore(raw) === '' ? { kind: 'blank', raw } : { kind: 'comment', raw };

  if (content.startsWith('[') && content.endsWith(']')) {
    return { kind: 'section', raw, name: content.slice(1, -1) };
  }
  if (content.startsWith('-')) {
    return {
      kind: 'invalid',
      raw,
      reason: `Options in the configuration file are written without a leading hyphen: "${content}".`,
    };
  }

  const equals = content.indexOf('=');
  if (equals === -1) {
    return {
      kind: 'invalid',
      raw,
      reason: `"${content}" is not an option assignment. To negate an option, write no${content}=1.`,
    };
  }

  const written = trimLikeBitcoinCore(content.slice(0, equals));
  const value = trimLikeBitcoinCore(content.slice(equals + 1));
  if (written === '') return { kind: 'invalid', raw, reason: 'The option name is missing before "=".' };

  const name = section === null ? written : `${section}.${written}`;
  if (hash !== -1 && name.includes('rpcpassword')) {
    return {
      kind: 'invalid',
      raw,
      reason: 'Bitcoin Core refuses "#" in rpcpassword because it starts a comment. Choose a password without "#".',
    };
  }

  // InterpretKey: the section is everything before the first dot; an empty one is the global scope.
  const dot = name.indexOf('.');
  const scope = dot === -1 ? null : name.slice(0, dot) || null;
  const key = dot === -1 ? name : name.slice(dot + 1);
  return { kind: 'setting', raw, key, value, scope, prefixed: section === null && dot !== -1, comment };
}

export interface ScopeQuery {
  /** `null` for the global scope. */
  scope: ConfigSection | null;
}

export class BitcoinConfig {
  private constructor(
    private lines: ConfigLine[],
    private readonly newline: '\n' | '\r\n',
    private readonly trailingNewline: boolean,
  ) {}

  static parse(text: string): BitcoinConfig {
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const trailingNewline = text === '' || text.endsWith('\n');
    const rawLines = text.split(/\r?\n/);
    if (trailingNewline && rawLines.at(-1) === '') rawLines.pop();

    const lines: ConfigLine[] = [];
    let section: string | null = null;
    for (const raw of rawLines) {
      const line = parseLine(raw, section);
      if (line.kind === 'section') section = line.name;
      lines.push(line);
    }
    return new BitcoinConfig(lines, newline, trailingNewline);
  }

  static empty(): BitcoinConfig {
    return BitcoinConfig.parse('');
  }

  get allLines(): readonly ConfigLine[] {
    return this.lines;
  }

  settings(): SettingLine[] {
    return this.lines.filter((line): line is SettingLine => line.kind === 'setting');
  }

  issues(): ParseIssue[] {
    const issues: ParseIssue[] = [];
    this.lines.forEach((line, index) => {
      if (line.kind === 'invalid') issues.push({ line: index + 1, message: line.reason });
      if (line.kind === 'section' && !isConfigSection(line.name)) {
        issues.push({
          line: index + 1,
          message: `Unknown section [${line.name}]. Bitcoin Core accepts [main], [test], [testnet4], [signet] and [regtest].`,
        });
      }
      if (line.kind === 'setting' && line.prefixed && line.scope !== null && !isConfigSection(line.scope)) {
        issues.push({ line: index + 1, message: `Unknown network prefix "${line.scope}." on ${line.key}.` });
      }
      if (line.kind === 'setting' && line.key.includes('.')) {
        // Inside [regtest], "regtest.rpcport" becomes "regtest.regtest.rpcport", which Bitcoin Core ignores.
        issues.push({
          line: index + 1,
          message: `Inside [${line.scope ?? ''}], "${line.key}" is read as an unknown option and ignored. Write it without a prefix inside a section.`,
        });
      }
    });
    return issues;
  }

  /** Every value assigned to `key` in the given scope, in file order. */
  valuesIn(key: string, { scope }: ScopeQuery): string[] {
    return this.settings()
      .filter((line) => line.key === key && line.scope === scope)
      .map((line) => line.value);
  }

  /** Replaces the first assignment in the scope (removing duplicates) or appends one. */
  set(key: string, value: string, { scope }: ScopeQuery): void {
    const raw = `${key}=${value}`;
    const index = this.lines.findIndex((line) => line.kind === 'setting' && line.key === key && line.scope === scope);
    if (index !== -1) {
      const existing = this.lines[index] as SettingLine;
      const prefix = existing.prefixed && scope !== null ? `${scope}.` : '';
      const comment = existing.comment === undefined ? '' : ` #${existing.comment}`;
      this.lines[index] = { ...existing, raw: `${prefix}${raw}${comment}`, value };
      // Bitcoin Core uses the first value; later duplicates would only confuse readers.
      this.lines = this.lines.filter(
        (line, position) => position <= index || !(line.kind === 'setting' && line.key === key && line.scope === scope),
      );
      return;
    }
    this.insert({ kind: 'setting', raw, key, value, scope, prefixed: false, comment: undefined }, scope);
  }

  /**
   * Replaces the values of a list option in the scope, in place: a line whose
   * value stays keeps its comment and its position, only the lines of removed
   * values go, and new values follow the option's last remaining line.
   */
  setList(key: string, values: readonly string[], { scope }: ScopeQuery): void {
    const matches = (line: ConfigLine) => line.kind === 'setting' && line.key === key && line.scope === scope;
    const wanted = [...values];
    this.lines = this.lines.filter((line) => {
      if (line.kind !== 'setting' || !matches(line)) return true;
      const index = wanted.indexOf(line.value);
      if (index === -1) return false;
      wanted.splice(index, 1);
      return true;
    });
    for (const value of wanted) {
      const anchor = this.lines.findLastIndex(matches);
      const previous = this.lines[anchor];
      // Next to a prefixed line ("regtest.addnode=…" in the global part) the new one needs the prefix too.
      const prefixed = previous?.kind === 'setting' && previous.prefixed && scope !== null;
      const line: SettingLine = {
        kind: 'setting',
        raw: `${prefixed ? `${scope}.` : ''}${key}=${value}`,
        key,
        value,
        scope,
        prefixed,
        comment: undefined,
      };
      if (anchor === -1) this.insert(line, scope);
      else this.lines.splice(anchor + 1, 0, line);
    }
  }

  unset(key: string, { scope }: ScopeQuery): boolean {
    const before = this.lines.length;
    this.lines = this.lines.filter((line) => !(line.kind === 'setting' && line.key === key && line.scope === scope));
    return this.lines.length !== before;
  }

  /**
   * A copy in which `replace` may rewrite whole lines (return `undefined` to
   * keep one). The result is parsed again, so a rewritten line may change kind.
   */
  mapLines(replace: (line: ConfigLine, lineNumber: number) => string | undefined): BitcoinConfig {
    const raws = this.lines.map((line, index) => replace(line, index + 1) ?? line.raw);
    const body = raws.join(this.newline);
    return BitcoinConfig.parse(raws.length > 0 && this.trailingNewline ? `${body}${this.newline}` : body);
  }

  /** Adds a comment line at the start of the file (used for the BTCortex management header). */
  prependComment(text: string): void {
    const raw = `# ${text}`;
    if (this.lines.some((line) => line.kind === 'comment' && line.raw === raw)) return;
    this.lines.unshift({ kind: 'comment', raw });
  }

  toString(): string {
    const body = this.lines.map((line) => line.raw).join(this.newline);
    return this.lines.length > 0 && this.trailingNewline ? `${body}${this.newline}` : body;
  }

  private insert(line: SettingLine, scope: ConfigSection | null): void {
    if (scope === null) {
      // The global scope ends at the first section header.
      const firstSection = this.lines.findIndex((candidate) => candidate.kind === 'section');
      const end = firstSection === -1 ? this.lines.length : firstSection;
      let position = end;
      while (position > 0 && this.lines[position - 1]?.kind === 'blank') position -= 1;
      this.lines.splice(position, 0, line);
      return;
    }

    const header = this.lines.findIndex((candidate) => candidate.kind === 'section' && candidate.name === scope);
    if (header === -1) {
      if (this.lines.length > 0 && this.lines.at(-1)?.kind !== 'blank') this.lines.push({ kind: 'blank', raw: '' });
      this.lines.push({ kind: 'section', raw: `[${scope}]`, name: scope }, line);
      return;
    }
    let end = header + 1;
    while (end < this.lines.length && this.lines[end]?.kind !== 'section') end += 1;
    let position = end;
    while (position > header + 1 && this.lines[position - 1]?.kind === 'blank') position -= 1;
    this.lines.splice(position, 0, line);
  }
}
