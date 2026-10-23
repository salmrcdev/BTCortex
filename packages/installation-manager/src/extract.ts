import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';

// ZIP extraction that refuses anything outside the expected layout: absolute
// paths, `..` segments, drive letters, alternate data streams, symbolic links
// and archives that expand beyond a size limit (specification section 21.1).

export class UnsafeArchiveError extends Error {
  constructor(
    readonly entry: string,
    reason: string,
  ) {
    super(`The archive entry "${entry}" was rejected: ${reason}`);
    this.name = 'UnsafeArchiveError';
  }
}

export interface ExtractOptions {
  /** Every entry must live under this top-level folder, for example `bitcoin-31.1`, or under one of these folders. */
  expectedRoot: string | readonly string[];
  /** Upper bound for the total uncompressed size. */
  maxTotalBytes: number;
  /** Files (full entry paths, forward slashes) that are checked like the others but not written. */
  skippedFiles?: readonly string[];
}

const SYMLINK_MODE = 0o120000;
const FILE_TYPE_MASK = 0o170000;

/** Windows device names, which open the device instead of a file whatever the extension. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** `roots`: the top-level folder every entry must live under, or the list of allowed ones. */
export function validateEntryName(name: string, roots: string | readonly string[]): string[] {
  if (name.includes('\\')) throw new UnsafeArchiveError(name, 'it uses backslashes.');
  if (name.startsWith('/')) throw new UnsafeArchiveError(name, 'it is an absolute path.');
  if (name.includes(':'))
    throw new UnsafeArchiveError(name, 'it contains a colon (drive letter or alternate data stream).');
  const segments = name.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new UnsafeArchiveError(name, 'it contains relative path segments.');
  }
  if (segments.some((segment) => RESERVED_NAMES.test(segment))) {
    throw new UnsafeArchiveError(name, 'it uses a name Windows reserves for devices.');
  }
  const allowed = typeof roots === 'string' ? [roots] : roots;
  if (segments[0] === undefined || !allowed.includes(segments[0])) {
    throw new UnsafeArchiveError(name, `it is outside the expected folders (${allowed.join(', ')}).`);
  }
  return segments;
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) reject(error);
      else resolvePromise(zip);
    });
  });
}

function openEntry(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolvePromise, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else resolvePromise(stream);
    });
  });
}

/** Extracts into `destination` (which should be a fresh staging directory) and returns the files written. */
export async function extractZip(archive: string, destination: string, options: ExtractOptions): Promise<string[]> {
  const zip = await openZip(archive);
  const root = resolve(destination);
  const written: string[] = [];
  let totalBytes = 0;

  try {
    await new Promise<void>((resolvePromise, reject) => {
      const fail = (error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      zip.on('error', fail);
      zip.on('end', () => {
        resolvePromise();
      });
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          const segments = validateEntryName(entry.fileName, options.expectedRoot);
          const mode = (entry.externalFileAttributes >>> 16) & FILE_TYPE_MASK;
          if (mode === SYMLINK_MODE) throw new UnsafeArchiveError(entry.fileName, 'symbolic links are not allowed.');
          if (options.skippedFiles?.includes(segments.join('/'))) {
            zip.readEntry();
            return;
          }
          totalBytes += entry.uncompressedSize;
          if (totalBytes > options.maxTotalBytes) {
            throw new UnsafeArchiveError(entry.fileName, `the archive expands beyond ${options.maxTotalBytes} bytes.`);
          }

          const target = resolve(join(root, ...segments));
          if (target !== root && !target.startsWith(`${root}${sep}`)) {
            throw new UnsafeArchiveError(entry.fileName, 'it resolves outside the destination.');
          }
          if (entry.fileName.endsWith('/')) {
            await mkdir(target, { recursive: true });
          } else {
            await mkdir(dirname(target), { recursive: true });
            await pipeline(await openEntry(zip, entry), createWriteStream(target, { flags: 'wx' }));
            written.push(segments.join('/'));
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  return written;
}
