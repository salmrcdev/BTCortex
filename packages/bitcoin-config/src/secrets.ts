import { lookupOption } from './options';
import type { BitcoinConfig, ConfigLine } from './parser';

// Secret values (passwords, rpcauth hashes) never leave the orchestrator. The
// editor receives numbered placeholders instead, and saving puts the original
// text back (specification section 5.6: avoid leaking secrets). Masking is
// deterministic, so the orchestrator can rebuild the placeholders from the
// file when saving.
//
// Masking is deliberately wide: besides settings it covers lines Bitcoin Core
// would reject (a password containing "#", a leading hyphen) and comments that
// mention a secret option, from the option name to the end of the line.
// Restoring is deliberately narrow: a placeholder is put back only where
// masking itself would have put it, for the same option, so that an edit can
// never move a secret into a comment, an option name or another option.

const PLACEHOLDERS = /\[hidden value (\d+)\]/g;
/** Option-like words in a comment or malformed line; keys may contain "_", "-" and ".". */
const WORDS = /[A-Za-z0-9_.-]+/g;
/** What may separate an option name from its value in such lines. */
const SEPARATOR = /^[ \t]*=?[ \t]*/;

export function secretPlaceholder(id: number): string {
  return `[hidden value ${String(id)}]`;
}

export function containsSecretPlaceholder(value: string): boolean {
  return new RegExp(PLACEHOLDERS.source).test(value);
}

export function isSecretOption(key: string): boolean {
  const known = lookupOption(key);
  if (known) return !known.negated && known.definition.sensitive === true;
  return /pass(word|phrase)|secret/i.test(key);
}

/** An option name as Bitcoin Core would read it from a word: no leading "-" or ".", no section prefix. */
function optionName(word: string): string {
  const bare = word.replace(/^[-.]+/, '');
  const dot = bare.indexOf('.');
  return dot === -1 ? bare : bare.slice(dot + 1);
}

export interface HiddenSecret {
  key: string;
  value: string;
}

export interface MaskedConfig {
  config: BitcoinConfig;
  /** The hidden text by placeholder number; it stays in the orchestrator. */
  hidden: ReadonlyMap<number, HiddenSecret>;
}

interface SecretSpan {
  key: string;
  start: number;
  end: number;
}

/** The first secret option mentioned in `raw` from `from` on, and everything after it. */
function mentionedSecret(raw: string, from: number): SecretSpan | undefined {
  for (const word of raw.slice(from).matchAll(WORDS)) {
    const key = optionName(word[0]);
    if (key === '' || !isSecretOption(key)) continue;
    const after = from + word.index + word[0].length;
    const start = after + (SEPARATOR.exec(raw.slice(after))?.[0].length ?? 0);
    return start < raw.length ? { key, start, end: raw.length } : undefined;
  }
  return undefined;
}

/** Where the secret part of a line is, if the line holds one: always up to the end of the line. */
function secretSpan(line: ConfigLine): SecretSpan | undefined {
  if (line.kind === 'setting') {
    if (!isSecretOption(line.key)) {
      // A trailing comment can still hold an old credential: "server=1 # rpcpassword=…".
      const hash = line.raw.indexOf('#');
      return hash === -1 ? undefined : mentionedSecret(line.raw, hash + 1);
    }
    const valueStart = line.raw.indexOf(line.value, line.raw.indexOf('=') + 1);
    // In rpcauth=<user>:<salt>$<hash> the user name may stay visible; it tells entries apart.
    const colon = line.key === 'rpcauth' ? line.value.indexOf(':') : -1;
    const start = colon > 0 ? valueStart + colon + 1 : valueStart;
    return start < line.raw.length ? { key: line.key, start, end: line.raw.length } : undefined;
  }
  if (line.kind !== 'comment' && line.kind !== 'invalid') return undefined;
  return mentionedSecret(line.raw, 0);
}

export function maskSecrets(config: BitcoinConfig): MaskedConfig {
  const hidden = new Map<number, HiddenSecret>();
  const masked = config.mapLines((line) => {
    const span = secretSpan(line);
    if (!span) return undefined;
    const id = hidden.size + 1;
    hidden.set(id, { key: span.key, value: line.raw.slice(span.start, span.end) });
    return `${line.raw.slice(0, span.start)}${secretPlaceholder(id)}`;
  });
  return { config: masked, hidden };
}

export interface RestoredConfig {
  config: BitcoinConfig;
  /** Lines with a placeholder that is not exactly where masking would put one, for the same option. */
  unresolvedLines: number[];
  /** Lines that hold a secret again; messages about them must not be shown as they are. */
  restoredLines: number[];
}

export function restoreSecrets(edited: BitcoinConfig, hidden: ReadonlyMap<number, HiddenSecret>): RestoredConfig {
  const unresolved = new Set<number>();
  const candidates = new Map<number, SecretSpan>();
  const restored = edited.mapLines((line, lineNumber) => {
    const placeholders = [...line.raw.matchAll(PLACEHOLDERS)];
    const [placeholder] = placeholders;
    if (placeholder === undefined) return undefined;
    const span = secretSpan(line);
    const secret = hidden.get(Number(placeholder[1]));
    // Exactly one placeholder, covering the whole secret part of the line, for the option it was taken from.
    if (
      placeholders.length !== 1 ||
      span === undefined ||
      secret?.key !== span.key ||
      line.raw.slice(span.start, span.end) !== placeholder[0]
    ) {
      unresolved.add(lineNumber);
      return undefined;
    }
    candidates.set(lineNumber, span);
    return `${line.raw.slice(0, span.start)}${secret.value}`;
  });

  // A restored secret must be one that masking hides again, in the same place and for the same
  // option. A placeholder glued to an option name in a comment ("#torpassword[hidden value 2]")
  // would otherwise come back as "#torpasswordhunter2", which no longer reads as that option, so
  // the next reading would show it in clear.
  for (const [lineNumber, span] of candidates) {
    const line = restored.allLines[lineNumber - 1];
    const again = line && secretSpan(line);
    if (again?.key !== span.key || again.start !== span.start) {
      unresolved.add(lineNumber);
      candidates.delete(lineNumber);
    }
  }
  // Lines that failed keep the text as it was submitted, placeholder included.
  const config =
    unresolved.size === 0
      ? restored
      : restored.mapLines((_, lineNumber) =>
          unresolved.has(lineNumber) ? edited.allLines[lineNumber - 1]?.raw : undefined,
        );
  return {
    config,
    unresolvedLines: [...unresolved].sort((a, b) => a - b),
    restoredLines: [...candidates.keys()].sort((a, b) => a - b),
  };
}
