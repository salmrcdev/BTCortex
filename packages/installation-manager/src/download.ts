import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { renameWhenReleased } from './rename';

// Resumable, hash-verified downloads. Data is written to `<file>.partial`
// and only renamed into place once its SHA-256 matches, so a half-finished or
// tampered download can never be mistaken for a verified one.

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | undefined;
}

export interface DownloadOptions {
  /** Lower-case hex SHA-256 the file must have. */
  expectedSha256?: string;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /** Tests only: allow plain HTTP to loopback addresses. */
  allowLoopbackHttp?: boolean;
}

export class DownloadIntegrityError extends Error {
  constructor(
    readonly url: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`The file downloaded from ${url} does not match its published checksum and was deleted.`);
    this.name = 'DownloadIntegrityError';
  }
}

function assertSecureUrl(url: string, allowLoopbackHttp: boolean): void {
  const parsed = new URL(url);
  if (parsed.protocol === 'https:') return;
  if (
    allowLoopbackHttp &&
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  ) {
    return;
  }
  throw new Error(`Refusing to download over an insecure connection: ${url}`);
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** SHA-256 of a file, read as a stream so that large executables never sit in memory whole. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

function hashesEqual(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Small text or binary resources (checksum files, signatures). */
export async function fetchBytes(
  url: string,
  options: Pick<DownloadOptions, 'fetch' | 'signal' | 'allowLoopbackHttp'> = {},
): Promise<Uint8Array> {
  assertSecureUrl(url, options.allowLoopbackHttp ?? false);
  const response = await (options.fetch ?? fetch)(url, options.signal ? { signal: options.signal } : {});
  if (!response.ok) throw new Error(`Downloading ${url} failed with HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function downloadFile(
  url: string,
  destination: string,
  options: DownloadOptions = {},
): Promise<{ sha256: string; bytes: number }> {
  assertSecureUrl(url, options.allowLoopbackHttp ?? false);
  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.partial`;
  const hash = createHash('sha256');

  // Re-hash any bytes kept from an interrupted attempt, then ask for the rest.
  const resumeFrom = await stat(partial).then(
    (stats) => stats.size,
    () => 0,
  );
  if (resumeFrom > 0) await pipeline(createReadStream(partial), hash, { end: false });

  const headers: Record<string, string> = resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {};
  const response = await (options.fetch ?? fetch)(url, {
    headers,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (resumeFrom > 0 && response.status === 416) {
    // The kept bytes already reach (or pass) the end of the file: start again, or every attempt would fail the same way.
    await response.body?.cancel().catch(() => undefined);
    await rm(partial, { force: true });
    return downloadFile(url, destination, options);
  }
  if (!response.ok || !response.body) throw new Error(`Downloading ${url} failed with HTTP ${response.status}.`);

  let received = resumeFrom;
  let restart = false;
  if (resumeFrom > 0 && response.status !== 206) {
    // The server ignored the range request: start again from the beginning.
    restart = true;
    received = 0;
  }
  const lengthHeader = response.headers.get('content-length');
  const remaining = lengthHeader === null ? undefined : Number.parseInt(lengthHeader, 10);
  const totalBytes = remaining === undefined || Number.isNaN(remaining) ? undefined : received + remaining;

  const freshHash = restart ? createHash('sha256') : hash;
  const output = createWriteStream(partial, { flags: restart || resumeFrom === 0 ? 'w' : 'a' });
  const body = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
  body.on('data', (chunk: Buffer) => {
    freshHash.update(chunk);
    received += chunk.length;
    options.onProgress?.({ receivedBytes: received, totalBytes });
  });
  await pipeline(body, output, options.signal ? { signal: options.signal } : {});

  const actual = freshHash.digest('hex');
  if (options.expectedSha256 && !hashesEqual(options.expectedSha256.toLowerCase(), actual)) {
    await rm(partial, { force: true });
    throw new DownloadIntegrityError(url, options.expectedSha256, actual);
  }
  await renameWhenReleased(partial, destination);
  return { sha256: actual, bytes: received };
}
