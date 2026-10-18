import { screen } from 'electron';
import type { BrowserWindow, Display, Rectangle } from 'electron';

import { fromAnchor, snapToWorkArea, toAnchor } from '@shared/utils/anchoring';
import type { MarkerAnchor } from '@shared/types/app';

/**
 * Design size of the marker artwork: a 28px dot with a hover ring (§9.1).
 *
 * The *window* may be larger: Windows refuses to create a transparent frameless
 * window smaller than 32×39 (measured — see §9.1), so the OS silently inflates
 * the request. `markerWindowSize()` reads the size the platform actually gave us
 * and every anchoring calculation uses that, keeping the geometry honest.
 */
export const MARKER_ARTWORK_SIZE = 28;

/** Platform floor for a transparent, frameless top-level window, in DIPs. */
export const MARKER_WINDOW_FLOOR: Record<string, { width: number; height: number }> = {
  win32: { width: 32, height: 39 },
};

export const PANEL_SIZE = { width: 380, height: 560 } as const;

/** Parked near the primary display's right edge on first run. */
export const DEFAULT_MARKER_ANCHOR: MarkerAnchor = {
  displayId: '',
  edge: 'right',
  offsetFromEdge: 12,
  ratioAlongEdge: 0.7,
};

export function markerWindowSize(window?: BrowserWindow | null): { width: number; height: number } {
  if (window && !window.isDestroyed()) {
    const bounds = window.getBounds();
    return { width: bounds.width, height: bounds.height };
  }
  const floor = MARKER_WINDOW_FLOOR[process.platform];
  if (floor) return { ...floor };
  return { width: MARKER_ARTWORK_SIZE, height: MARKER_ARTWORK_SIZE };
}

/**
 * Anchor -> display. A stored display id can disappear (monitor unplugged), in
 * which case we fall back to the display nearest the OS cursor, so the marker is
 * never stranded off-screen (§9.3).
 */
export function displayForAnchor(anchor: MarkerAnchor): Display {
  if (anchor.displayId !== '') {
    const stored = screen
      .getAllDisplays()
      .find((display) => String(display.id) === anchor.displayId);
    if (stored) return stored;
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/** Absolute marker rectangle for an anchor, kept inside the resolved work area. */
export function resolveMarkerBounds(
  anchor: MarkerAnchor,
  size: { width: number; height: number } = markerWindowSize(),
): Rectangle {
  const display = displayForAnchor(anchor);
  const position = fromAnchor(anchor, display.workArea, size);
  const snapped = snapToWorkArea(
    { x: Math.round(position.x), y: Math.round(position.y), ...size },
    display.workArea,
    // Zero threshold: an anchor already implies which edge it belongs to.
    0,
  );
  return { x: snapped.x, y: snapped.y, width: size.width, height: size.height };
}

/** Absolute rectangle -> anchor, used after a drag or a display change. */
export function anchorForBounds(bounds: Rectangle, display: Display): MarkerAnchor {
  const snapped = snapToWorkArea(bounds, display.workArea);
  const settled: Rectangle = { ...bounds, x: snapped.x, y: snapped.y };
  return toAnchor(settled, display.workArea, String(display.id), snapped.edge);
}
