import type { LogSeverity } from '@btcortex/contracts';
import { redact, redactString } from '@btcortex/core';
import { parseFulcrumLogLine } from '@btcortex/integration-fulcrum';

// Turns one line of each log format into a structured entry (specification
// section 20). Every message and context is redacted here, so nothing read
// from a log file leaves the orchestrator unredacted.

export interface ParsedLine {
  /** ISO time, when the line carries one. */
  time: string | undefined;
  severity: LogSeverity;
  component?: string;
  message: string;
  context?: Record<string, unknown>;
  /** A line without its own time that belongs to the entry before it. */
  continuation: boolean;
}

/** Returns `undefined` for lines that should not be shown at all. */
export type LineParser = (line: string) => ParsedLine | undefined;

function plain(line: string, continuation: boolean): ParsedLine {
  return { time: undefined, severity: 'info', message: redactString(line), continuation };
}

function isoTime(text: string): string | undefined {
  const time = Date.parse(text);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

const APPLICATION_LEVELS: Record<string, LogSeverity> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
  debug: 'debug',
};

/** The orchestrator's own log: one JSON object per line. */
export const parseApplicationLine: LineParser = (line) => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return plain(line, false);
  }
  if (typeof value !== 'object' || value === null) return plain(line, false);
  const entry = value as Record<string, unknown>;
  const time = typeof entry['time'] === 'string' ? isoTime(entry['time']) : undefined;
  const context = entry['context'];
  return {
    time,
    severity: APPLICATION_LEVELS[String(entry['level'])] ?? 'info',
    ...(typeof entry['component'] === 'string' ? { component: entry['component'] } : {}),
    message: redactString(typeof entry['message'] === 'string' ? entry['message'] : line),
    ...(typeof context === 'object' && context !== null && !Array.isArray(context)
      ? { context: redact(context) as Record<string, unknown> }
      : {}),
    continuation: false,
  };
};

const SHELL_LINE = /^\[(\d{4}-\d{2}-\d{2})\]\[(\d{2}:\d{2}:\d{2})\]\[([^\]]*)\]\[([A-Z]+)\]\s?(.*)$/;
const SHELL_LEVELS: Record<string, LogSeverity> = {
  ERROR: 'error',
  WARN: 'warning',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'debug',
};

/** The native shell's log, written by tauri-plugin-log in UTC: [date][time][target][LEVEL] message. */
export const parseShellLine: LineParser = (line) => {
  const match = SHELL_LINE.exec(line);
  if (!match) return plain(line, true);
  const [, date = '', time = '', target = '', level = '', message = ''] = match;
  // The orchestrator's output relayed by the shell; it is already in the orchestrator's own log.
  if (target === 'orchestrator') return undefined;
  return {
    time: isoTime(`${date}T${time}Z`),
    severity: SHELL_LEVELS[level] ?? 'info',
    component: target,
    message: redactString(message),
    continuation: false,
  };
};

const CORE_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s(.*)$/;
const CORE_TAG = /^\[([^\]\s]+)\]\s?/;

function severityFromText(message: string): LogSeverity | undefined {
  if (/^(error|exception|fatal)\b/i.test(message)) return 'error';
  if (/^warning\b/i.test(message)) return 'warning';
  return undefined;
}

/** Bitcoin Core 31's -debug categories (src/logging.cpp). */
const CORE_DEBUG_CATEGORIES = new Set([
  'addrman',
  'bench',
  'blockstorage',
  'cmpctblock',
  'coindb',
  'estimatefee',
  'http',
  'i2p',
  'ipc',
  'kernel',
  'leveldb',
  'libevent',
  'lock',
  'mempool',
  'mempoolrej',
  'net',
  'privatebroadcast',
  'proxy',
  'prune',
  'qt',
  'rand',
  'reindex',
  'rpc',
  'scan',
  'selectcoins',
  'tor',
  'txpackages',
  'txreconciliation',
  'validation',
  'walletdb',
  'zmq',
]);

/**
 * Bitcoin Core's debug.log: "<time> [category:level] message". Unconditional
 * messages carry no category; warnings and errors are tagged [warning] and
 * [error] since 28.0, and older wording ("Error: …", "Warning: …") is
 * recognised too. Category messages only appear with -debug, so they count as
 * debug output unless their level says otherwise. Other tags (thread names
 * with -logthreadnames, source locations) do not change the severity.
 */
export const parseBitcoinCoreLine: LineParser = (line) => {
  const match = CORE_LINE.exec(line);
  if (!match) return plain(line, true);
  let rest = match[2] ?? '';
  let severity: LogSeverity | undefined;
  let component: string | undefined;
  for (let tag = CORE_TAG.exec(rest); tag; tag = CORE_TAG.exec(rest)) {
    const [category = '', level] = (tag[1] ?? '').split(':');
    if (category === 'error' || level === 'error') severity = 'error';
    else if (category === 'warning' || level === 'warning') severity = 'warning';
    if (level !== undefined || CORE_DEBUG_CATEGORIES.has(category)) {
      if (category !== 'error' && category !== 'warning') component ??= category;
      severity ??= level === 'info' ? 'info' : 'debug';
    }
    rest = rest.slice(tag[0].length);
  }
  return {
    time: isoTime(match[1] ?? ''),
    severity: severityFromText(rest) ?? severity ?? 'info',
    ...(component === undefined ? {} : { component }),
    message: redactString(rest),
    continuation: false,
  };
};

/** What bitcoind printed before its own log was open: usually a single error, without a time. */
export const parseConsoleLine: LineParser = (line) => {
  if (line.trim() === '') return undefined;
  return { ...plain(line, false), severity: severityFromText(line.trim()) ?? 'info' };
};

const TOR_LINE = /^([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}:\d{2}:\d{2}\.\d{3}) \[(\w+)\] (.*)$/;
const TOR_LEVELS: Record<string, LogSeverity> = {
  err: 'error',
  warn: 'warning',
  notice: 'info',
  info: 'debug',
  debug: 'debug',
};

/**
 * Fulcrum's output with `ts_format = utc`: "[2026-10-23 03:04:02.414] <Controller> …".
 * Fulcrum marks only fatal errors in text, so other problems are recognised by their wording.
 */
export const parseFulcrumLine: LineParser = (line) => {
  const parsed = parseFulcrumLogLine(line);
  if (!parsed) return line.trim() === '' ? undefined : plain(line, true);
  return {
    time: parsed.time,
    severity: parsed.severity,
    ...(parsed.source === undefined ? {} : { component: parsed.source }),
    message: redactString(parsed.message),
    continuation: false,
  };
};

/** tor's own log: local time without the year, the severity in brackets, then the message. */
export const parseTorLine: LineParser = (line) => {
  const match = TOR_LINE.exec(line);
  if (!match) return line.trim() === '' ? undefined : plain(line, true);
  const [, month = '', day = '', time = '', level = '', message = ''] = match;
  const now = new Date();
  const local = new Date(`${month} ${day} ${String(now.getFullYear())} ${time}`);
  // A line from the end of last year, read in January.
  if (local.getTime() - now.getTime() > 86_400_000) local.setFullYear(local.getFullYear() - 1);
  return {
    time: Number.isNaN(local.getTime()) ? undefined : local.toISOString(),
    severity: TOR_LEVELS[level] ?? 'info',
    message: redactString(message),
    continuation: false,
  };
};
