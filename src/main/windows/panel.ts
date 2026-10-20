import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

import { IPC } from '@shared/contracts/channels';
import { panelSizeOf } from '@shared/contracts/settings';
import { placePanel, snapToWorkArea } from '@shared/utils/anchoring';
import { clampPanelSize, PANEL_SIZE } from '@shared/utils/panel-geometry';
import type { BootParams, PanelState, Rect } from '@shared/types/app';
import type { Size } from '@shared/utils/marker-geometry';
import { createLogger } from '../logger';
import { isSmokeEnabled, smokeRecord } from '../platform/smoke';
import { windowMaterialOptions } from '../platform/window-material';
import { appSettings, updateAppSettings } from '../services/settings';
import { loadRenderer } from './load-renderer';
import { getMarkerWindow, onMarkerMoved, revealMarker, setMarkerPanelVisible } from './marker';

const log = createLogger('windows/panel');

/** Panel animation lengths, inside the 180–220ms window of FEATURES M01. */
const EXPAND_DURATION_MS = 200;
const COLLAPSE_DURATION_MS = 180;

/** Blur -> collapse delay, so clicking inside the panel does not close it (§3). */
const COLLAPSE_DELAY_MS = 150;
/** Safety net if the renderer never reports its collapse animation as finished. */
const COLLAPSE_FALLBACK_MS = 400;
/** How long the resize handle must be still before the new size is written. */
const PANEL_SIZE_PERSIST_DEBOUNCE_MS = 250;
/** How long the marker must be still before a follow is reported (see followMarker). */
const FOLLOW_REPORT_DELAY_MS = 150;

let panelWindow: BrowserWindow | null = null;
let panelState: PanelState = 'hidden';
let collapseTimer: NodeJS.Timeout | null = null;
let fallbackTimer: NodeJS.Timeout | null = null;
let persistSizeTimer: NodeJS.Timeout | null = null;
/** Latest follow waiting to be reported, and the timer that will report it. */
let pendingFollow: { markerBounds: Rect; panelBounds: Rect } | null = null;
let followReportTimer: NodeJS.Timeout | null = null;

/**
 * Set while another window is using the panel as its footing and therefore holding it
 * up (M02 D6). The detail window is opened *beside* the panel, and taking the focus is
 * how it opens — so the blur handler below cannot be trusted alone: without this the
 * list would be gone the moment the user asked to edit a row, which is the one thing
 * the separate window exists to avoid.
 *
 * It is a flag rather than a counter because there is a single holder and it either
 * holds or does not; releasing it re-runs the collapse decision, which is what makes
 * "close the detail while the pointer is on the panel" behave correctly.
 */
let held = false;

/** Listeners for "the panel left the screen", which is when a dependent window gives up. */
const hiddenListeners = new Set<() => void>();

/**
 * Listeners for "the panel came on screen". The detail window is warmed on this signal
 * rather than on the click that opens it: the panel is shown when the user is about to
 * pick a row, which is exactly the idle moment the page load can be spent in.
 */
const shownListeners = new Set<() => void>();

export function getPanelWindow(): BrowserWindow | null {
  return panelWindow;
}

export function panelStateOf(): PanelState {
  return panelState;
}

/**
 * Holds the panel open while another window of ours is taking the focus (M02 D6).
 *
 * Only the detail window calls this, and only for as long as it is open. Releasing the
 * hold re-runs the collapse decision rather than leaving it to the next blur event,
 * because the pointer can be back on the panel by then: the answer to "should this
 * still be up?" is asked of the panel's live focus, not of who let go of it last.
 */
export function setPanelHeld(next: boolean): void {
  if (held === next) return;
  held = next;
  if (held) cancelCollapse();
  else scheduleCollapse();
}

/**
 * Gives the panel the keyboard back, for when the window that borrowed it (the detail
 * beside it) is gone.
 *
 * Without this the hold is released onto a blurred panel: the collapse timer asks
 * `isFocused()` a moment later, gets no for an answer, and the list disappears the
 * instant the user finishes editing — the opposite of what the separate window is for.
 */
export function focusPanel(): void {
  const window = panelWindow;
  if (window === null || window.isDestroyed() || !window.isVisible()) return;
  window.focus();
}

/** Runs `listener` whenever the panel leaves the screen, whatever asked it to. */
export function onPanelHidden(listener: () => void): void {
  hiddenListeners.add(listener);
}

/** Runs `listener` whenever the panel is brought on screen (windows/detail.ts warms). */
export function onPanelShown(listener: () => void): void {
  shownListeners.add(listener);
}

export function createPanelWindow(boot: BootParams): BrowserWindow {
  // The smoke harness always starts from the default size, for the same reason it
  // starts from the default anchor: a persisted size would make the run depend on
  // what the last run did.
  const smoke = isSmokeEnabled();
  const size = smoke ? PANEL_SIZE : clampPanelSize(panelSizeOf(appSettings()));

  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    show: false,
    frame: false,
    // Glass when the OS can draw a backdrop, the old transparent window otherwise
    // (platform/window-material.ts). The card fills the window in the glass case, so
    // the window is also what gives it its rounded corners.
    ...windowMaterialOptions(boot.glass === true),
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Always on top, with no switch to turn it off: the panel is reached by the
    // marker and the shortcuts, and it would be pointless if another window could
    // cover it (docs/ARCHITECTURE.md §9.9).
    alwaysOnTop: true,
    ...(process.platform === 'win32' ? { thickFrame: false } : {}),
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (process.platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  window.setAlwaysOnTop(true);

  window.on('blur', () => scheduleCollapse());
  window.on('focus', () => cancelCollapse());
  window.on('closed', () => {
    panelWindow = null;
    panelState = 'hidden';
  });

  panelWindow = window;
  // The marker is the panel's anchor, so a drag has to drag the panel along —
  // and re-derive where it opens, which is what flips it to the other side when
  // the user pushes the marker across an edge mid-drag.
  onMarkerMoved(followMarker);
  void loadRenderer(window, 'panel', boot);
  log('panel created (hidden)', { alwaysOnTop: true });
  return window;
}

/** Marker click / tray / shortcut: place the panel next to the marker and show it. */
export function expandPanel(): PanelState {
  const window = panelWindow;
  const marker = getMarkerWindow();
  if (window === null || window.isDestroyed()) return panelState;
  if (marker === null || marker.isDestroyed()) return panelState;

  cancelCollapse();
  // A marker parked at a screen edge is mostly off screen: the panel is placed
  // from the marker's anchor, and the marker itself is brought back out so the
  // panel is not opening next to a 5px sliver (§9.4). The rectangle `revealMarker`
  // returns is the anchored one, which is what `placePanel` needs — the live
  // bounds would still be the parked ones.
  const markerBounds = revealMarker('panel-expand') ?? marker.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: markerBounds.x + markerBounds.width / 2,
    y: markerBounds.y + markerBounds.height / 2,
  });

  window.setBounds(placePanel(markerBounds, currentPanelSize(window), display.workArea));
  if (!window.isVisible()) window.show();
  window.focus();
  window.moveTop();

  panelState = 'shown';
  setMarkerPanelVisible(true);
  for (const listener of shownListeners) listener();
  sendToPanel(IPC.event.panelState, { state: 'expanding', durationMs: EXPAND_DURATION_MS });
  // Under the harness the caret always goes to quick-add, so a keyboard run can
  // create a task without first aiming at the field. A real run only does that on
  // the quick-add shortcut below — a plain click should let the user browse.
  if (isSmokeEnabled()) sendToPanel(IPC.event.quickAddFocus, null);
  log('panel expanded', { markerBounds, panelBounds: window.getBounds() });
  smokeRecord('panel-expanded', { panelBounds: window.getBounds() });
  return panelState;
}

/**
 * The quick-add shortcut (M02-PLAN §6): open the panel and hand the caret to its
 * field. Unlike `togglePanel` it never closes the panel — pressing the shortcut
 * while browsing should ask to add a task, not hide the window.
 */
export function expandPanelForQuickAdd(): PanelState {
  const state = expandPanel();
  // The panel renderer is mounted from boot (the window is created hidden at
  // startup), so the event lands whether or not this is the first open.
  sendToPanel(IPC.event.quickAddFocus, null);
  return state;
}

/**
 * The app menu's 今日 item (M02 S8): open the panel and ask it to show what is due
 * by the end of today.
 *
 * The view lives in the panel renderer, so this is a request rather than a query
 * the main process runs — and the panel switching it by hand and the menu asking
 * for it are the same state, which is why nothing about "who asked" is stored.
 */
export function expandPanelForToday(): PanelState {
  const state = expandPanel();
  sendToPanel(IPC.event.panelView, { view: 'today' });
  return state;
}

/**
 * A reminder notification was clicked (M04): open the panel on that task.
 *
 * It expands like any other open — it takes focus, because the user just clicked the
 * app's notification and the thing they asked for is the task in front of them.
 */
export function expandPanelForTask(taskId: string): PanelState {
  const state = expandPanel();
  sendToPanel(IPC.event.taskFocus, { taskId });
  return state;
}

/**
 * Keeps an open panel attached while the marker is dragged (docs/FEATURES.md M01
 * "全桌面拖拽"). Every drag frame reports the marker's new rectangle, and the
 * panel is re-placed from it — re-placed rather than shifted by the same delta,
 * so a marker crossing an edge mid-drag turns the panel around instead of
 * leaving it hanging on the wrong side.
 *
 * No collapse is cancelled here: the marker window is `focusable: false`, so
 * grabbing it never takes focus off the panel and the blur timer never starts.
 */
export function followMarker(markerBounds: Rect): void {
  const window = panelWindow;
  if (window === null || window.isDestroyed() || !window.isVisible()) return;

  const display = screen.getDisplayNearestPoint({
    x: markerBounds.x + markerBounds.width / 2,
    y: markerBounds.y + markerBounds.height / 2,
  });
  const next = placePanel(markerBounds, currentPanelSize(window), display.workArea);
  const current = window.getBounds();
  if (next.x === current.x && next.y === current.y) return;

  window.setBounds(next);
  scheduleFollowReport(markerBounds, next);
}

/**
 * Reports the follow once a burst of movement has stopped, rather than on every
 * frame. The harness asserts that the panel ended up attached to where the drag
 * left the marker, so what it needs is the settled rectangle — and writing the
 * status file 30 times mid-drag would put a synchronous file write in the middle
 * of the frames whose timing the drag assertions measure.
 */
function scheduleFollowReport(markerBounds: Rect, panelBounds: Rect): void {
  pendingFollow = { markerBounds, panelBounds };
  if (followReportTimer !== null) clearTimeout(followReportTimer);
  followReportTimer = setTimeout(() => {
    followReportTimer = null;
    if (pendingFollow === null) return;
    smokeRecord('panel-followed', pendingFollow);
    pendingFollow = null;
  }, FOLLOW_REPORT_DELAY_MS);
}

export function collapsePanel(): void {
  const window = panelWindow;
  if (window === null || window.isDestroyed() || !window.isVisible()) {
    panelState = 'hidden';
    return;
  }
  if (panelState === 'collapsing') return;

  panelState = 'collapsing';
  sendToPanel(IPC.event.panelState, { state: 'collapsing', durationMs: COLLAPSE_DURATION_MS });
  cancelFallback();
  fallbackTimer = setTimeout(() => {
    log('collapse animation was not acknowledged, hiding anyway');
    hidePanel();
  }, COLLAPSE_FALLBACK_MS);
}

/** Called from the renderer once its collapse animation completed (`window:collapse-finished`). */
export function finishCollapse(): void {
  if (panelState !== 'collapsing') return;
  hidePanel();
}

export function togglePanel(): PanelState {
  if (panelState === 'hidden') return expandPanel();
  collapsePanel();
  return panelState;
}

/**
 * Applies a size reported by the renderer's resize handle (docs/FEATURES.md M01
 * "面板形态"). The top-left corner stays put — the panel's *position* is not
 * stored at all: `placePanel` re-derives it from the marker on every expand, so
 * only the size is worth remembering.
 *
 * Returns the size that was actually applied, which may be smaller than requested
 * because it was clamped to the size range or to the work area.
 */
export function resizePanel(target: Size): Size {
  const window = panelWindow;
  if (window === null || window.isDestroyed()) return clampPanelSize(target);

  const bounds = window.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  });
  const wanted = { x: bounds.x, y: bounds.y, ...clampPanelSize(target) };
  // A zero threshold only clamps back inside the work area, which is exactly what
  // growing a panel towards a screen edge needs (no edge snapping here — the panel
  // is not free-floating, it is anchored to the marker).
  const clamped = snapToWorkArea({ x: wanted.x, y: wanted.y, width: wanted.width, height: wanted.height }, display.workArea, 0);
  const applied: Size = { width: wanted.width, height: wanted.height };
  window.setBounds({
    x: Math.round(clamped.x),
    y: Math.round(clamped.y),
    width: applied.width,
    height: applied.height,
  });

  schedulePersistPanelSize(applied);
  return applied;
}

/** The panel's live size, or the stored one before the window exists. */
function currentPanelSize(window: BrowserWindow): Size {
  const bounds = window.getBounds();
  return { width: bounds.width, height: bounds.height };
}

function schedulePersistPanelSize(size: Size): void {
  if (persistSizeTimer !== null) clearTimeout(persistSizeTimer);
  persistSizeTimer = setTimeout(() => {
    persistSizeTimer = null;
    updateAppSettings({ panelWidth: size.width, panelHeight: size.height });
    log('panel size persisted', size);
  }, PANEL_SIZE_PERSIST_DEBOUNCE_MS);
}

function hidePanel(): void {
  cancelFallback();
  const window = panelWindow;
  if (window !== null && !window.isDestroyed()) window.hide();
  panelState = 'hidden';
  setMarkerPanelVisible(false);
  log('panel hidden');
  smokeRecord('panel-hidden');
  // Whoever was leaning on the panel has lost its footing: the detail window beside it
  // would be editing a task with nothing to go back to, so it closes with it.
  for (const listener of hiddenListeners) listener();
}

function scheduleCollapse(): void {
  cancelCollapse();
  // Held: the focus that just left is another window of ours, and the panel it is
  // working beside is meant to stay exactly where it is (M02 D6).
  if (held) return;
  collapseTimer = setTimeout(() => {
    collapseTimer = null;
    const window = panelWindow;
    if (window === null || window.isDestroyed() || window.isFocused()) return;
    collapsePanel();
  }, COLLAPSE_DELAY_MS);
}

function cancelCollapse(): void {
  if (collapseTimer === null) return;
  clearTimeout(collapseTimer);
  collapseTimer = null;
}

function cancelFallback(): void {
  if (fallbackTimer === null) return;
  clearTimeout(fallbackTimer);
  fallbackTimer = null;
}

function sendToPanel(channel: string, payload: unknown): void {
  const window = panelWindow;
  if (window === null || window.isDestroyed()) return;
  window.webContents.send(channel, payload);
}
