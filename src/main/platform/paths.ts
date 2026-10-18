import { app } from 'electron';
import { join } from 'node:path';

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

export function databaseFile(): string {
  return join(userDataDir(), 'yichen-todo.db');
}

export function logsDir(): string {
  return join(userDataDir(), 'logs');
}
