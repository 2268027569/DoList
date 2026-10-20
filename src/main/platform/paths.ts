import { app } from 'electron';
import { dirname, join } from 'node:path';

import { isSmokeEnabled } from './smoke';

/**
 * Resource paths differ between `electron-vite dev` (repo layout) and a packaged
 * build (`resources/` sits next to the asar via `extraResources`).
 */
export function resourcesDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(__dirname, '../../resources');
}

export function userDataDir(): string {
  return app.getPath('userData');
}

/**
 * The smoke harness has to be repeatable, which means it must not read — or
 * leave anything in — the real profile. `YICHEN_SMOKE_DB` therefore only moves
 * the database while the harness itself is enabled, so the override can never
 * take effect in a normal launch.
 */
export function databaseFile(): string {
  const override = isSmokeEnabled() ? process.env['YICHEN_SMOKE_DB'] : undefined;
  if (override !== undefined && override.trim() !== '') return override;
  return join(userDataDir(), 'yichen-todo.db');
}

export function logsDir(): string {
  return join(userDataDir(), 'logs');
}

/**
 * Where a task's attachments are copied (M03 S3).
 *
 * Beside the database rather than at a fixed userData path, so the folder-sync
 * export (M10) — which moves the database file — carries the files with it, and so a
 * smoke run's copies land in the smoke profile instead of the real one. Created
 * lazily by the service that writes into it, since a profile with no attachments
 * should not have the directory either.
 */
export function attachmentsDir(): string {
  return join(dirname(databaseFile()), 'attachments');
}
