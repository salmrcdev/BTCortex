import type { DatabaseSync } from 'node:sqlite';
import type { z } from 'zod';

// Small JSON values in the settings table, validated when read so that a
// damaged or outdated value falls back to the default instead of failing.

export class SettingsStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get<T>(key: string, schema: z.ZodType<T>): T | undefined {
    const row = this.database.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return undefined;
    try {
      const parsed = schema.safeParse(JSON.parse(String(row['value'])));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    this.database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), this.now().toISOString());
  }

  /** Every stored value, for backups. Secrets are never stored here (they live in the vault). */
  entries(): { key: string; value: unknown; updatedAt: string }[] {
    return this.database
      .prepare('SELECT key, value, updated_at FROM settings ORDER BY key')
      .all()
      .flatMap((row) => {
        try {
          return [
            {
              key: String(row['key']),
              value: JSON.parse(String(row['value'])) as unknown,
              updatedAt: String(row['updated_at']),
            },
          ];
        } catch {
          return [];
        }
      });
  }
}
