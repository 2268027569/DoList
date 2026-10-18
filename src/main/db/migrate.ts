import type Database from 'better-sqlite3';

import { MIGRATIONS } from './migrations';
import type { Migration } from './migrations';

const SCHEMA_VERSION_KEY = 'schema_version';

/**
 * Runs pending migrations in a single transaction (docs/ARCHITECTURE.md §5.4).
 * A failure rolls back everything and is surfaced to the caller — the app shows
 * an error dialog instead of silently continuing with a half-migrated database.
 */
export function migrate(db: Database.Database): { from: number; to: number; applied: number } {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

  const from = readSchemaVersion(db);
  const pending = [...MIGRATIONS]
    .filter((migration) => migration.version > from)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) return { from, to: from, applied: 0 };

  const step = db.transaction((migrations: readonly Migration[]) => {
    for (const migration of migrations) {
      db.exec(migration.sql);
      db.prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(SCHEMA_VERSION_KEY, String(migration.version));
    }
  });
  step(pending);

  const to = readSchemaVersion(db);
  return { from, to, applied: pending.length };
}

function readSchemaVersion(db: Database.Database): number {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(SCHEMA_VERSION_KEY) as
    | { value?: string }
    | undefined;
  const parsed = Number(row?.value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
