import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

import {
  REMINDER_POPUP_QUERY_KEY,
  encodeReminderPopupPayload,
} from '@shared/contracts/reminder';
import type { ReminderDuePayload } from '@shared/contracts/reminder';
import { REMINDER_POPUP_SIZE, placeReminderPopup } from '@shared/utils/anchoring';
import type { BootParams, Rect } from '@shared/types/app';
import { createLogger } from '../logger';
import { smokeRecord } from '../platform/smoke';
import { windowMaterialOptions } from '../platform/window-material';
import { loadRenderer } from './load-renderer';
import { getMarkerWindow, onMarkerMoved, revealMarker } from './marker';

const log = createLogger('windows/reminder');

/**
 * The reminder popup's window (docs/FEATURES.md M04).
 *
 * The second half of a two-step delivery, and deliberately **not** the panel: the panel
 * is where the user works, and unfolding it over whatever they were doing is exactly the
 * intrusion a fallback announcement is supposed to avoid. The popup is its own small,
 * frameless, always-on-top window placed beside the marker, one per reminder, so two
 * reminders that come due together are two announcements stacked rather than one window
 * that has to switch between them.
 *
 * It is shown with `showInactive()`: it arrives *because* a notification went unanswered,
 * so stealing the caret would defeat its purpose — the user would be pulled out of the
 * field they were typing into by the very alert that exists to be ignored (M04 D2).
 *
 * Windows are created here and nowhere else; every OS call stays in this layer, which is
 * why the notification layer above it deals in ids rather than in windows (ARCHITECTURE
 * §2 — the service layers never import electron).
 */

/** The popups currently on screen, in the order they were opened, keyed by reminder id. */
const open = new Map<string, BrowserWindow>();

/** Boot parameters, cached at startup: a popup has to be drawn with the active theme. */
let boot: BootParams | null = null;

/**
 * Called once at startup, after the marker exists — the popup is placed from the marker's
 * rectangle, and a drag has to carry every open popup with it (the same follow the panel
 * does, windows/panel.ts).
 */
export function configureReminderWindows(params: BootParams): void {
  boot = params;
  onMarkerMoved(repositionPopups);
}

/**
 * Announces one reminder on screen: creates its popup, places it beside the marker and
 * shows it without focus. The window is closed by {@link closeReminderWindow} when the
 * reminder is answered or when the process quits.
 */
export function showReminderWindow(payload: ReminderDuePayload): void {
  const params = boot;
  if (params === null) return;

  const existing = open.get(payload.id);
  if (existing !== undefined && !existing.isDestroyed()) {
    // Already up: bring it forward rather than drawing a second one for the same
    // instance. The dedup lives in the reminder's own row, but a window is cheap to
    // check here and a duplicate announcement is not something to leave to chance.
    existing.moveTop();
    return;
  }

  const popup = new BrowserWindow({
    width: REMINDER_POPUP_SIZE.width,
    height: REMINDER_POPUP_SIZE.height,
    show: false,
    frame: false,
    // The popup belongs to the same family as the panel and the detail (M07): the
    // material is whatever the OS can draw, and the card decides what shows through.
    ...windowMaterialOptions(params.glass === true),
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Never covered: it is the surface that speaks when the OS notification could not
    // be answered, so it has to be above whatever the user has in front of them.
    alwaysOnTop: true,
    ...(process.platform === 'win32' ? { thickFrame: false } : {}),
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  if (process.platform === 'darwin') {
    popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  popup.setAlwaysOnTop(true);
  popup.on('closed', () => {
    if (open.get(payload.id) === popup) open.delete(payload.id);
  });

  open.set(payload.id, popup);
  placePopup(popup, stackIndexOf(payload.id));
  // The window is placed and sized before it is shown, and only its card animates
  // (reminder.css): no frame of the ease-in touches window bounds (§7, §9.1).
  popup.once('ready-to-show', () => popup.showInactive());

  void loadRenderer(popup, 'reminder', params, {
    [REMINDER_POPUP_QUERY_KEY]: encodeReminderPopupPayload(payload),
  });
  smokeRecord('reminder-popup', { id: payload.id, taskId: payload.taskId, bounds: popup.getBounds() });
  log('reminder popup shown', { id: payload.id, taskId: payload.taskId });
}

/** Takes one popup down — the reminder it stands for has been answered, or is gone. */
export function closeReminderWindow(id: string): void {
  const popup = open.get(id);
  open.delete(id);
  if (popup === undefined || popup.isDestroyed()) return;
  // `destroy` rather than `close`: the popup has no unsaved state and no close handler
  // of its own, and a window that is waiting on a `beforeunload` must not be able to
  // keep an answered reminder on screen.
  popup.destroy();
  log('reminder popup closed', { id });
}

/** Drops every popup, so a quitting process leaves no windows behind. */
export function closeAllReminderWindows(): void {
  for (const popup of open.values()) {
    if (!popup.isDestroyed()) popup.destroy();
  }
  open.clear();
}

/** The popup's position in the stack, which decides where it hangs off the marker. */
function stackIndexOf(id: string): number {
  return Math.max(0, [...open.keys()].indexOf(id));
}

/**
 * Keeps every open popup beside the marker. Called on every marker move, drag frames
 * included, so an open popup travels with the marker it belongs to instead of being left
 * behind pointing at a marker that has moved away.
 */
function repositionPopups(markerBounds: Rect): void {
  const ids = [...open.keys()];
  ids.forEach((id, index) => {
    const popup = open.get(id);
    if (popup === undefined || popup.isDestroyed()) return;
    placePopup(popup, index, markerBounds);
  });
}

/**
 * Places one popup from the marker's rectangle.
 *
 * The rectangle comes from the marker's anchor rather than from `getBounds()` when the
 * marker is parked at a screen edge (a parked marker is mostly off screen, §9.4) — which
 * is why the marker is revealed first, exactly as the panel does when it opens. A caller
 * that already has the rectangle (the drag handler) passes it instead: revealing the
 * marker is a move of its own and must not run on every frame of someone else's drag.
 */
function placePopup(popup: BrowserWindow, index: number, markerBounds?: Rect): void {
  const bounds = markerBounds ?? revealMarker('reminder-popup') ?? liveMarkerBounds();
  if (bounds === null) return;

  const display = screen.getDisplayNearestPoint({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  });
  popup.setBounds(placeReminderPopup(bounds, display.workArea, index));
}

function liveMarkerBounds(): Rect | null {
  const marker = getMarkerWindow();
  if (marker === null || marker.isDestroyed()) return null;
  return marker.getBounds();
}
