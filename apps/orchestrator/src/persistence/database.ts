import { DatabaseSync } from 'node:sqlite';
import { AppFailure } from '@btcortex/contracts';
import type { Logger } from '../logging/logger';

// Local application metadata lives in SQLite through Node's built-in
// `node:sqlite` module, so the sidecar needs no native add-ons.

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

export interface OpenDatabaseOptions {
  file: string;
  migrations: readonly Migration[];
  logger: Logger;
  now?: () => Date;
}

export function openDatabase({ file, migrations, logger, now = () => new Date() }: OpenDatabaseOptions): DatabaseSync {
  const ids = migrations.map((migration) => migration.id);
  if (new Set(ids).size !== ids.length) throw new Error('Migration ids must be unique.');

  const database = new DatabaseSync(file);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA synchronous = NORMAL');
  database.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT',
  );

  const applied = new Set(
    database
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((row) => Number(row['id'])),
  );
  const newestKnown = Math.max(0, ...ids);
  const newestApplied = Math.max(0, ...applied);
  if (newestApplied > newestKnown) {
    database.close();
    // Never let an older version write to a newer schema (specification section 28).
    throw new AppFailure({
      code: 'persistence.newer-schema',
      message: 'The BTCortex database was created by a newer version of BTCortex.',
      component: 'BTCortex database',
      dataRisk: 'none',
      likelyCause: 'BTCortex was downgraded after a newer version had upgraded the database.',
      details: { file, newestApplied, newestKnown },
      recoveryActions: [{ id: 'install-newer-version', label: 'Install the newer version of BTCortex again' }],
    });
  }

  const record = database.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)');
  for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
    if (applied.has(migration.id)) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      record.run(migration.id, migration.name, now().toISOString());
      database.exec('COMMIT');
      logger.info('Applied database migration', { id: migration.id, name: migration.name });
    } catch (error) {
      database.exec('ROLLBACK');
      database.close();
      throw error;
    }
  }
  return database;
}
