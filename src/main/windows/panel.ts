import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

import { IPC } from '@shared/contracts/channels';
import type { ReminderDuePayload } from '@shared/contracts/reminder';
import { panelSizeOf } from '@shared/contracts/settings';
import { TRANSPARENT_WINDOW_BACKGROUND } from '@shared/theme/window-background';
import { placePanel, snapToWorkArea } from '@shared/utils/anchoring';
import { clampPanelSize, PANEL_SIZE } from '@shared/utils/panel-geometry';
import type { BootParams, PanelState, Rect } from '@shared/types/app';
import type { Size } from '@shared/utils/marker-geometry';
import { createLogger } from '../logger';
import { isSmokeEnabled, smokeRecord } from '../platform/smoke';
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

export function getPanelWindow(): BrowserWindow | null {
  return panelWindow;
}

export function panelStateOf(): PanelState {
  return panelState;
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
    transparent: true,
    backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Always on top, with no switch to turn it off: the panel is reached by the
    // marker and the shortcuts, and it would be pointless if another window could
    // cover it (docs/ARCHITECTURE.md §9.9).
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
 * A reminder's in-app card (M04): open the panel onto the card, **without** taking
 * focus.
 *
 * The card is what speaks when the OS notification went unanswered, so the panel has
 * to be up for it to be read — but pulling focus would take the caret out of whatever
 * the user is typing into, which is exactly the intrusion the two-step delivery exists
 * to avoid. It is not focused, so the blur timer that normally collapses the panel
 * never starts either: nothing was taken, so nothing has to be given back.
 */
export function expandPanelForReminder(payload: ReminderDuePayload): PanelState {
  const window = panelWindow;
  const marker = getMarkerWindow();
  if (window === null || window.isDestroyed() || marker === null || marker.isDestroyed()) {
    return panelState;
  }

  cancelCollapse();
  // Same placement path as a click, minus the `focus()` and the `moveTop()` that
  // follow it: the rectangle comes from the marker's anchor, not its live bounds
  // (§9.4), so a marker parked at an edge still opens the panel where it belongs.
  const markerBounds = revealMarker('panel-expand') ?? marker.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: markerBounds.x + markerBounds.width / 2,
    y: markerBounds.y + markerBounds.height / 2,
  });
  window.setBounds(placePanel(markerBounds, currentPanelSize(window), display.workArea));
  if (!window.isVisible()) window.show();

  panelState = 'shown';
  setMarkerPanelVisible(true);
  sendToPanel(IPC.event.panelState, { state: 'expanding', durationMs: EXPAND_DURATION_MS });
  sendToPanel(IPC.event.reminderDue, payload);
  log('panel expanded for a reminder', { reminderId: payload.id, taskId: payload.taskId });
  return panelState;
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
}

function scheduleCollapse(): void {
  cancelCollapse();
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
