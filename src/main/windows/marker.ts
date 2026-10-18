import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

import { IPC } from '@shared/contracts/channels';
import { TRANSPARENT_WINDOW_BACKGROUND } from '@shared/theme/window-background';
import type { BootParams, MarkerAnchor, Rect } from '@shared/types/app';
import { createLogger } from '../logger';
import { isSmokeEnabled, smokeReady, smokeRecord } from '../platform/smoke';
import { readMarkerAnchor, writeMarkerAnchor } from '../services/settings';
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

export function getMarkerWindow(): BrowserWindow | null {
  return markerWindow;
}

export function createMarkerWindow(boot: BootParams): BrowserWindow {
  // The smoke harness always starts from the default anchor: it drives the same
  // cursor delta every run, and a persisted position would drift the marker off
  // the work area on the second run, making the geometry assertion meaningless.
  currentAnchor = isSmokeEnabled()
    ? DEFAULT_MARKER_ANCHOR
    : (readMarkerAnchor() ?? DEFAULT_MARKER_ANCHOR);
  const size = markerWindowSize();
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
    log('marker shown', { anchor: currentAnchor, bounds: window.getBounds() });
    smokeReady({ markerBounds: window.getBounds(), markerAnchor: currentAnchor });
  });

  window.on('closed', () => {
    markerWindow = null;
  });

  markerWindow = window;
  void loadRenderer(window, 'marker', boot);
  watchDisplayChanges();
  return window;
}

/** Re-applies an anchor stored from the renderer (`marker:set-anchor`). */
export function applyMarkerAnchor(anchor: MarkerAnchor): void {
  currentAnchor = anchor;
  if (!markerWindow || markerWindow.isDestroyed()) return;
  markerWindow.setBounds(resolveMarkerBounds(anchor));
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
  const anchor = anchorForBounds(rawBounds, display);
  window.setBounds(resolveMarkerBounds(anchor));
  currentAnchor = anchor;
  writeMarkerAnchor(anchor);

  log('marker drag ended', { anchor, ticks: state.ticks });
  smokeRecord('drag-end', {
    anchor,
    ticks: state.ticks,
    rawBounds,
    bounds: window.getBounds(),
  });
  return anchor;
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
    const bounds = markerWindow.getBounds() as Rect;
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
    markerWindow.setBounds(resolveMarkerBounds(anchor));
    log(`display change (${reason}) re-homed the marker`, { anchor });
    markerWindow.webContents.send(IPC.event.markerAnchorChanged, { anchor, edge: anchor.edge });
  };

  screen.on('display-added', () => rehome('display-added'));
  screen.on('display-removed', () => rehome('display-removed'));
  screen.on('display-metrics-changed', () => rehome('display-metrics-changed'));
}
