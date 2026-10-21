import type { MarkerAnchor, MarkerEdge, Rect } from '../types/app';

/** Distance under which the marker snaps to a work-area edge (docs/ARCHITECTURE.md §9.3). */
export const SNAP_THRESHOLD_PX = 24;
/** Gap between the marker and the unfolded panel. */
export const PANEL_GAP_PX = 8;
/**
 * How close to a work-area edge the marker has to be for the panel to unfold
 * *away* from that edge instead of to the roomier side (§9.3). Same distance as
 * the snap threshold: a marker the user pushed up against an edge is "docked"
 * to it, whether or not snapping is switched on.
 */
export const PANEL_DOCK_THRESHOLD_PX = 24;

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
 * The work-area edge the marker is docked to, or `free` when it sits further in
 * than `threshold`. Used for panel placement, so it looks at geometry only — the
 * stored anchor is not consulted, which is what lets the panel be re-placed on
 * every drag frame rather than only once the drag has ended.
 */
export function dockedEdge(
  bounds: Rect,
  workArea: Rect,
  threshold: number = PANEL_DOCK_THRESHOLD_PX,
): MarkerEdge {
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
  return edge;
}

/**
 * Places the unfolded panel next to the marker (docs/ARCHITECTURE.md §9.3).
 *
 * A marker docked to an edge unfolds the panel away from it: top → downwards,
 * bottom → upwards, left → rightwards, right → leftwards. Only a marker parked
 * away from every edge falls back to picking the side the pointer is *not* on.
 * Either way the panel is clamped inside the work area, so it can never open
 * off screen — and the perpendicular axis is centred on the marker, which keeps
 * it looking attached rather than merely adjacent.
 */
export function placePanel(
  markerBounds: Rect,
  panelSize: { width: number; height: number },
  workArea: Rect,
  gap: number = PANEL_GAP_PX,
): Rect {
  const edge = dockedEdge(markerBounds, workArea);
  const centeredX = markerBounds.x + (markerBounds.width - panelSize.width) / 2;
  const centeredY = markerBounds.y + (markerBounds.height - panelSize.height) / 2;

  if (edge !== 'free') {
    const spot: { x: number; y: number } =
      edge === 'top'
        ? { x: centeredX, y: markerBounds.y + markerBounds.height + gap }
        : edge === 'bottom'
          ? { x: centeredX, y: markerBounds.y - panelSize.height - gap }
          : edge === 'left'
            ? { x: markerBounds.x + markerBounds.width + gap, y: centeredY }
            : { x: markerBounds.x - panelSize.width - gap, y: centeredY };
    return place(spot.x, spot.y, panelSize, workArea);
  }

  const marker = centerOf(markerBounds);
  const rightHalf = marker.x >= workArea.x + workArea.width / 2;

  const leftCandidate = markerBounds.x - panelSize.width - gap;
  const rightCandidate = markerBounds.x + markerBounds.width + gap;

  let x = rightHalf ? leftCandidate : rightCandidate;
  if (x < workArea.x) x = rightCandidate;
  if (x + panelSize.width > workArea.x + workArea.width) x = leftCandidate;

  return place(x, centeredY, panelSize, workArea);
}

/**
 * Places the task detail window beside the panel (docs/FEATURES.md M02 D6).
 *
 * The detail is a window of its own, and it opens *next to* the panel rather than over
 * it: the list is left visible and operable while a task is edited, so a click on
 * another row is one gesture away instead of a trip back through a back button.
 *
 * Where "next to" is depends on how the *panel* is docked, and the two axes are not
 * interchangeable. A panel docked to the top edge already hangs downwards from the
 * marker, and one docked to the bottom already rises upwards — so the detail continues
 * that pair **sideways**, sharing the panel's top (or bottom) edge. Stacking it further
 * along the vertical axis, which is what the marker's own rule would do, lands it on the
 * far side of the screen once the panel is tall: the pair then reads as two unrelated
 * windows placed diagonally, which is exactly what a top or bottom dock looked like.
 * Panels docked left or right open sideways already, so the detail continues that row.
 *
 * Whichever side is chosen, the other axis is clamped into the work area, and a spot
 * that would still land on the panel flips to the opposite side. If neither side has
 * room, the preferred rectangle is returned: a slightly overlapping window the user can
 * drag is better than one off screen or one that silently refuses to open.
 */
export function placeTaskDetail(
  panelBounds: Rect,
  detailSize: { width: number; height: number },
  workArea: Rect,
  gap: number = PANEL_GAP_PX,
): Rect {
  const edge = dockedEdge(panelBounds, workArea);

  if (edge === 'top' || edge === 'bottom') {
    // Sharing the edge the panel was opened from keeps the pair reading as one
    // assembly: both windows start (or end) at the same line.
    const y =
      edge === 'top'
        ? panelBounds.y
        : panelBounds.y + panelBounds.height - detailSize.height;
    const beside = placeBeside(panelBounds, detailSize, workArea, gap, y);
    if (beside !== null) return beside;
  }

  const preferred = placePanel(panelBounds, detailSize, workArea, gap);
  if (!overlaps(preferred, panelBounds)) return preferred;

  // The flip goes along the *other* axis: the preferred spot was moved along one of
  // them and the clamp is what pulled it back, so that one is the one with no room
  // left. Moving along it again would only reproduce the same rectangle.
  const movedVertically =
    Math.abs(preferred.y - panelBounds.y) > Math.abs(preferred.x - panelBounds.x);
  const flipped = movedVertically
    ? {
        ...preferred,
        x:
          preferred.x < panelBounds.x
            ? panelBounds.x + panelBounds.width + gap
            : panelBounds.x - detailSize.width - gap,
      }
    : {
        ...preferred,
        y:
          preferred.y < panelBounds.y
            ? panelBounds.y + panelBounds.height + gap
            : panelBounds.y - detailSize.height - gap,
      };

  const candidate = place(flipped.x, flipped.y, detailSize, workArea);
  return overlaps(candidate, panelBounds) ? preferred : candidate;
}

/**
 * The detail at `y`, on whichever horizontal side of the panel has room, or `null`
 * when neither does.
 *
 * The roomier side wins when both fit, so the window goes where the user's own panel
 * left space rather than always to the same side — a marker parked near the right edge
 * has its panel pushed left, and the room is on its left too.
 */
function placeBeside(
  panelBounds: Rect,
  detailSize: { width: number; height: number },
  workArea: Rect,
  gap: number,
  y: number,
): Rect | null {
  const rightX = panelBounds.x + panelBounds.width + gap;
  const leftX = panelBounds.x - detailSize.width - gap;
  const roomRight = workArea.x + workArea.width - rightX;
  const roomLeft = leftX - workArea.x;

  const fitsRight = roomRight >= detailSize.width;
  const fitsLeft = roomLeft >= detailSize.width;
  if (!fitsRight && !fitsLeft) return null;

  const x = fitsRight && (!fitsLeft || roomRight >= roomLeft) ? rightX : leftX;
  const rect = place(x, y, detailSize, workArea);
  return overlaps(rect, panelBounds) ? null : rect;
}

/** True when two rectangles share any area at all. Touching edges count as apart. */
function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * The reminder popup's window size (docs/FEATURES.md M04).
 *
 * Fixed rather than resizable, and narrower than the panel: the popup is a notification
 * the user reads and answers, not a surface they work in, so it is sized once for the
 * four things it draws (a label, the task's name, its deadline, two buttons).
 */
export const REMINDER_POPUP_SIZE: { width: number; height: number } = { width: 340, height: 124 };

/**
 * Places the reminder popup beside the marker, and stacks it when several are due at
 * once (M04).
 *
 * The first popup sits exactly where the panel would open — same docked-edge rule, same
 * gap — because the popup is a stand-in for it and should look like it belongs to the
 * same marker. `index` 0 is that first popup; each one after it steps further along the
 * axis the first one already opens in: a marker docked to the bottom edge opens upwards,
 * so the stack grows upwards; everywhere else it grows downwards. Every rectangle is
 * clamped back inside the work area, so a stack that runs out of room piles up against
 * the edge rather than off screen.
 */
export function placeReminderPopup(
  markerBounds: Rect,
  workArea: Rect,
  index: number,
  size: { width: number; height: number } = REMINDER_POPUP_SIZE,
): Rect {
  const base = placePanel(markerBounds, size, workArea);
  if (index <= 0) return base;

  const step = size.height + PANEL_GAP_PX;
  const upwards = dockedEdge(markerBounds, workArea) === 'bottom';
  const y = upwards ? base.y - index * step : base.y + index * step;
  // Threshold 0: this is a clamp, not a snap — the popup is not a marker and must not
  // be pulled onto an edge it merely came close to.
  return { ...base, y: snapToWorkArea({ ...base, y }, workArea, 0).y };
}

/** Clamps a placement into the work area, keeping the given size. */
function place(
  x: number,
  y: number,
  size: { width: number; height: number },
  workArea: Rect,
): Rect {
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - size.width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - size.height);
  return {
    x: Math.round(clamp(x, workArea.x, maxX)),
    y: Math.round(clamp(y, workArea.y, maxY)),
    width: size.width,
    height: size.height,
  };
}
