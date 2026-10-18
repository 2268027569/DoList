import initSql from './0001_init.sql?raw';

/**
 * Migrations are embedded into the bundle — packaging never has to ship loose
 * `.sql` files, so there is nothing to keep in sync with `asarUnpack`.
 *
 * Files are append-only: never edit a shipped migration, add the next number.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0001_init', sql: initSql },
];
