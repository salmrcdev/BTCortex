import type { Migration } from './database';

// Append-only. Never edit a migration that has shipped; add a new one.
export const migrations: readonly Migration[] = [
  {
    id: 1,
    name: 'settings-and-secrets',
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      -- Secrets are stored only as Windows DPAPI blobs produced by the native shell.
      CREATE TABLE secrets (
        id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        protected_value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    id: 2,
    name: 'node-profiles-and-jobs',
    sql: `
      CREATE TABLE node_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        implementation TEXT NOT NULL,
        network TEXT NOT NULL,
        execution TEXT NOT NULL,
        runtime_version TEXT,
        data_directory TEXT,
        rpc_endpoint TEXT NOT NULL,
        authentication TEXT NOT NULL,
        keep_running_on_exit INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      -- Two profiles must never share a data directory on the same network (specification section 5.3).
      CREATE UNIQUE INDEX node_profiles_data_directory
        ON node_profiles (lower(data_directory), network)
        WHERE data_directory IS NOT NULL;

      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        record TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    id: 3,
    name: 'alerts-and-metrics',
    sql: `
      -- Alerts stay open while their condition lasts; resolved ones are kept for 30 days.
      CREATE TABLE alerts (
        id TEXT PRIMARY KEY,
        rule TEXT NOT NULL,
        severity TEXT NOT NULL,
        component TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        route TEXT,
        raised_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT,
        acknowledged_at TEXT
      ) STRICT;
      CREATE INDEX alerts_by_resolution ON alerts (resolved_at, raised_at);

      -- One value per series and second: minute samples for two days, hourly averages for 90 days.
      CREATE TABLE metric_samples (
        series TEXT NOT NULL,
        resolution TEXT NOT NULL,
        at INTEGER NOT NULL,
        value REAL NOT NULL,
        PRIMARY KEY (series, resolution, at)
      ) STRICT, WITHOUT ROWID;
    `,
  },
  {
    id: 4,
    name: 'node-start-with-btcortex',
    sql: `
      -- Managed nodes BTCortex starts when it starts itself (specification section 32).
      ALTER TABLE node_profiles ADD COLUMN start_with_btcortex INTEGER NOT NULL DEFAULT 0;
    `,
  },
];
