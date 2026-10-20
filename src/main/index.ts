import { app, dialog, nativeTheme } from 'electron';

import { messageOf } from '@shared/contracts/result';
import { closeDatabase, openDatabase } from './db/connection';
import { migrate } from './db/migrate';
import { registerIpcHandlers } from './ipc/register';
import { currentLocale, initI18n, t } from './i18n';
import { createLogger, initLogFile, logFilePath } from './logger';
import { databaseFile, logsDir } from './platform/paths';
import {
  closeAllReminderSurfaces,
  deliverReminder,
} from './platform/notifications';
import { isSmokeEnabled, smokeClockOffsetMs, smokeReady, smokeRecord } from './platform/smoke';
import { registerShortcuts, unregisterShortcuts } from './platform/shortcuts';
import { createTray, destroyTray } from './platform/tray';
import { broadcastTheme } from './services/broadcast';
import { startReminderScheduler, stopReminderScheduler } from './services/scheduler';
import { appSettings, resolveBoot } from './services/settings';
import { reconcileReminders } from './services/tasks';
import { createMarkerWindow } from './windows/marker';
import { createPanelWindow, expandPanel } from './windows/panel';
import { configureReminderWindows } from './windows/reminder';

const log = createLogger('bootstrap');

/** Must match `appId` in `build/electron-builder.yml` and the notification identity. */
const APP_ID = 'com.yichen.todolist';
const SMOKE = isSmokeEnabled();
/** Where the smoke harness reaches the panel's DOM from outside (platform/smoke.ts). */
const SMOKE_CDP_PORT = process.env['YICHEN_SMOKE_CDP_PORT'] ?? '9222';

void start();

async function start(): Promise<void> {
  app.setAppUserModelId(APP_ID);

  if (SMOKE) {
    // A smoke run is driven by a separate process, which has no way to call into
    // this one: it reaches the panel's DOM over the DevTools protocol instead. That
    // protocol delivers keys to the renderer directly, so the panel never needs the
    // OS keyboard or its input queue — which is what made the old back-and-forth
    // through SendInput and the IME so unreliable (§13). The port is opened only
    // under `YICHEN_SMOKE`, so a real install has no debug listener at all.
    app.commandLine.appendSwitch('remote-debugging-port', SMOKE_CDP_PORT);
    app.commandLine.appendSwitch('remote-allow-origins', '*');
  }

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

  log('===== group 5/6 · windows (marker + panel + reminder)');
  createMarkerWindow(boot);
  createPanelWindow(boot);
  // The popup is placed from the marker's rectangle and has to follow it, so it is
  // configured after the marker exists and before anything can be announced (§5.3).
  configureReminderWindows(boot);

  log('===== group 6/6 · system integration (tray, shortcuts, theme, reminders)');
  createTray();
  registerShortcuts();

  // Reminders last, and after the windows: the scheduler's delivery opens the panel,
  // so it must not announce anything into a process that has no panel to open (§5.3).
  //
  // The reconcile comes first: instances are derived data and only a write re-derives
  // them, so this is where a reminder the previous run failed to leave behind is
  // rebuilt. Put back before `start`, an instance this recovers is announced by the same
  // launch pass that deals with one missed while the app was closed.
  // The offset is the reminder harness asking for the moment now rather than later
  // (platform/smoke.ts), so a run does not have to sit and wait for it.
  const rebuilt = reconcileReminders(Date.now());
  if (rebuilt > 0) log('rebuilt reminder instances a write had left behind', { tasks: rebuilt });

  const clockOffset = smokeClockOffsetMs();
  startReminderScheduler({
    deliver: deliverReminder,
    ...(clockOffset > 0 ? { now: () => Date.now() + clockOffset } : {}),
  });

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
    stopReminderScheduler();
    // A toast and a card timer belong to this process; neither should outlive it.
    closeAllReminderSurfaces();
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
