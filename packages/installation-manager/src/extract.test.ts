import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildZip } from './testing/zip-builder';
import type { ZipEntrySpec } from './testing/zip-builder';
import { extractZip, validateEntryName } from './extract';

const directories: string[] = [];
function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'btcortex-zip-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function extract(entries: ZipEntrySpec[], maxTotalBytes = 1_000_000) {
  const directory = workspace();
  const archive = join(directory, 'test.zip');
  writeFileSync(archive, buildZip(entries));
  const destination = join(directory, 'out');
  const files = await extractZip(archive, destination, { expectedRoot: 'bitcoin-31.1', maxTotalBytes });
  return { files, destination, directory };
}

describe('extractZip', () => {
  it('extracts the expected layout', async () => {
    const { files, destination } = await extract([
      { name: 'bitcoin-31.1/' },
      { name: 'bitcoin-31.1/bin/bitcoind.exe', data: 'MZ fake daemon' },
      { name: 'bitcoin-31.1/readme.txt', data: 'hello' },
    ]);
    expect(files).toEqual(['bitcoin-31.1/bin/bitcoind.exe', 'bitcoin-31.1/readme.txt']);
    expect(readFileSync(join(destination, 'bitcoin-31.1', 'bin', 'bitcoind.exe'), 'utf8')).toBe('MZ fake daemon');
  });

  it.each([
    ['path traversal', 'bitcoin-31.1/../../evil.exe'],
    ['absolute path', '/bitcoin-31.1/evil.exe'],
    ['drive letter', 'C:/Windows/evil.exe'],
    ['alternate data stream', 'bitcoin-31.1/bitcoind.exe:hidden'],
    ['unexpected root folder', 'something-else/bitcoind.exe'],
  ])('rejects %s', async (_label, name) => {
    const promise = extract([{ name, data: 'x' }]);
    await expect(promise).rejects.toThrow();
  });

  it('rejects symbolic links', async () => {
    await expect(extract([{ name: 'bitcoin-31.1/link', data: '../../outside', mode: 0o120777 }])).rejects.toThrow(
      /symbolic links/,
    );
  });

  it('enforces the expansion limit', async () => {
    await expect(extract([{ name: 'bitcoin-31.1/big.bin', data: 'x'.repeat(2000) }], 1000)).rejects.toThrow(
      /expands beyond/,
    );
  });

  it('leaves out skipped files but still checks their names', async () => {
    const directory = workspace();
    const archive = join(directory, 'skip.zip');
    writeFileSync(
      archive,
      buildZip([
        { name: 'Fulcrum-2.1.4-win64/Fulcrum.exe', data: 'MZ server' },
        { name: 'Fulcrum-2.1.4-win64/FulcrumAdmin.exe', data: 'MZ admin' },
      ]),
    );
    const destination = join(directory, 'out');
    const options = {
      expectedRoot: 'Fulcrum-2.1.4-win64',
      maxTotalBytes: 1000,
      skippedFiles: ['Fulcrum-2.1.4-win64/FulcrumAdmin.exe'],
    };
    expect(await extractZip(archive, destination, options)).toEqual(['Fulcrum-2.1.4-win64/Fulcrum.exe']);
    expect(existsSync(join(destination, 'Fulcrum-2.1.4-win64', 'FulcrumAdmin.exe'))).toBe(false);

    writeFileSync(archive, buildZip([{ name: '../FulcrumAdmin.exe', data: 'MZ admin' }]));
    await expect(
      extractZip(archive, join(directory, 'again'), { ...options, skippedFiles: ['../FulcrumAdmin.exe'] }),
    ).rejects.toThrow(/relative path/);
  });

  it('never overwrites files that already exist in the staging directory', async () => {
    const directory = workspace();
    const archive = join(directory, 'twice.zip');
    writeFileSync(
      archive,
      buildZip([
        { name: 'bitcoin-31.1/a.txt', data: 'one' },
        { name: 'bitcoin-31.1/a.txt', data: 'two' },
      ]),
    );
    await expect(
      extractZip(archive, join(directory, 'out'), { expectedRoot: 'bitcoin-31.1', maxTotalBytes: 1000 }),
    ).rejects.toThrow();
    expect(existsSync(join(directory, 'out', 'bitcoin-31.1', 'a.txt'))).toBe(true);
  });
});

describe('validateEntryName', () => {
  it('splits valid names into segments', () => {
    expect(validateEntryName('bitcoin-31.1/bin/bitcoind.exe', 'bitcoin-31.1')).toEqual([
      'bitcoin-31.1',
      'bin',
      'bitcoind.exe',
    ]);
    expect(() => validateEntryName('bitcoin-31.1\\bin\\x.exe', 'bitcoin-31.1')).toThrow(/backslashes/);
  });
});
