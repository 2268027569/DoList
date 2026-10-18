import { app, dialog, nativeTheme } from 'electron';

import { messageOf } from '@shared/contracts/result';
import { closeDatabase, openDatabase } from './db/connection';
import { migrate } from './db/migrate';
import { registerIpcHandlers } from './ipc/register';
import { currentLocale, initI18n, t } from './i18n';
import { createLogger, initLogFile, logFilePath } from './logger';
import { databaseFile, logsDir } from './platform/paths';
import { isSmokeEnabled, smokeReady, smokeRecord } from './platform/smoke';
import { registerShortcuts, unregisterShortcuts } from './platform/shortcuts';
import { createTray, destroyTray } from './platform/tray';
import { broadcastTheme } from './services/broadcast';
import { appSettings, resolveBoot } from './services/settings';
import { createMarkerWindow } from './windows/marker';
import { createPanelWindow, expandPanel } from './windows/panel';

const log = createLogger('bootstrap');

/** Must match `appId` in `build/electron-builder.yml` and the notification identity. */
const APP_ID = 'com.yichen.todolist';
const SMOKE = isSmokeEnabled();

void start();

async function start(): Promise<void> {
  app.setAppUserModelId(APP_ID);

  if (!app.requestSingleInstanceLock()) {
    log('another instance already owns the single-instance lock, exiting');
    app.quit();
    return;
  }
  app.on('second-instance', () => expandPanel());

  await app.whenReady();

  initLogFile(logsDir());
  log(`===== group 1/6 · logging → ${logFilePath() ?? '(unwritable)'}`);

  log('===== group 2/6 · i18n');
  await initI18n(app.getLocale());

  log('===== group 3/6 · storage (SQLite)');
  try {
    const db = openDatabase(databaseFile());
    const migrated = migrate(db);
    log('database ready', { file: databaseFile(), ...migrated });
  } catch (error) {
    log('database could not be opened', messageOf(error));
    dialog.showErrorBox(
      t('errors.db.title'),
      t('errors.db.message', { path: databaseFile() }),
    );
    app.quit();
    return;
  }

  const boot = resolveBoot(SMOKE);
  if (boot.locale !== currentLocale()) await initI18n(boot.locale);

  log('===== group 4/6 · ipc handlers');
  registerIpcHandlers();

  log('===== group 5/6 · windows (marker + panel)');
  createMarkerWindow(boot);
  createPanelWindow(boot);

  log('===== group 6/6 · system integration (tray, shortcuts, theme)');
  createTray();
  registerShortcuts();

  nativeTheme.on('updated', () => {
    if (appSettings().themeMode === 'system') {
      log('system theme changed, re-resolving');
      broadcastTheme();
    }
  });

  registerLifecycle();
  log('startup complete', { boot, smoke: SMOKE });
  if (SMOKE) smokeReady({ boot, database: databaseFile() });
}

function registerLifecycle(): void {
  // Tray application: closing every window must not quit the app. Registering a
  // listener (even an empty one) replaces Electron's default quit behaviour.
  app.on('window-all-closed', () => {
    log('all windows closed — staying resident in the tray');
  });

  app.on('activate', () => {
    // macOS: clicking the Dock icon re-opens the panel.
    expandPanel();
  });

  app.on('will-quit', () => {
    log('shutting down');
    unregisterShortcuts();
    destroyTray();
    closeDatabase();
  });

  app.on('web-contents-created', (_event, contents) => {
    // Defence in depth against navigation / new-window abuse (§11).
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      const devServer = process.env['ELECTRON_RENDERER_URL'];
      if (devServer !== undefined && url.startsWith(devServer)) return;
      log('navigation blocked', url);
      event.preventDefault();
    });
  });

  process.on('uncaughtException', (error) => {
    log('uncaught exception in the main process', messageOf(error));
    smokeRecord('main-crash', { message: messageOf(error) });
  });
}
