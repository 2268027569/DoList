import Database from 'better-sqlite3';

let instance: Database.Database | null = null;

/**
 * Opens the local database and applies the pragmas from docs/ARCHITECTURE.md §5.1.
 * WAL keeps reads non-blocking, `foreign_keys` is required for the ON DELETE
 * behaviour of the schema and `busy_timeout` covers the rare concurrent writer.
 */
export function openDatabase(file: string): Database.Database {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  instance = db;
  return db;
}

export function getDatabase(): Database.Database {
  if (!instance) throw new Error('Database has not been opened yet');
  return instance;
}

export function closeDatabase(): void {
  if (!instance) return;
  instance.close();
  instance = null;
}
