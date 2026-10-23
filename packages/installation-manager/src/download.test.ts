import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadFile, DownloadIntegrityError, fetchBytes } from './download';

const PAYLOAD = Buffer.from('bitcoin '.repeat(10_000));
const PAYLOAD_SHA256 = createHash('sha256').update(PAYLOAD).digest('hex');

let server: Server;
let base: string;
let directory: string;
let honourRanges = true;
const rangeHeaders: (string | undefined)[] = [];

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'btcortex-download-'));
  honourRanges = true;
  rangeHeaders.length = 0;
  server = createServer((request, response) => {
    const range = request.headers.range;
    rangeHeaders.push(range);
    const match = range ? /^bytes=(\d+)-$/.exec(range) : null;
    if (match && honourRanges) {
      const start = Number(match[1]);
      if (start >= PAYLOAD.length) {
        // As a real server answers a range past the end of the file.
        response.writeHead(416, { 'Content-Range': `bytes */${String(PAYLOAD.length)}` });
        response.end();
        return;
      }
      response.writeHead(206, { 'Content-Length': String(PAYLOAD.length - start) });
      response.end(PAYLOAD.subarray(start));
      return;
    }
    response.writeHead(200, { 'Content-Length': String(PAYLOAD.length) });
    response.end(PAYLOAD);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  rmSync(directory, { recursive: true, force: true });
});

describe('downloadFile', () => {
  it('downloads, verifies and reports progress', async () => {
    const target = join(directory, 'file.zip');
    let lastProgress = 0;
    const result = await downloadFile(`${base}/file.zip`, target, {
      expectedSha256: PAYLOAD_SHA256,
      allowLoopbackHttp: true,
      onProgress: ({ receivedBytes }) => (lastProgress = receivedBytes),
    });
    expect(result).toEqual({ sha256: PAYLOAD_SHA256, bytes: PAYLOAD.length });
    expect(lastProgress).toBe(PAYLOAD.length);
    expect(readFileSync(target).equals(PAYLOAD)).toBe(true);
    expect(existsSync(`${target}.partial`)).toBe(false);
  });

  it('resumes an interrupted download with a range request', async () => {
    const target = join(directory, 'file.zip');
    writeFileSync(`${target}.partial`, PAYLOAD.subarray(0, 12_345));
    const result = await downloadFile(`${base}/file.zip`, target, {
      expectedSha256: PAYLOAD_SHA256,
      allowLoopbackHttp: true,
    });
    expect(rangeHeaders).toEqual(['bytes=12345-']);
    expect(result.sha256).toBe(PAYLOAD_SHA256);
  });

  it('starts again when the server ignores the range', async () => {
    honourRanges = false;
    const target = join(directory, 'file.zip');
    writeFileSync(`${target}.partial`, Buffer.from('stale bytes from another file'));
    const result = await downloadFile(`${base}/file.zip`, target, {
      expectedSha256: PAYLOAD_SHA256,
      allowLoopbackHttp: true,
    });
    expect(result.sha256).toBe(PAYLOAD_SHA256);
    expect(readFileSync(target).equals(PAYLOAD)).toBe(true);
  });

  it('starts again when the kept bytes already reach the end of the file', async () => {
    const target = join(directory, 'file.zip');
    // A complete download whose final rename did not happen, or bytes left from a larger file.
    writeFileSync(`${target}.partial`, Buffer.concat([PAYLOAD, Buffer.from('extra')]));
    const result = await downloadFile(`${base}/file.zip`, target, {
      expectedSha256: PAYLOAD_SHA256,
      allowLoopbackHttp: true,
    });
    expect(rangeHeaders).toEqual([`bytes=${String(PAYLOAD.length + 5)}-`, undefined]);
    expect(result.sha256).toBe(PAYLOAD_SHA256);
    expect(readFileSync(target).equals(PAYLOAD)).toBe(true);
  });

  it('deletes downloads that do not match the published checksum', async () => {
    const target = join(directory, 'file.zip');
    const promise = downloadFile(`${base}/file.zip`, target, {
      expectedSha256: '0'.repeat(64),
      allowLoopbackHttp: true,
    });
    await expect(promise).rejects.toBeInstanceOf(DownloadIntegrityError);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.partial`)).toBe(false);
  });

  it('refuses insecure connections outside tests', async () => {
    await expect(downloadFile(`${base}/file.zip`, join(directory, 'x'))).rejects.toThrow(/insecure/);
    await expect(fetchBytes('http://bitcoincore.org/bin/SHA256SUMS')).rejects.toThrow(/insecure/);
  });
});
