import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkInstalledFiles } from './archive-installer';
import type { VerificationRecord } from './archive-installer';
import { sha256File, sha256Hex } from './download';

describe('checkInstalledFiles', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'btcortex-integrity-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const record = (files: VerificationRecord['files']): VerificationRecord => ({
    label: 'Example 1.0',
    version: '1.0',
    archive: { url: 'https://example.org/a.zip', sha256: '00', bytes: 1 },
    manifest: { url: 'https://example.org/SHA256SUMS', sha256: '00' },
    signatures: { results: [], validSigners: [], signerCount: 1, threshold: 1, meetsThreshold: true },
    authenticode: [],
    trustAnchors: 'test',
    verifiedAt: '2026-10-23T10:00:00.000Z',
    ...(files ? { files } : {}),
  });

  it('finds changed and missing files against the hashes recorded at installation', async () => {
    mkdirSync(join(root, 'app', 'bin'), { recursive: true });
    const tool = join(root, 'app', 'bin', 'tool.exe');
    writeFileSync(tool, 'original');
    writeFileSync(join(root, 'app', 'readme.txt'), 'notes');
    const files = [
      { path: 'app/bin/tool.exe', sha256: sha256Hex(Buffer.from('original')), bytes: 8 },
      { path: 'app/readme.txt', sha256: sha256Hex(Buffer.from('notes')), bytes: 5 },
      { path: 'app/bin/helper.dll', sha256: sha256Hex(Buffer.from('gone')), bytes: 4 },
    ];
    expect(await sha256File(tool)).toBe(files[0]?.sha256);

    // Same size, different content: still caught.
    writeFileSync(tool, 'tampered');
    expect(await checkInstalledFiles(root, record(files))).toEqual({
      recorded: true,
      checked: 3,
      missing: ['app/bin/helper.dll'],
      changed: ['app/bin/tool.exe'],
    });
  });

  it('says when an installation predates recorded hashes', async () => {
    expect(await checkInstalledFiles(root, record(undefined))).toEqual({
      recorded: false,
      checked: 0,
      missing: [],
      changed: [],
    });
  });
});
