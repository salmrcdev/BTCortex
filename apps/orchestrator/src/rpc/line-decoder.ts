/** Default upper bound for one message, so a runaway peer cannot exhaust memory. */
export const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024;

export class LineTooLongError extends Error {
  constructor(limit: number) {
    super(`A message exceeded the ${limit}-byte limit and was discarded.`);
    this.name = 'LineTooLongError';
  }
}

/**
 * Splits a byte stream into newline-terminated UTF-8 lines. Tolerates CRLF.
 * Bytes are buffered (not strings) so multi-byte characters split across
 * chunks decode correctly.
 */
export class LineDecoder {
  private buffered: Buffer[] = [];
  private bufferedBytes = 0;
  private discarding = false;

  constructor(private readonly maxLineBytes = DEFAULT_MAX_LINE_BYTES) {}

  /** Returns the complete lines in `chunk`; reports oversized lines through `onOversized`. */
  push(chunk: Buffer, onOversized: (error: LineTooLongError) => void): string[] {
    const lines: string[] = [];
    let start = 0;
    for (let index = chunk.indexOf(0x0a); index !== -1; index = chunk.indexOf(0x0a, start)) {
      const part = chunk.subarray(start, index);
      start = index + 1;
      if (this.discarding) {
        this.discarding = false;
        this.reset();
        continue;
      }
      if (this.bufferedBytes + part.length > this.maxLineBytes) {
        onOversized(new LineTooLongError(this.maxLineBytes));
        this.reset();
        continue;
      }
      const line = Buffer.concat([...this.buffered, part])
        .toString('utf8')
        .replace(/\r$/, '');
      this.reset();
      if (line.trim() !== '') lines.push(line);
    }

    const rest = chunk.subarray(start);
    if (rest.length > 0 && !this.discarding) {
      if (this.bufferedBytes + rest.length > this.maxLineBytes) {
        onOversized(new LineTooLongError(this.maxLineBytes));
        this.reset();
        this.discarding = true;
      } else {
        this.buffered.push(rest);
        this.bufferedBytes += rest.length;
      }
    }
    return lines;
  }

  private reset(): void {
    this.buffered = [];
    this.bufferedBytes = 0;
  }
}
