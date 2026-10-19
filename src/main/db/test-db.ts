import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type Database from 'better-sqlite3';

import { closeDatabase, openDatabase } from './connection';
import { migrate } from './migrate';

/**
 * Runs `run` against a throwaway database (docs/ARCHITECTURE.md §12, the
 * integration tier: "migration chain + real SQLite in a temp directory").
 *
 * Repositories reach the database through the singleton in `connection.ts`, so
 * this opens that singleton on a temp file and migrates it to the latest schema —
 * exactly the code path the app boots through. `better-sqlite3` is a Node-API
 * addon, so the same binary that Electron loads is loadable here too, and the
 * data layer is covered by ordinary `npm run test` rather than only by E2E.
 */
export function withTempDatabase<T>(run: (db: Database.Database) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'yichen-db-'));
  try {
    const db = openDatabase(join(dir, 'test.db'));
    migrate(db);
    return run(db);
  } finally {
    closeDatabase();
    // WAL leaves -wal and -shm siblings behind, so the directory goes, not just the file.
    rmSync(dir, { recursive: true, force: true });
  }
}
