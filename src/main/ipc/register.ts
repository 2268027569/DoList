import { app, ipcMain } from 'electron';

import { IPC } from '@shared/contracts/channels';
import { fail, messageOf, ok } from '@shared/contracts/result';
import {
  markerAnchorSchema,
  markerDragStartInput,
  panelSizeInput,
  setLocaleInput,
  smokeReportInput,
  windowAlwaysOnTopInput,
} from '@shared/contracts/schemas';
import {
  SETTINGS_KEY,
  appSettingsPatchSchema,
  appSettingsSchema,
  markerAppearanceOf,
} from '@shared/contracts/settings';
import type { AppSettings } from '@shared/contracts/settings';
import { createLogger } from '../logger';
import { initI18n } from '../i18n';
import { readRawSetting } from '../db/repositories/settings';
import { refreshTray } from '../platform/tray';
import { smokeRecord } from '../platform/smoke';
import { appSettings, updateAppSettings, writeMarkerAnchor } from '../services/settings';
import { broadcastLocale, broadcastTheme } from '../services/broadcast';
import { taskChannelHandlers } from './handlers/task';
import { invalid } from './validate';
import {
  applyMarkerAnchor,
  applyMarkerAppearance,
  endMarkerDrag,
  noteDragSignal,
  startMarkerDrag,
  syncEdgeHideWatch,
} from '../windows/marker';
import {
  collapsePanel,
  expandPanel,
  finishCollapse,
  panelStateOf,
  resizePanel,
  setPanelAlwaysOnTop,
} from '../windows/panel';

const log = createLogger('ipc');

type Handler = (payload: unknown) => unknown | Promise<unknown>;

let handlerCount = 0;

/**
 * One registrator for every channel (docs/ARCHITECTURE.md §6.1): handlers live
 * in a single list, payloads are validated here, and an escaped exception turns
 * into a value-shaped error instead of a rejected `invoke` (§6.3).
 */
export function registerIpcHandlers(): void {
  handle(IPC.window.expand, () => {
    expandPanel();
    return ok(panelStateOf());
  });

  handle(IPC.window.collapse, () => {
    collapsePanel();
    return ok(panelStateOf());
  });

  handle(IPC.window.collapseFinished, () => {
    finishCollapse();
    return ok(null);
  });

  handle(IPC.window.setAlwaysOnTop, (payload) => {
    const parsed = windowAlwaysOnTopInput.safeParse(payload);
    if (!parsed.success) return invalid('window:set-always-on-top', parsed.error.issues);
    return ok(setPanelAlwaysOnTop(parsed.data.enabled));
  });

  handle(IPC.window.resize, (payload) => {
    const parsed = panelSizeInput.safeParse(payload);
    if (!parsed.success) return invalid('window:resize-panel', parsed.error.issues);
    return ok(resizePanel(parsed.data));
  });

  handle(IPC.marker.dragStart, (payload) => {
    const parsed = markerDragStartInput.safeParse(payload);
    if (!parsed.success) return invalid('marker:drag-start', parsed.error.issues);
    startMarkerDrag(parsed.data);
    return ok(null);
  });

  handle(IPC.marker.dragTick, () => {
    noteDragSignal();
    return ok(null);
  });

  handle(IPC.marker.dragEnd, () => ok(endMarkerDrag()));

  handle(IPC.marker.setAnchor, (payload) => {
    const parsed = markerAnchorSchema.safeParse(payload);
    if (!parsed.success) return invalid('marker:set-anchor', parsed.error.issues);
    writeMarkerAnchor(parsed.data);
    applyMarkerAnchor(parsed.data);
    return ok(parsed.data);
  });

  handle(IPC.settings.get, (payload) => {
    const key = readSettingKey(payload);
    if (key === null) return invalid('settings:get', 'expected { key: string }');
    if (key === SETTINGS_KEY.app) return ok(appSettings());
    return ok(readRawSetting(key) ?? null);
  });

  handle(IPC.settings.set, (payload) => {
    const parsed = appSettingsPatchSchema.safeParse(payload);
    if (!parsed.success) return invalid('settings:set', parsed.error.issues);

    const previous = appSettings();
    const updated = updateAppSettings(parsed.data);
    if (updated.themeMode !== previous.themeMode || updated.themeId !== previous.themeId) {
      broadcastTheme();
    }
    // Appearance changes resize the marker window, so they cannot wait for the
    // next boot (§9.1); the push also carries the badge and ring.
    if (markerAppearanceChanged(previous, updated)) {
      applyMarkerAppearance(markerAppearanceOf(updated));
    }
    // Edge auto-hide and its distances live in settings too, so the park watcher
    // is re-evaluated on every settings write, not just on appearance changes.
    syncEdgeHideWatch('settings');
    return ok(appSettingsSchema.parse(updated));
  });

  handle(IPC.i18n.setLocale, async (payload) => {
    const parsed = setLocaleInput.safeParse(payload);
    if (!parsed.success) return invalid('i18n:set-locale', parsed.error.issues);

    updateAppSettings({ locale: parsed.data.locale });
    const locale = await initI18n(parsed.data.locale);
    refreshTray();
    broadcastLocale({ locale });
    log('locale switched', locale);
    return ok(locale);
  });

  handle(IPC.smoke.report, (payload) => {
    const parsed = smokeReportInput.safeParse(payload);
    if (parsed.success) smokeRecord(parsed.data.type, parsed.data.detail);
    return ok(null);
  });

  handle(IPC.app.quit, () => {
    app.quit();
    return ok(null);
  });

  // The task domain registers through the same helper, so its payloads go through
  // the same validation and exception guard as everything above.
  for (const { channel, run } of taskChannelHandlers()) handle(channel, run);

  log(`registered ${handlerCount} channels`);
}

function handle(channel: string, handler: Handler): void {
  handlerCount += 1;
  ipcMain.handle(channel, async (_event, payload: unknown) => {
    try {
      return await handler(payload);
    } catch (error) {
      log(`exception on ${channel}`, messageOf(error));
      return fail('INTERNAL', messageOf(error));
    }
  });
}

function readSettingKey(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const key = (payload as { key?: unknown }).key;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

function markerAppearanceChanged(before: AppSettings, after: AppSettings): boolean {
  return JSON.stringify(markerAppearanceOf(before)) !== JSON.stringify(markerAppearanceOf(after));
}
