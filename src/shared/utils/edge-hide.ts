import type { MarkerEdge, Rect } from '../types/app';

/**
 * Edge auto-hide (docs/ARCHITECTURE.md §9.4). Attached to a screen edge the
 * marker can retreat until only a sliver is left, so the desktop stays clear;
 * approaching that sliver brings it back.
 *
 * The cursor is read by the main process (`screen.getCursorScreenPoint()`), but
 * the decision itself is pure and lives here, where it is unit-tested.
 */
export interface EdgeHideConfig {
  /** How many pixels of the marker stay inside the work area while parked. */
  peek: number;
  /** Cursor distance to the parked sliver that brings the marker back out. */
  revealDistance: number;
  /** Cursor distance from the marker past which it parks again. */
  hideDistance: number;
}

/** `shown` is the marker at its anchored position, `hidden` is it parked at the edge. */
export type EdgeHideState = 'shown' | 'hidden';

/** Shortest distance from a point to a rectangle; zero when inside. */
export function distanceToRect(point: { x: number; y: number }, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * The rectangle the window moves to when parked, or `null` for an edge that
 * never hides (`free`). Most of the marker ends up outside the work area, so
 * the anchor is deliberately *not* recomputed from this position — it stays the
 * anchored one, and {@link nextEdgeHideState} uses that anchored rect instead.
 */
export function parkedRect(full: Rect, edge: MarkerEdge, peek: number): Rect | null {
  switch (edge) {
    case 'left': {
      const visible = clampPeek(peek, full.width);
      return { ...full, x: full.x - full.width + visible };
    }
    case 'right': {
      const visible = clampPeek(peek, full.width);
      return { ...full, x: full.x + full.width - visible };
    }
    case 'top': {
      const visible = clampPeek(peek, full.height);
      return { ...full, y: full.y - full.height + visible };
    }
    case 'bottom': {
      const visible = clampPeek(peek, full.height);
      return { ...full, y: full.y + full.height - visible };
    }
    case 'free':
      return null;
  }
}

/**
 * Next park state for the given cursor position.
 *
 * The two distances are what make this stable: leaving takes more movement than
 * approaching (`hideDistance` > `revealDistance`), so a marker hovering at the
 * boundary cannot flicker between the two states.
 */
export function nextEdgeHideState(
  previous: EdgeHideState,
  cursor: { x: number; y: number },
  full: Rect,
  edge: MarkerEdge,
  config: EdgeHideConfig,
): EdgeHideState {
  const parked = parkedRect(full, edge, config.peek);
  if (parked === null) return 'shown';

  // Approaching is measured against the sliver — the only part of a parked
  // marker the cursor can be aimed at — while leaving is measured against the
  // whole marker, which is what the user sees at that moment. Both cases reduce
  // to the same rule: inside the limit is "shown", outside it is "hidden".
  const reference = previous === 'hidden' ? parked : full;
  const limit = previous === 'hidden' ? config.revealDistance : config.hideDistance;
  return distanceToRect(cursor, reference) <= limit ? 'shown' : 'hidden';
}

function clampPeek(peek: number, limit: number): number {
  return Math.min(Math.max(peek, 1), limit);
}
