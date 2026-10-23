import { open, stat } from 'node:fs/promises';
import type { LogSeverity } from '@btcortex/contracts';
import type { LineParser } from './parsers';

// Incremental reader for one log file. The first read takes only the end of
// the file; later reads parse just the bytes appended since, so live viewing
// costs almost nothing. A file that shrinks (rotation, truncation) is read
// again from its end.

export interface TailEntry {
  /** Byte offset of the entry's first line in the file. */
  offset: number;
  time: string;
  timeEstimated: boolean;
  severity: LogSeverity;
  component?: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface LogTailOptions {
  /** How much of the end of the file the first read takes. */
  windowBytes: number;
  /** Older entries are dropped beyond this many. */
  maxEntries: number;
}

const NEWLINE = 0x0a;

export class LogTail {
  private entries: TailEntry[] = [];
  /** Bytes of the file consumed so far (always at a line boundary). */
  private consumed = 0;
  /** Identity of the file read so far, to notice a replaced file of a similar size. */
  private birthtimeMs = 0;

  constructor(
    readonly path: string,
    private readonly parse: LineParser,
    private readonly options: LogTailOptions,
  ) {}

  /** The entries in file order, after reading anything new. */
  async read(): Promise<readonly TailEntry[]> {
    let info;
    try {
      info = await stat(this.path);
    } catch {
      this.reset(0);
      return this.entries;
    }
    if (info.size < this.consumed || info.birthtimeMs !== this.birthtimeMs) this.reset(info.birthtimeMs);
    if (info.size === this.consumed) return this.entries;

    const firstRead = this.consumed === 0;
    const start = firstRead ? Math.max(0, info.size - this.options.windowBytes) : this.consumed;
    const buffer = Buffer.alloc(info.size - start);
    const handle = await open(this.path, 'r');
    try {
      await handle.read(buffer, 0, buffer.length, start);
    } finally {
      await handle.close();
    }

    // Only complete lines are taken; a line still being written is read next time.
    const end = buffer.lastIndexOf(NEWLINE);
    if (end === -1) return this.entries;
    // A window starting inside the file begins with part of a line, which is skipped.
    let lineStart = firstRead && start > 0 ? buffer.indexOf(NEWLINE) + 1 : 0;
    const fallbackTime = info.mtime.toISOString();
    while (lineStart <= end) {
      const lineEnd = buffer.indexOf(NEWLINE, lineStart);
      const text = buffer.toString('utf8', lineStart, lineEnd).replace(/\r$/, '');
      this.add(start + lineStart, text, fallbackTime);
      lineStart = lineEnd + 1;
    }
    this.consumed = start + end + 1;
    if (this.entries.length > this.options.maxEntries) {
      this.entries = this.entries.slice(this.entries.length - this.options.maxEntries);
    }
    return this.entries;
  }

  private reset(birthtimeMs: number): void {
    this.entries = [];
    this.consumed = 0;
    this.birthtimeMs = birthtimeMs;
  }

  private add(offset: number, text: string, fallbackTime: string): void {
    if (text === '') return;
    const parsed = this.parse(text);
    if (!parsed) return;
    const previous = this.entries.at(-1);
    if (parsed.continuation && previous) {
      previous.message = `${previous.message}\n${parsed.message}`;
      return;
    }
    this.entries.push({
      offset,
      // A line without a time follows the previous entry; failing that, the file's last change.
      time: parsed.time ?? previous?.time ?? fallbackTime,
      timeEstimated: parsed.time === undefined,
      severity: parsed.severity,
      ...(parsed.component === undefined ? {} : { component: parsed.component }),
      message: parsed.message,
      ...(parsed.context === undefined ? {} : { context: parsed.context }),
    });
  }
}
