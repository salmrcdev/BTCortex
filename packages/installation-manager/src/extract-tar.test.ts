import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnsafeArchiveError } from './extract';
import { extractTarGz } from './extract-tar';
import { buildTarGz, paxPath } from './testing/tar-builder';
import type { TarEntrySpec } from './testing/tar-builder';

const ROOTS = ['data', 'docs', 'tor'];

describe('extractTarGz', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-tar-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const extract = (entries: readonly TarEntrySpec[], maxTotalBytes = 1024 * 1024) => {
    const archive = join(root, 'archive.tar.gz');
    writeFileSync(archive, buildTarGz(entries));
    return extractTarGz(archive, join(root, 'out'), { allowedRoots: ROOTS, maxTotalBytes });
  };

  it('extracts files and folders under the allowed top-level folders, the way the Tor Expert Bundle is laid out', async () => {
    const files = await extract([
      { name: 'tor/', type: '5' },
      { name: 'tor/tor.exe', data: 'MZ tor' },
      { name: './data/geoip', data: 'geo' },
      // A long name split between the ustar prefix and name fields.
      { name: 'lyrebird.exe', prefix: 'tor/pluggable_transports', data: 'MZ lyrebird' },
      paxPath('docs/a-very-long-licence-file-name-that-would-not-fit-in-one-hundred-bytes-of-a-classic-header.txt'),
      { name: 'ignored-by-pax', data: 'licence' },
    ]);
    expect(files).toEqual([
      'tor/tor.exe',
      'data/geoip',
      'tor/pluggable_transports/lyrebird.exe',
      'docs/a-very-long-licence-file-name-that-would-not-fit-in-one-hundred-bytes-of-a-classic-header.txt',
    ]);
    expect(readFileSync(join(root, 'out', 'tor', 'tor.exe'), 'utf8')).toBe('MZ tor');
  });

  it.each<[string, TarEntrySpec[]]>([
    ['a parent folder', [{ name: 'tor/../../evil.exe', data: 'x' }]],
    ['an absolute path', [{ name: '/tor/evil.exe', data: 'x' }]],
    ['a drive letter or stream', [{ name: 'tor/file.exe:stream', data: 'x' }]],
    ['an unexpected folder', [{ name: 'Startup/evil.exe', data: 'x' }]],
    ['a device name', [{ name: 'tor/con.txt', data: 'x' }]],
    ['a symbolic link', [{ name: 'tor/link', type: '2', linkName: '../../Windows/System32' }]],
    ['a hard link', [{ name: 'tor/hard', type: '1', linkName: 'tor/tor.exe' }]],
    ['a pax path override', [paxPath('../escape.exe'), { name: 'tor/innocent.exe', data: 'x' }]],
    [
      'a GNU long name',
      [
        { name: '././@LongLink', type: 'L', data: 'tor/../../escape.exe' },
        { name: 'tor/x', data: 'x' },
      ],
    ],
    ['a damaged header', [{ name: 'tor/tor.exe', data: 'x', badChecksum: true }]],
  ])('refuses %s', async (_label, entries) => {
    await expect(extract(entries)).rejects.toBeInstanceOf(UnsafeArchiveError);
    expect(existsSync(join(root, 'evil.exe'))).toBe(false);
    expect(existsSync(join(root, 'escape.exe'))).toBe(false);
  });

  it('stops an archive that expands beyond the limit while it is being decompressed', async () => {
    // Zeros compress to almost nothing: a classic decompression bomb.
    await expect(
      extract([{ name: 'tor/zeros.bin', data: new Uint8Array(8 * 1024 * 1024) }], 64 * 1024),
    ).rejects.toThrow(/expands beyond/);
  });
});
