import type { MarkerAnchor, MarkerEdge, Rect } from '../types/app';

/** Distance under which the marker snaps to a work-area edge (docs/ARCHITECTURE.md §9.3). */
export const SNAP_THRESHOLD_PX = 24;
/** Gap between the marker and the unfolded panel. */
export const PANEL_GAP_PX = 8;

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function centerOf(bounds: Rect): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export interface SnapResult {
  x: number;
  y: number;
  edge: MarkerEdge;
}

/**
 * Snaps to the nearest work-area edge when closer than `threshold` and always
 * clamps back inside the work area, so the marker can never become unreachable.
 */
export function snapToWorkArea(
  bounds: Rect,
  workArea: Rect,
  threshold: number = SNAP_THRESHOLD_PX,
): SnapResult {
  const distances: Record<'left' | 'right' | 'top' | 'bottom', number> = {
    left: bounds.x - workArea.x,
    right: workArea.x + workArea.width - (bounds.x + bounds.width),
    top: bounds.y - workArea.y,
    bottom: workArea.y + workArea.height - (bounds.y + bounds.height),
  };

  let edge: MarkerEdge = 'free';
  let best = threshold;
  for (const candidate of ['left', 'right', 'top', 'bottom'] as const) {
    if (distances[candidate] < best) {
      best = distances[candidate];
      edge = candidate;
    }
  }

  const x =
    edge === 'left'
      ? workArea.x
      : edge === 'right'
        ? workArea.x + workArea.width - bounds.width
        : bounds.x;
  const y =
    edge === 'top'
      ? workArea.y
      : edge === 'bottom'
        ? workArea.y + workArea.height - bounds.height
        : bounds.y;

  return {
    x: Math.round(clamp(x, workArea.x, workArea.x + workArea.width - bounds.width)),
    y: Math.round(clamp(y, workArea.y, workArea.y + workArea.height - bounds.height)),
    edge,
  };
}

/** Describes a marker position relative to its display, using the given edge. */
export function toAnchor(
  bounds: Rect,
  workArea: Rect,
  displayId: string,
  edge: MarkerEdge,
): MarkerAnchor {
  const trackX = Math.max(0, workArea.width - bounds.width);
  const trackY = Math.max(0, workArea.height - bounds.height);
  const ratioX = trackX === 0 ? 0 : clamp((bounds.x - workArea.x) / trackX, 0, 1);
  const ratioY = trackY === 0 ? 0 : clamp((bounds.y - workArea.y) / trackY, 0, 1);

  switch (edge) {
    case 'left':
      return {
        displayId,
        edge,
        offsetFromEdge: bounds.x - workArea.x,
        ratioAlongEdge: ratioY,
      };
    case 'right':
      return {
        displayId,
        edge,
        offsetFromEdge: workArea.x + workArea.width - (bounds.x + bounds.width),
        ratioAlongEdge: ratioY,
      };
    case 'top':
      return {
        displayId,
        edge,
        offsetFromEdge: bounds.y - workArea.y,
        ratioAlongEdge: ratioX,
      };
    case 'bottom':
      return {
        displayId,
        edge,
        offsetFromEdge: workArea.y + workArea.height - (bounds.y + bounds.height),
        ratioAlongEdge: ratioX,
      };
    case 'free':
      return { displayId, edge, offsetFromEdge: bounds.x - workArea.x, ratioAlongEdge: ratioY };
  }
}

/** Inverse of {@link toAnchor}: rebuilds a position from an anchor and a work area. */
export function fromAnchor(
  anchor: MarkerAnchor,
  workArea: Rect,
  size: { width: number; height: number },
): { x: number; y: number } {
  const trackX = Math.max(0, workArea.width - size.width);
  const trackY = Math.max(0, workArea.height - size.height);
  const ratio = clamp(anchor.ratioAlongEdge, 0, 1);
  const offset = anchor.offsetFromEdge;

  switch (anchor.edge) {
    case 'left':
      return { x: workArea.x + offset, y: workArea.y + ratio * trackY };
    case 'right':
      return {
        x: workArea.x + workArea.width - size.width - offset,
        y: workArea.y + ratio * trackY,
      };
    case 'top':
      return { x: workArea.x + ratio * trackX, y: workArea.y + offset };
    case 'bottom':
      return {
        x: workArea.x + ratio * trackX,
        y: workArea.y + workArea.height - size.height - offset,
      };
    case 'free':
      return { x: workArea.x + offset, y: workArea.y + ratio * trackY };
  }
}

/** True when at least `minVisible` px of the marker overlaps one of the work areas. */
export function isVisibleIn(bounds: Rect, workAreas: readonly Rect[], minVisible = 16): boolean {
  return workAreas.some((area) => {
    const overlapX =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapY =
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapX >= minVisible && overlapY >= minVisible;
  });
}

/**
 * Places the unfolded panel next to the marker: it opens away from the nearest
 * screen edge and is always clamped inside the work area (§9.3 "最小可见性保证").
 */
export function placePanel(
  markerBounds: Rect,
  panelSize: { width: number; height: number },
  workArea: Rect,
  gap: number = PANEL_GAP_PX,
): Rect {
  const marker = centerOf(markerBounds);
  const rightHalf = marker.x >= workArea.x + workArea.width / 2;

  const leftCandidate = markerBounds.x - panelSize.width - gap;
  const rightCandidate = markerBounds.x + markerBounds.width + gap;

  let x = rightHalf ? leftCandidate : rightCandidate;
  if (x < workArea.x) x = rightCandidate;
  if (x + panelSize.width > workArea.x + workArea.width) x = leftCandidate;

  const maxX = Math.max(workArea.x, workArea.x + workArea.width - panelSize.width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - panelSize.height);

  return {
    x: Math.round(clamp(x, workArea.x, maxX)),
    y: Math.round(clamp(marker.y - panelSize.height / 2, workArea.y, maxY)),
    width: panelSize.width,
    height: panelSize.height,
  };
}
