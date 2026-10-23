import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppFailure } from '@btcortex/contracts';
import { MemorySink, StructuredLogger } from '../logging/logger';
import { acquireInstanceLock } from '../platform/instance-lock';
import { createShellCaller, SecretVault } from '../vault/vault';
import { openDatabase } from './database';
import { migrations } from './migrations';

const directories: string[] = [];
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'btcortex-db-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const logger = new StructuredLogger([new MemorySink()], 'debug');

describe('openDatabase', () => {
  it('applies migrations once and records them', () => {
    const file = join(temporaryDirectory(), 'test.db');
    openDatabase({ file, migrations, logger }).close();
    const database = openDatabase({ file, migrations, logger });
    const rows = database.prepare('SELECT id, name FROM schema_migrations').all();
    expect(rows).toEqual([
      { id: 1, name: 'settings-and-secrets' },
      { id: 2, name: 'node-profiles-and-jobs' },
      { id: 3, name: 'alerts-and-metrics' },
      { id: 4, name: 'node-start-with-btcortex' },
    ]);
    database.close();
  });

  it('refuses to open a database written by a newer schema', () => {
    const file = join(temporaryDirectory(), 'test.db');
    const newer = [...migrations, { id: 99, name: 'future', sql: 'CREATE TABLE future (id INTEGER) STRICT;' }];
    openDatabase({ file, migrations: newer, logger }).close();
    expect(() => openDatabase({ file, migrations, logger })).toThrow(AppFailure);
  });

  it('rolls back a failing migration completely', () => {
    const file = join(temporaryDirectory(), 'test.db');
    const broken = [
      ...migrations,
      { id: migrations.length + 1, name: 'broken', sql: 'CREATE TABLE half (id INTEGER) STRICT; THIS IS NOT SQL;' },
    ];
    expect(() => openDatabase({ file, migrations: broken, logger })).toThrow();
    const database = openDatabase({ file, migrations, logger });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").all()).toEqual([]);
    database.close();
  });
});

describe('acquireInstanceLock', () => {
  it('prevents a second live owner and replaces stale locks', () => {
    const directory = temporaryDirectory();
    const first = acquireInstanceLock(directory);
    // The current process is alive, so a different pid must be refused.
    expect(() => acquireInstanceLock(directory, process.pid + 1_000_000)).toThrow(AppFailure);
    first.release();
    const second = acquireInstanceLock(directory);
    second.release();
  });
});

describe('SecretVault', () => {
  it('stores only protected blobs and round-trips through the shell', async () => {
    const database = openDatabase({ file: join(temporaryDirectory(), 'test.db'), migrations, logger });
    // Stand-in for the shell's DPAPI service: reversible but obviously not the plaintext.
    const shell = createShellCaller((method, params) => {
      const value = params as Record<string, string>;
      if (method === 'vault.protect') {
        return Promise.resolve({ protected: Buffer.from(`dpapi:${value['plaintext'] ?? ''}`).toString('base64') });
      }
      return Promise.resolve({
        plaintext: Buffer.from(value['protected'] ?? '', 'base64')
          .toString('utf8')
          .replace(/^dpapi:/, ''),
      });
    });
    const vault = new SecretVault(database, shell);

    const id = await vault.store('Remote node RPC password', 'hunter2');
    const stored = database.prepare('SELECT protected_value FROM secrets WHERE id = ?').get(id);
    expect(String(stored?.['protected_value'])).not.toContain('hunter2');
    await expect(vault.reveal(id)).resolves.toBe('hunter2');

    await vault.replace(id, 'correct horse');
    await expect(vault.reveal(id)).resolves.toBe('correct horse');
    expect(vault.list()).toHaveLength(1);
    expect(vault.remove(id)).toBe(true);
    await expect(vault.reveal(id)).rejects.toThrow();
    database.close();
  });
});
