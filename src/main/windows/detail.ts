import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

import { IPC } from '@shared/contracts/channels';
import { DETAIL_TASK_QUERY_KEY } from '@shared/contracts/detail';
import { panelSizeOf } from '@shared/contracts/settings';
import { TRANSPARENT_WINDOW_BACKGROUND } from '@shared/theme/window-background';
import { placePanel, placeTaskDetail } from '@shared/utils/anchoring';
import { clampPanelSize, PANEL_SIZE } from '@shared/utils/panel-geometry';
import type { BootParams, Rect } from '@shared/types/app';
import type { Size } from '@shared/utils/marker-geometry';
import { createLogger } from '../logger';
import { isSmokeEnabled, smokeRecord } from '../platform/smoke';
import { appSettings } from '../services/settings';
import { loadRenderer } from './load-renderer';
import { onMarkerMoved } from './marker';
import { expandPanel, focusPanel, getPanelWindow, onPanelHidden, panelStateOf, setPanelHeld } from './panel';

const log = createLogger('windows/detail');

/**
 * The task detail window (docs/FEATURES.md M02 D6).
 *
 * It used to be a page of the panel that replaced the list; it is now a window of its
 * own that opens *beside* the panel. The reason is the list: the panel is 320–640 DIP
 * wide, so a form inside it leaves no room for a list — and the list is where the user
 * picks the next task, so a detail that displaces it makes every comparison a trip out
 * and back. Two windows keep both: the list stays on screen *and* clickable while a
 * task is open, and clicking another row moves the detail to it.
 *
 * It is built the way the reminder popup is (windows/reminder.ts): frameless,
 * transparent, always on top, deduped by the task it shows, and sized like the panel so
 * the pair read as one assembly. It is the one window of ours that takes focus, because
 * the user asked to edit and the caret belongs in the form — which is why the panel has
 * to be *held* up while it is open (setPanelHeld, windows/panel.ts).
 *
 * Only one detail is open at a time: the user edits one task at a time, and two forms
 * over one list would be two answers to the same question.
 */

/** The open detail, keyed by the task it shows. At most one entry. */
const open = new Map<string, BrowserWindow>();

/** Boot parameters, cached at startup: a detail window is drawn with the active theme. */
let boot: BootParams | null = null;

/**
 * Called once at startup, after the marker and the panel exist: the window is placed
 * from the panel's rectangle, and it has to leave with the panel it leans on.
 */
export function configureDetailWindows(params: BootParams): void {
  boot = params;
  // The detail hangs off the panel, so it follows the panel's footing: a marker drag
  // moves the panel, and a detail left behind would sit beside nothing.
  onMarkerMoved(repositionDetail);
  onPanelHidden(closeDetailWindow);
}

/**
 * Opens the detail on one task: creates the window the first time, and from then on
 * re-points the one window at the new task (reloading it with the new id in its query
 * string) or brings it forward when it is already showing that task.
 */
export function showDetailWindow(taskId: string): void {
  const params = boot;
  if (params === null) return;

  // The panel is the detail's footing, so it is expanded here rather than assumed:
  // there has to be a list to open beside. Its focus is then handed to the detail;
  // the hold keeps it from folding away on the way.
  if (panelStateOf() === 'hidden') expandPanel();
  setPanelHeld(true);

  const existing = [...open.entries()][0];
  if (existing !== undefined) {
    const [id, window] = existing;
    if (window.isDestroyed()) {
      open.delete(id);
    } else {
      if (id !== taskId) {
        // A different task. The window stays where it is (the user may have moved it),
        // and it is *told* which row to show rather than reloaded: a reload throws away
        // the whole renderer — i18n boot, React mount, the CSS — to change one row, and
        // it showed as a blank card between clicks. The renderer is the same page for
        // every task; only the id differs.
        //
        // The one exception is a window that is still loading its first page: it has no
        // listener yet, so an event would be dropped. Reloading it with the new id is
        // both safe and correct — the first paint then belongs to the task clicked last.
        if (window.webContents.isLoading()) {
          void loadRenderer(window, 'detail', params, { [DETAIL_TASK_QUERY_KEY]: taskId });
        } else {
          window.webContents.send(IPC.event.detailOpen, { taskId });
        }
        open.delete(id);
        open.set(taskId, window);
        log('detail window re-pointed', { taskId });
      }
      window.show();
      window.focus();
      window.moveTop();
      return;
    }
  }

  const window = createWindow(taskId);
  open.set(taskId, window);
  placeDetail(window);
  // Sized and placed before it is shown; only the card inside it animates (§7, §9.1).
  const requestedAt = Date.now();
  window.once('ready-to-show', () => {
    window.show();
    window.focus();
    // How long the first open took, from the click to the first paint. Worth a line in
    // the log: the page load is the only part of this path that varies by machine, and
    // a recurrence of "it opens slowly" should be answerable from the log alone.
    log('detail window ready', { taskId, ms: Date.now() - requestedAt });
  });
  void loadRenderer(window, 'detail', params, { [DETAIL_TASK_QUERY_KEY]: taskId });
  log('detail window shown', { taskId, bounds: window.getBounds() });
  smokeRecord('detail-window-opened', {
    taskId,
    bounds: window.getBounds(),
    panelBounds: getPanelWindow()?.getBounds() ?? null,
  });
}

/**
 * The open detail, if any. At most one window, so at most one answer — the same
 * discipline `getPanelWindow` follows for the list.
 */
export function getDetailWindow(): BrowserWindow | null {
  const entry = [...open.values()][0];
  return entry === undefined || entry.isDestroyed() ? null : entry;
}

/**
 * Takes the detail down — its close button, Escape in the renderer, or the panel going
 * away underneath it. It takes no task id on purpose: whatever is open is what has lost
 * its footing, and asking the caller to name it would only make the two places that
 * close it separately responsible for being right about which task that is.
 */
export function closeDetailWindow(): void {
  if (open.size === 0) return;
  // `destroy()` fires `closed` synchronously, and that handler is where the window is
  // forgotten and the panel released — so there is nothing else to undo here.
  for (const window of open.values()) {
    if (!window.isDestroyed()) window.destroy();
  }
  open.clear();
}

/** Same shape as the panel window, one per task at most. */
function createWindow(taskId: string): BrowserWindow {
  // The harness starts from the default size, like the panel does and for the same
  // reason: a size persisted by the last run must not decide what this run measures.
  const size = isSmokeEnabled() ? PANEL_SIZE : clampPanelSize(panelSizeOf(appSettings()));

  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    roundedCorners: false,
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
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  window.setAlwaysOnTop(true);

  // `destroy()` (which is how this window is taken down) does not emit `close`, so the
  // bookkeeping lives on `closed` alone — the one event every way out reports.
  window.on('closed', () => {
    // Which task it was last showing, read from the map rather than from the argument:
    // the same window is re-pointed at another task, and the one that closed is
    // whichever it was showing at the end.
    let closedId: string | null = null;
    for (const [id, held] of [...open.entries()]) {
      if (held === window) {
        open.delete(id);
        closedId = id;
      }
    }
    if (open.size === 0) {
      // The panel lent this window its focus; the list gets it back before the hold is
      // released, so the release finds a focused panel and leaves it up (windows/panel.ts).
      focusPanel();
      setPanelHeld(false);
    }
    log('detail window closed', { taskId: closedId });
    // The harness cannot watch a window disappear, so the main process says so; its
    // task id is what proves the right one went.
    smokeRecord('detail-closed', { taskId: closedId });
  });

  log('detail window created', { taskId, size });
  return window;
}

/** Places the window beside the panel, on the side the panel is not docked to. */
function placeDetail(window: BrowserWindow): void {
  const panelRect = panelFooting();
  if (panelRect === null) return;

  const display = screen.getDisplayNearestPoint({
    x: panelRect.x + panelRect.width / 2,
    y: panelRect.y + panelRect.height / 2,
  });
  const size = sizeOf(window);
  window.setBounds(placeTaskDetail(panelRect, size, display.workArea));
}

/**
 * Keeps the detail attached while the panel travels with a marker drag.
 *
 * The panel's rectangle is *re-derived* from the marker rather than read off the window:
 * both windows are re-placed on the same event, so reading the panel's live bounds would
 * depend on which of the two listeners the event bus happened to call first.
 */
function repositionDetail(markerBounds: Rect): void {
  const panel = getPanelWindow();
  if (panel === null || panel.isDestroyed() || !panel.isVisible()) return;

  const size = sizeOf(panel);
  const display = screen.getDisplayNearestPoint({
    x: markerBounds.x + markerBounds.width / 2,
    y: markerBounds.y + markerBounds.height / 2,
  });
  const panelRect = placePanel(markerBounds, size, display.workArea);

  for (const window of open.values()) {
    if (window.isDestroyed()) continue;
    window.setBounds(placeTaskDetail(panelRect, sizeOf(window), display.workArea));
  }
}

/**
 * The rectangle the detail is measured against: the panel's live bounds. It exists from
 * startup in the running app, so the `null` branch is only there to keep the arithmetic
 * total rather than to serve a real path.
 */
function panelFooting(): Rect | null {
  const panel = getPanelWindow();
  if (panel === null || panel.isDestroyed()) return null;
  return panel.getBounds();
}

function sizeOf(window: BrowserWindow): Size {
  const bounds = window.getBounds();
  return { width: bounds.width, height: bounds.height };
}
