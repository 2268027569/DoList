import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

import { IPC } from '@shared/contracts/channels';
import type { MarkerStatePayload } from '@shared/contracts/channels';
import { markerAppearanceOf, markerEdgeHideOf, markerSnapThresholdOf } from '@shared/contracts/settings';
import { TRANSPARENT_WINDOW_BACKGROUND } from '@shared/theme/window-background';
import type { BootParams, MarkerAnchor, MarkerAppearance, Rect } from '@shared/types/app';
import { SNAP_THRESHOLD_PX } from '@shared/utils/anchoring';
import { nextEdgeHideState, parkedRect } from '@shared/utils/edge-hide';
import type { EdgeHideConfig, EdgeHideState } from '@shared/utils/edge-hide';
import { DEFAULT_APPEARANCE } from '@shared/utils/marker-geometry';
import { createLogger } from '../logger';
import { isSmokeEnabled, smokeReady, smokeRecord } from '../platform/smoke';
import { currentMarkerState, SMOKE_MARKER_STATE } from '../services/marker-state';
import { appSettings, readMarkerAnchor, writeMarkerAnchor } from '../services/settings';
import { loadRenderer } from './load-renderer';
import {
  DEFAULT_MARKER_ANCHOR,
  anchorForBounds,
  displayForAnchor,
  markerWindowSize,
  resolveMarkerBounds,
} from './window-state';

const log = createLogger('windows/marker');

/** Drag sampling period. The interval exists only while a drag is in flight (§9.2). */
const DRAG_FRAME_MS = 16;
/** No renderer heartbeat for this long while the cursor keeps moving = button released. */
const DRAG_RELEASE_SILENCE_MS = 600;
/** Hard stop, used when the pointer stops moving too (pointer capture never fires). */
const DRAG_ABORT_SILENCE_MS = 2500;

/**
 * Cursor sampling period while the marker is parked at an edge. The timer only
 * exists in that state — a visible marker costs nothing (§9.4).
 */
const EDGE_HIDE_POLL_MS = 100;

/** Park policy the smoke harness runs with, so the assertions are deterministic. */
const SMOKE_EDGE_HIDE: EdgeHideConfig = { peek: 5, revealDistance: 24, hideDistance: 48 };

interface DragState {
  offsetX: number;
  offsetY: number;
  timer: NodeJS.Timeout;
  lastCursor: { x: number; y: number };
  signalAt: number;
  signalCursor: { x: number; y: number };
  ticks: number;
}

let markerWindow: BrowserWindow | null = null;
let drag: DragState | null = null;
let currentAnchor: MarkerAnchor = DEFAULT_MARKER_ANCHOR;
let currentAppearance: MarkerAppearance = DEFAULT_APPEARANCE;
/** Cursor watcher that parks the marker at an edge; `null` while it is not needed. */
let edgeHideTimer: NodeJS.Timeout | null = null;
let edgeParked = false;
/** The panel is open, so the marker must stay visible — it is the panel's anchor. */
let panelVisible = false;

export function getMarkerWindow(): BrowserWindow | null {
  return markerWindow;
}

export function createMarkerWindow(boot: BootParams): BrowserWindow {
  // The smoke harness always starts from the default anchor and appearance: it
  // drives the same cursor delta every run, and a persisted position or shape
  // would drift the marker off the work area / off the asserted geometry, making
  // the assertion meaningless on the second run.
  const smoke = isSmokeEnabled();
  currentAnchor = smoke ? DEFAULT_MARKER_ANCHOR : (readMarkerAnchor() ?? DEFAULT_MARKER_ANCHOR);
  currentAppearance = smoke ? DEFAULT_APPEARANCE : markerAppearanceOf(appSettings());

  const size = markerWindowSize(currentAppearance);
  const bounds = resolveMarkerBounds(currentAnchor, size);

  // The smoke harness can flip focusability to answer "does the marker still get
  // pointer events without focus?" — the answer is recorded in ARCHITECTURE §9.1.
  const smokeFocusable = process.env['YICHEN_SMOKE_FOCUSABLE'] === '1';

  const window = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: size.width,
    height: size.height,
    frame: false,
    transparent: true,
    backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: smokeFocusable,
    alwaysOnTop: true,
    hasShadow: false,
    // Windows: accept the click without the window ever taking focus.
    acceptFirstMouse: true,
    show: false,
    roundedCorners: false,
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // The OS may hand back a different size than requested (§9.1); recompute the
  // position from what we actually got so the marker is not offset.
  const actual = window.getBounds();
  if (actual.width !== size.width || actual.height !== size.height) {
    const adjusted = resolveMarkerBounds(currentAnchor, {
      width: actual.width,
      height: actual.height,
    });
    window.setBounds(adjusted);
    log('the OS resized the marker window, position recomputed', {
      requested: size,
      actual: { width: actual.width, height: actual.height },
      adjusted: window.getBounds(),
    });
  }

  // Marker sits above full-screen windows on macOS; `screen-saver` is the only
  // level that reliably stays visible there (§9.1).
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setSkipTaskbar(true);
  if (process.platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  window.once('ready-to-show', () => {
    window.showInactive();
    log('marker shown', {
      anchor: currentAnchor,
      appearance: currentAppearance,
      bounds: window.getBounds(),
    });
    // The anchored rectangle, not `getBounds()`: with auto-hide on, the watcher
    // can park the marker before this runs, and a reader of the smoke context
    // wants to know where the marker *lives*, not where it happens to be.
    smokeReady({ markerBounds: bounds, markerAnchor: currentAnchor });
  });

  // The first state push waits for the document: sending before the marker
  // subscribes would drop the appearance and the window would flash its CSS
  // defaults. `dom-ready` fires after the entry has run its first pass.
  window.webContents.once('dom-ready', () => pushMarkerState());

  window.on('closed', () => {
    markerWindow = null;
  });

  markerWindow = window;
  void loadRenderer(window, 'marker', { ...boot, marker: currentAppearance });
  watchDisplayChanges();
  // Someone who left auto-hide on expects the marker to be parked right away.
  // No harness exception here: the smoke script needs this same watcher to park
  // and reveal the marker, and it reaches the sliver before its drag, so starting
  // it at boot keeps the harness on the app's real path (§9.4).
  syncEdgeHideWatch('boot');
  return window;
}

/**
 * Applies a settings-driven appearance: resize the window to the new artwork and
 * tell the renderer to redraw. Called from the settings handler, so a shape or
 * scale change takes effect without a restart.
 */
export function applyMarkerAppearance(appearance: MarkerAppearance): void {
  currentAppearance = appearance;
  if (markerWindow && !markerWindow.isDestroyed()) {
    revealMarker('appearance');
    log('marker appearance applied', { appearance, size: markerWindowSize(appearance) });
  }
  syncEdgeHideWatch('appearance');
  pushMarkerState();
}

/** Recomputes and sends the badge / ring / appearance to the marker renderer. */
export function pushMarkerState(state: MarkerStatePayload = resolveMarkerState()): void {
  if (markerWindow === null || markerWindow.isDestroyed()) return;
  markerWindow.webContents.send(IPC.event.markerState, state);
  smokeRecord('marker-state', { state });
}

function resolveMarkerState(): MarkerStatePayload {
  return isSmokeEnabled() ? SMOKE_MARKER_STATE : currentMarkerState();
}

/** Re-applies an anchor stored from the renderer (`marker:set-anchor`). */
export function applyMarkerAnchor(anchor: MarkerAnchor): void {
  currentAnchor = anchor;
  if (!markerWindow || markerWindow.isDestroyed()) return;
  revealMarker('set-anchor');
  syncEdgeHideWatch('set-anchor');
}

/**
 * Puts the marker back at the position its anchor implies and returns that
 * rectangle. Needed because a parked marker's own bounds are mostly off screen:
 * the anchor, not the live bounds, is what callers such as the panel must use.
 */
export function revealMarker(reason: string): Rect | null {
  const wasParked = edgeParked;
  edgeParked = false;

  const window = markerWindow;
  if (window === null || window.isDestroyed()) return null;

  const bounds = resolveMarkerBounds(currentAnchor, markerWindowSize(currentAppearance));
  const current = window.getBounds();
  const differs =
    current.x !== bounds.x ||
    current.y !== bounds.y ||
    current.width !== bounds.width ||
    current.height !== bounds.height;
  if (!differs) return bounds;

  window.setBounds(bounds);
  if (wasParked) {
    log('marker left the screen edge', { reason, bounds });
    smokeRecord('edge-reveal', { reason, bounds });
  }
  return bounds;
}

/**
 * Starts or stops the park watcher (docs/ARCHITECTURE.md §9.4). Only an edge
 * anchor can hide, and never while the marker is being dragged or while the
 * panel needs it on screen; in every other case the marker is left where the
 * anchor puts it and no timer runs at all.
 */
export function syncEdgeHideWatch(reason: string): void {
  const config = currentEdgeHideConfig();
  const active =
    config !== null && currentAnchor.edge !== 'free' && drag === null && !panelVisible;

  if (!active) {
    stopEdgeHideWatch();
    revealMarker(reason);
    return;
  }
  if (edgeHideTimer !== null) return;

  edgeHideTimer = setInterval(tickEdgeHide, EDGE_HIDE_POLL_MS);
  log('edge hide watch started', { reason, edge: currentAnchor.edge, config });
}

/** Told by the panel window, which shares the screen with the marker (§9.4). */
export function setMarkerPanelVisible(visible: boolean): void {
  if (panelVisible === visible) return;
  panelVisible = visible;
  syncEdgeHideWatch('panel-visibility');
}

/** Park policy from settings, or the fixed harness policy under `YICHEN_SMOKE=1`. */
function currentEdgeHideConfig(): EdgeHideConfig | null {
  return isSmokeEnabled() ? SMOKE_EDGE_HIDE : markerEdgeHideOf(appSettings());
}

function stopEdgeHideWatch(): void {
  if (edgeHideTimer === null) return;
  clearInterval(edgeHideTimer);
  edgeHideTimer = null;
  log('edge hide watch stopped');
}

/**
 * One cursor sample. Both rectangles come from the anchor rather than from
 * `getBounds()`: while parked the live bounds are the off-screen ones, and
 * deciding against those would keep the marker parked forever.
 */
function tickEdgeHide(): void {
  const window = markerWindow;
  const config = currentEdgeHideConfig();
  if (window === null || window.isDestroyed() || config === null) return;

  // The work area of the display the marker is anchored to, not the one under the
  // cursor: a cursor on a second monitor is far away and should park it (§9.4).
  const workArea = displayForAnchor(currentAnchor).workArea;
  const full = resolveMarkerBounds(currentAnchor, markerWindowSize(currentAppearance));
  const previous: EdgeHideState = edgeParked ? 'hidden' : 'shown';
  const next = nextEdgeHideState(
    previous,
    screen.getCursorScreenPoint(),
    full,
    currentAnchor.edge,
    config,
    workArea,
  );
  if (next === previous) return;

  const bounds =
    next === 'hidden' ? parkedRect(full, currentAnchor.edge, config.peek, workArea) : full;
  if (bounds === null) return;

  edgeParked = next === 'hidden';
  window.setBounds(bounds);
  log(edgeParked ? 'marker parked at the screen edge' : 'marker left the screen edge', {
    edge: currentAnchor.edge,
    bounds,
    full,
  });
  smokeRecord(edgeParked ? 'edge-park' : 'edge-reveal', {
    edge: currentAnchor.edge,
    bounds,
    full,
  });
}

/**
 * Starts a drag from the pointer's grab point (its position at `pointerdown`,
 * in screen coordinates). Using the grab point rather than the live cursor keeps
 * the marker under the finger from the very first frame — the renderer only
 * reports the drag once the pointer has already travelled past its click slop.
 */
export function startMarkerDrag(grab: { grabX: number; grabY: number }): void {
  const window = markerWindow;
  if (drag !== null || !window || window.isDestroyed()) return;

  // The drag loop owns the window position from here on, so the park watcher has
  // to let go first — and the marker must be on screen, because the grab offset
  // is measured against the bounds the pointer actually landed on (§9.4).
  stopEdgeHideWatch();
  revealMarker('drag-start');

  const cursor = screen.getCursorScreenPoint();
  const bounds = window.getBounds();
  drag = {
    offsetX: grab.grabX - bounds.x,
    offsetY: grab.grabY - bounds.y,
    lastCursor: cursor,
    signalAt: Date.now(),
    signalCursor: cursor,
    ticks: 0,
    timer: setInterval(() => tickDrag(), DRAG_FRAME_MS),
  };
  log('marker drag started', { grab, bounds });
  smokeRecord('drag-start', {
    grab: { x: grab.grabX, y: grab.grabY },
    bounds,
    offset: { x: drag.offsetX, y: drag.offsetY },
  });
}

/**
 * Heartbeat from the renderer's pointermove handler. The main process reads the
 * OS cursor for smoothness; the heartbeat is proof that the renderer still
 * receives pointer events, which is what tells us the button is still down.
 */
export function noteDragSignal(): void {
  if (drag === null) return;
  drag.signalAt = Date.now();
  drag.signalCursor = screen.getCursorScreenPoint();
  drag.ticks += 1;
}

export function endMarkerDrag(): MarkerAnchor | null {
  const window = markerWindow;
  const state = drag;
  drag = null;
  if (state !== null) clearInterval(state.timer);
  if (state === null || !window || window.isDestroyed()) return null;

  // Where the cursor actually left it, before edge snapping is applied.
  const rawBounds = window.getBounds();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const anchor = anchorForBounds(rawBounds, display, currentSnapThreshold());
  currentAnchor = anchor;
  writeMarkerAnchor(anchor);
  revealMarker('drag-end');
  syncEdgeHideWatch('drag-end');

  log('marker drag ended', { anchor, ticks: state.ticks, snap: currentSnapThreshold() });
  smokeRecord('drag-end', {
    anchor,
    ticks: state.ticks,
    rawBounds,
    bounds: window.getBounds(),
  });
  return anchor;
}

/** Snap distance at drag release: the stored setting, or 0 when snapping is off. */
function currentSnapThreshold(): number {
  return isSmokeEnabled() ? SNAP_THRESHOLD_PX : markerSnapThresholdOf(appSettings());
}

function tickDrag(): void {
  const window = markerWindow;
  const state = drag;
  if (state === null || !window || window.isDestroyed()) return;

  const now = Date.now();
  const cursor = screen.getCursorScreenPoint();
  if (cursor.x !== state.lastCursor.x || cursor.y !== state.lastCursor.y) {
    window.setPosition(
      Math.round(cursor.x - state.offsetX),
      Math.round(cursor.y - state.offsetY),
    );
    state.lastCursor = cursor;
  }

  const silentFor = now - state.signalAt;
  const movedSinceSignal =
    cursor.x !== state.signalCursor.x || cursor.y !== state.signalCursor.y;
  if ((silentFor > DRAG_RELEASE_SILENCE_MS && movedSinceSignal) || silentFor > DRAG_ABORT_SILENCE_MS) {
    log('drag watchdog stopped a stalled drag', { silentFor, ticks: state.ticks });
    endMarkerDrag();
  }
}

/** Keeps the marker inside a work area after resolution / DPI / monitor changes (§9.3). */
function watchDisplayChanges(): void {
  const rehome = (reason: string): void => {
    if (markerWindow === null || markerWindow.isDestroyed() || drag !== null) return;

    const display = displayForAnchor(currentAnchor);
    // The anchor's rectangle, not the live bounds: a parked marker's bounds are
    // deliberately mostly off screen and would look like a stray marker (§9.4).
    const bounds = resolveMarkerBounds(currentAnchor, markerWindowSize(currentAppearance));
    const visible = screen.getAllDisplays().some((candidate) => {
      const area = candidate.workArea;
      return (
        bounds.x + bounds.width > area.x &&
        bounds.y + bounds.height > area.y &&
        bounds.x < area.x + area.width &&
        bounds.y < area.y + area.height
      );
    });
    if (visible && String(display.id) === currentAnchor.displayId) return;

    const anchor = anchorForBounds(bounds, display);
    currentAnchor = anchor;
    writeMarkerAnchor(anchor);
    revealMarker('display-change');
    syncEdgeHideWatch('display-change');
    log(`display change (${reason}) re-homed the marker`, { anchor });
    markerWindow.webContents.send(IPC.event.markerAnchorChanged, { anchor, edge: anchor.edge });
  };

  screen.on('display-added', () => rehome('display-added'));
  screen.on('display-removed', () => rehome('display-removed'));
  screen.on('display-metrics-changed', () => rehome('display-metrics-changed'));
}
