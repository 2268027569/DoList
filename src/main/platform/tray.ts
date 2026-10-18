import { app, Menu, Tray, nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createLogger } from '../logger';
import { t } from '../i18n';
import { resourcesDir } from './paths';
import { expandPanel, panelStateOf, togglePanel } from '../windows/panel';

const log = createLogger('platform/tray');

let tray: Tray | null = null;

/**
 * The only permanent entry point to the app: both windows stay out of the
 * taskbar (docs/ARCHITECTURE.md §3), so the tray icon and the global shortcut
 * are how the user reaches YiChen ToDo.
 */
export function createTray(): Tray {
  const instance = new Tray(loadTrayIcon());
  instance.setToolTip(t('app.name'));
  instance.on('click', () => togglePanel());
  instance.on('double-click', () => expandPanel());
  applyTrayMenu(instance);
  tray = instance;
  log('tray created', { platform: process.platform, visible: panelStateOf() });
  return instance;
}

/** Re-labels the menu after a locale change. */
export function refreshTray(): void {
  if (tray === null) return;
  tray.setToolTip(t('app.name'));
  applyTrayMenu(tray);
}

export function destroyTray(): void {
  if (tray === null) return;
  tray.destroy();
  tray = null;
}

function applyTrayMenu(instance: Tray): void {
  instance.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('action.openPanel'), click: () => expandPanel() },
      { type: 'separator' },
      { label: t('action.quit'), click: () => app.quit() },
    ]),
  );
}

/**
 * Icons come from `scripts/make-icons.mjs`; `resources/` is shipped through
 * electron-builder `extraResources`. A missing asset degrades to an empty
 * image instead of crashing the tray.
 */
function loadTrayIcon(): NativeImage {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const path = join(resourcesDir(), file);

  if (!existsSync(path)) {
    log('tray icon asset missing, falling back to an empty image', path);
    return nativeImage.createEmpty();
  }

  const icon = nativeImage.createFromPath(path);
  if (icon.isEmpty()) {
    log('tray icon could not be decoded', path);
    return nativeImage.createEmpty();
  }
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}
