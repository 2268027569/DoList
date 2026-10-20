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
import { expandPanel, focusPanel, getPanelWindow, onPanelHidden, onPanelShown, panelStateOf, setPanelHeld } from './panel';

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

/**
 * A window that has already loaded the detail page and is waiting for its first task.
 *
 * The page load — a renderer process, i18n boot, React, the stylesheet, and in dev the
 * module graph — is the expensive half of opening, and none of it depends on *which*
 * task is being opened. Doing it in the click was why the first open stayed slow while
 * switching rows became instant. So it is done on idle instead: at startup, and again
 * whenever the panel comes on screen (the user is browsing the list at that moment).
 */
let warm: BrowserWindow | null = null;
/** True once the warm window has painted, i.e. its listener is registered. */
let warmReady = false;
/** Pending "warm after the panel has finished expanding" timer. */
let warmTimer: NodeJS.Timeout | null = null;

/**
 * How long after the panel appears the warm window is loaded.
 *
 * Not in the same tick: the panel is expanding (a 200ms compositor transition) and a
 * second renderer coming up in dev competes with it for the same CPU, which shows as a
 * stutter in the one animation the user is watching. A quarter of a second later the
 * animation is done and the list is what the user is reading — the idle moment.
 */
const WARM_DELAY_MS = 260;

/**
 * How long after startup the first warm window is loaded.
 *
 * Startup is the one moment the app is visibly arriving (marker, tray, shortcuts), and a
 * second renderer booting in dev competes with all of it. A second later those are done
 * and the process is idle — still well before the panel is likely to have been opened.
 */
const STARTUP_WARM_DELAY_MS = 1200;

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
  onPanelHidden(() => {
    clearWarmTimer();
    closeDetailWindow();
    discardWarm();
  });
  // Shown / hidden is the panel's own working cycle, so the warm window follows it: one
  // is loaded while the user is looking at the list, and none is kept once the list (and
  // therefore the detail's footing) is gone.
  onPanelShown(schedulePrewarm);
  // The startup warm is the only one that can make the *first* click instant, so it is
  // scheduled rather than run here — see STARTUP_WARM_DELAY_MS.
  schedulePrewarm(STARTUP_WARM_DELAY_MS);
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

  const adopted = takeWarm();
  const window = adopted?.window ?? createWindow(taskId);
  open.set(taskId, window);
  placeDetail(window);
  // Sized and placed before it is shown; only the card inside it animates (§7, §9.1).
  const requestedAt = Date.now();
  const reveal = (): void => {
    window.show();
    window.focus();
    window.moveTop();
    // How long the open took, from the click to the first paint. Worth a line in the
    // log: it is the measure that says whether the warm window did its job.
    log('detail window ready', {
      taskId,
      ms: Date.now() - requestedAt,
      warm: adopted !== null,
    });
  };

  if (adopted === null) {
    window.once('ready-to-show', reveal);
    void loadRenderer(window, 'detail', params, { [DETAIL_TASK_QUERY_KEY]: taskId });
  } else {
    // The page is already loaded, so the only thing left is to name the row. Painting
    // may still be a moment away when the panel was *just* shown and the warm window was
    // born on that same event; in that case this waits for the first paint, exactly like
    // a cold open — the warm window was simply created a few milliseconds earlier.
    const openTask = (): void => {
      window.webContents.send(IPC.event.detailOpen, { taskId });
      reveal();
    };
    if (adopted.ready) openTask();
    else window.once('ready-to-show', openTask);
  }
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
  const window = buildWindow();
  attachLifecycle(window);
  log('detail window created', { taskId });
  return window;
}

/**
 * Warms once the panel has settled (`WARM_DELAY_MS`), rather than inside the event that
 * is still animating it.
 */
function schedulePrewarm(delayMs: number = WARM_DELAY_MS): void {
  if (warmTimer !== null || isSmokeEnabled()) return;
  const fromShow = delayMs === WARM_DELAY_MS;
  warmTimer = setTimeout(() => {
    warmTimer = null;
    // The panel may have folded away in the meantime, and a warm window with no list to
    // lean on would only be memory: the hide already asked for none. (The startup warm
    // has no such list to wait for — it warms ahead of the first open.)
    if (fromShow && panelStateOf() === 'hidden') return;
    prewarmDetailWindow();
  }, delayMs);
}

function clearWarmTimer(): void {
  if (warmTimer === null) return;
  clearTimeout(warmTimer);
  warmTimer = null;
}

/**
 * Loads a detail page now and keeps the window hidden until a task is clicked.
 *
 * Deliberately skipped under the harness: two windows would then share the detail
 * URL, and attaching "the detail" would no longer mean one window. The smoke suite
 * measures the cold path, which is what the harness can reason about.
 */
function prewarmDetailWindow(): void {
  const params = boot;
  if (params === null || isSmokeEnabled()) return;
  if (warm !== null && !warm.isDestroyed()) return;
  // A open detail already has its page loaded; there is nothing a second one would save.
  if (open.size > 0) return;

  const window = buildWindow();
  warm = window;
  warmReady = false;
  window.once('ready-to-show', () => {
    if (warm === window) warmReady = true;
  });
  window.on('closed', () => {
    if (warm !== window) return;
    warm = null;
    warmReady = false;
  });
  // The panel can fold away (or the app can quit) while this page is still loading, and
  // `loadURL` rejects on a window that was destroyed under it. That is a normal end for
  // a warm window — it never held anything — so it is not reported as a failure.
  void loadRenderer(window, 'detail', params).catch(() => undefined);
  log('detail window warmed');
}

/** Hands the warmed window over, or `null` when there is none to hand over. */
function takeWarm(): { window: BrowserWindow; ready: boolean } | null {
  const window = warm;
  warm = null;
  if (window === null || window.isDestroyed()) {
    warmReady = false;
    return null;
  }
  clearWarmTimer();
  // The panel may have been resized since this window was warmed; the pair is drawn at
  // one size, so the window takes the current one before it is placed and shown.
  const size = detailSize();
  window.setSize(size.width, size.height);
  const ready = warmReady;
  warmReady = false;
  // From here on it is an ordinary detail window, so it gets the ordinary bookkeeping
  // (forget the row, hand the panel its focus back, release the hold) as well.
  attachLifecycle(window);
  return { window, ready };
}

/** One warm window at most, and none once the panel it leans on is gone. */
function discardWarm(): void {
  const window = warm;
  warm = null;
  warmReady = false;
  if (window !== null && !window.isDestroyed()) window.destroy();
}

/** The size the detail shares with the panel (the harness fixes it, see buildWindow). */
function detailSize(): Size {
  return isSmokeEnabled() ? PANEL_SIZE : clampPanelSize(panelSizeOf(appSettings()));
}

/** The window itself, before anything is said about which task it holds. */
function buildWindow(): BrowserWindow {
  // The harness starts from the default size, like the panel does and for the same
  // reason: a size persisted by the last run must not decide what this run measures.
  const size = detailSize();

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
  return window;
}

/**
 * The bookkeeping a window carries once a task is open in it.
 *
 * Attached late — not at construction — because a warm window is built before it holds
 * anything: until a click hands it a task there is no row to forget and no hold of the
 * panel's to release.
 */
function attachLifecycle(window: BrowserWindow): void {
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
