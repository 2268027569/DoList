import { app } from 'electron';
import { join } from 'node:path';

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
