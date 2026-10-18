import { screen } from 'electron';
import type { Display, Rectangle } from 'electron';

import { fromAnchor, snapToWorkArea, SNAP_THRESHOLD_PX, toAnchor } from '@shared/utils/anchoring';
import { markerWindowSize as artworkWindowSize } from '@shared/utils/marker-geometry';
import type { Size } from '@shared/utils/marker-geometry';
import type { MarkerAnchor, MarkerAppearance } from '@shared/types/app';

/**
 * Platform floor for a transparent, frameless top-level window, in DIPs.
 *
 * Windows refuses to create one smaller than 32×39 and silently inflates the
 * request (measured — see §9.1.1), so the marker *window* is the larger of the
 * artwork and this floor, and the artwork stays centred inside it. Every
 * anchoring calculation uses the window size, keeping the geometry honest.
 */
export const MARKER_WINDOW_FLOOR: Record<string, Size> = {
  win32: { width: 32, height: 39 },
};

/** Parked near the primary display's right edge on first run. */
export const DEFAULT_MARKER_ANCHOR: MarkerAnchor = {
  displayId: '',
  edge: 'right',
  offsetFromEdge: 12,
  ratioAlongEdge: 0.7,
};

/** Window size for the given appearance, i.e. artwork clamped up to the floor. */
export function markerWindowSize(appearance: MarkerAppearance): Size {
  return artworkWindowSize(
    appearance.shape,
    appearance.scale,
    MARKER_WINDOW_FLOOR[process.platform] ?? null,
  );
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
export function resolveMarkerBounds(anchor: MarkerAnchor, size: Size): Rectangle {
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
export function anchorForBounds(
  bounds: Rectangle,
  display: Display,
  threshold: number = SNAP_THRESHOLD_PX,
): MarkerAnchor {
  const snapped = snapToWorkArea(bounds, display.workArea, threshold);
  const settled: Rectangle = { ...bounds, x: snapped.x, y: snapped.y };
  return toAnchor(settled, display.workArea, String(display.id), snapped.edge);
}
