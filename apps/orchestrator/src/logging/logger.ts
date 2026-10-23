import { closeSync, existsSync, fstatSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { redact, redactString } from '@btcortex/core';

// Structured JSON-lines logging with size-based rotation (specification
// section 20). Every entry is redacted before it is written anywhere. Writes
// are synchronous on purpose: entries written just before a crash survive.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogEntry {
  time: string;
  level: LogLevel;
  component: string;
  message: string;
  context?: unknown;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(component: string): Logger;
}

export interface LogSink {
  write(entry: LogEntry): void;
  close(): void;
}

export interface RotatingFileSinkOptions {
  directory: string;
  fileName: string;
  /** Rotate once the active file exceeds this size. */
  maxFileBytes: number;
  /** Number of rotated files kept in addition to the active one. */
  maxRotatedFiles: number;
}

/** Bounded on-disk log: at most (maxRotatedFiles + 1) × maxFileBytes. */
export class RotatingFileSink implements LogSink {
  private descriptor: number | undefined;
  private size = 0;

  constructor(private readonly options: RotatingFileSinkOptions) {
    mkdirSync(options.directory, { recursive: true });
    this.open();
  }

  write(entry: LogEntry): void {
    if (this.descriptor === undefined) return;
    const line = `${JSON.stringify(entry)}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.size + bytes > this.options.maxFileBytes && this.size > 0) this.rotate();
    // rotate() reopens the file or throws, so the descriptor is set again here.
    writeSync(this.descriptor, line);
    this.size += bytes;
  }

  close(): void {
    if (this.descriptor !== undefined) closeSync(this.descriptor);
    this.descriptor = undefined;
  }

  private path(index: number): string {
    return join(this.options.directory, index === 0 ? this.options.fileName : `${this.options.fileName}.${index}`);
  }

  private open(): void {
    this.descriptor = openSync(this.path(0), 'a');
    this.size = fstatSync(this.descriptor).size;
  }

  private rotate(): void {
    this.close();
    const oldest = this.path(this.options.maxRotatedFiles);
    if (existsSync(oldest)) rmSync(oldest, { force: true });
    for (let index = this.options.maxRotatedFiles - 1; index >= 0; index -= 1) {
      const from = this.path(index);
      if (existsSync(from)) renameSync(from, this.path(index + 1));
    }
    this.open();
  }
}

/** Mirrors entries to stderr for development. Never stdout: that is the RPC channel. */
export class StderrSink implements LogSink {
  write(entry: LogEntry): void {
    const context = entry.context === undefined ? '' : ` ${JSON.stringify(entry.context)}`;
    process.stderr.write(
      `${entry.time} ${entry.level.toUpperCase().padEnd(5)} [${entry.component}] ${entry.message}${context}\n`,
    );
  }

  close(): void {
    // Nothing to release.
  }
}

/** Keeps entries in memory; used by tests and by the diagnostics view. */
export class MemorySink implements LogSink {
  readonly entries: LogEntry[] = [];

  constructor(private readonly capacity = 1000) {}

  write(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
  }

  close(): void {
    // Nothing to release.
  }
}

export class StructuredLogger implements Logger {
  constructor(
    private readonly sinks: readonly LogSink[],
    private readonly minimumLevel: LogLevel,
    private readonly component = 'orchestrator',
    private readonly now: () => Date = () => new Date(),
  ) {}

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  child(component: string): Logger {
    return new StructuredLogger(this.sinks, this.minimumLevel, `${this.component}.${component}`, this.now);
  }

  close(): void {
    for (const sink of this.sinks) sink.close();
  }

  private log(level: LogLevel, message: string, context: Record<string, unknown> | undefined): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minimumLevel]) return;
    const entry: LogEntry = {
      time: this.now().toISOString(),
      level,
      component: this.component,
      message: redactString(message),
    };
    if (context !== undefined) entry.context = redact(context);
    for (const sink of this.sinks) {
      try {
        sink.write(entry);
      } catch (error) {
        // A failing sink must not take the orchestrator down; report once on stderr.
        process.stderr.write(`log sink failure: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }
}
