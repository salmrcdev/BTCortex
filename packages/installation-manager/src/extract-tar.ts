import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { UnsafeArchiveError, validateEntryName } from './extract';

// tar.gz extraction with the same rules as the ZIP extractor (specification
// section 21.1): regular files and folders only, every path validated, nothing
// outside the expected top-level folders, and a size limit enforced while
// decompressing, so a small archive cannot expand without bound. Release
// archives such as the Tor Expert Bundle are a few tens of megabytes, so the
// archive is decompressed in memory and parsed as ustar, with the GNU long-name
// and pax extensions that common tar writers use.

const BLOCK = 512;

export interface TarExtractOptions {
  /** Top-level folders entries may live under, for example `['data', 'docs', 'tor']`. */
  allowedRoots: readonly string[];
  /** Upper bound for the total uncompressed size. */
  maxTotalBytes: number;
  /** Files (full entry paths, forward slashes) that are checked like the others but not written. */
  skippedFiles?: readonly string[];
}

function text(block: Uint8Array, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return new TextDecoder().decode(end === -1 ? field : field.subarray(0, end));
}

function octal(block: Uint8Array, start: number, length: number, entry: string): number {
  // The base-256 form (high bit set) is for sizes above 8 GiB, which no release archive needs.
  if ((block[start] ?? 0) & 0x80) throw new UnsafeArchiveError(entry, 'it declares a size in an unsupported format.');
  const value = text(block, start, length).trim();
  if (!/^[0-7]*$/.test(value)) throw new UnsafeArchiveError(entry, 'its header is malformed.');
  return value === '' ? 0 : Number.parseInt(value, 8);
}

function checksumMatches(block: Uint8Array): boolean {
  const stored = Number.parseInt(text(block, 148, 8).trim(), 8);
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) sum += index >= 148 && index < 156 ? 0x20 : (block[index] ?? 0);
  return sum === stored;
}

/** pax extended header records: "<length> <key>=<value>\n". */
function paxRecords(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  const content = new TextDecoder().decode(data);
  let offset = 0;
  while (offset < content.length) {
    const space = content.indexOf(' ', offset);
    const length = Number.parseInt(content.slice(offset, space), 10);
    if (space === -1 || !Number.isFinite(length) || length <= 0) break;
    const record = content.slice(space + 1, offset + length - 1);
    const equals = record.indexOf('=');
    if (equals > 0) records.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return records;
}

function decompress(archive: Buffer, maxTotalBytes: number): Buffer {
  try {
    // Headers and padding add a little to the files themselves.
    return gunzipSync(archive, { maxOutputLength: maxTotalBytes + 4 * 1024 * 1024 });
  } catch (error) {
    if (error instanceof RangeError || (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new UnsafeArchiveError('(archive)', `the archive expands beyond ${String(maxTotalBytes)} bytes.`);
    }
    throw error;
  }
}

/** Extracts into `destination` (which should be a fresh staging directory) and returns the files written. */
export async function extractTarGz(
  archivePath: string,
  destination: string,
  options: TarExtractOptions,
): Promise<string[]> {
  const tar = decompress(await readFile(archivePath), options.maxTotalBytes);
  const root = resolve(destination);
  const written: string[] = [];
  let totalBytes = 0;
  let offset = 0;
  let pending: { path?: string; size?: number } = {};

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const headerName = text(header, 0, 100);
    if (!checksumMatches(header)) throw new UnsafeArchiveError(headerName, 'its header checksum is wrong.');
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = text(header, 257, 6).startsWith('ustar') ? text(header, 345, 155) : '';
    const declaredSize = octal(header, 124, 12, headerName);
    const size = pending.size ?? declaredSize;
    const dataStart = offset + BLOCK;
    if (dataStart + size > tar.length) throw new UnsafeArchiveError(headerName, 'it is cut short.');
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'x') {
      const records = paxRecords(data);
      const path = records.get('path');
      const paxSize = records.get('size');
      pending = {
        ...(path === undefined ? {} : { path }),
        ...(paxSize === undefined ? {} : { size: Number(paxSize) }),
      };
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') {
      pending = { ...pending, path: text(data, 0, data.length) };
      continue;
    }

    const rawName = pending.path ?? (prefix ? `${prefix}/${headerName}` : headerName);
    pending = {};
    // Some writers put a leading "./" on every entry; it adds nothing.
    const name = rawName.replace(/^(\.\/)+/, '');
    if (name === '' || name === '.') continue;
    if (type !== '0' && type !== '\0' && type !== '5') {
      throw new UnsafeArchiveError(name, 'only regular files and folders are allowed (no links or devices).');
    }
    const segments = validateEntryName(name, options.allowedRoots);
    const target = resolve(join(root, ...segments));
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new UnsafeArchiveError(name, 'it resolves outside the destination.');
    }
    if (type === '5') {
      await mkdir(target, { recursive: true });
      continue;
    }
    if (options.skippedFiles?.includes(segments.join('/'))) continue;
    totalBytes += size;
    if (totalBytes > options.maxTotalBytes) {
      throw new UnsafeArchiveError(name, `the archive expands beyond ${String(options.maxTotalBytes)} bytes.`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data, { flag: 'wx' });
    written.push(segments.join('/'));
  }
  return written;
}
