import { describe, expect, it } from 'vitest';

import type { Rect } from '../types/app';
import {
  PANEL_GAP_PX,
  REMINDER_POPUP_SIZE,
  SNAP_THRESHOLD_PX,
  dockedEdge,
  fromAnchor,
  isVisibleIn,
  placePanel,
  placeReminderPopup,
  snapToWorkArea,
  toAnchor,
} from './anchoring';

const WORK_AREA: Rect = { x: 0, y: 0, width: 1920, height: 1040 };
const MARKER = { width: 28, height: 28 };
const PANEL = { width: 380, height: 560 };

describe('snapToWorkArea', () => {
  it('snaps a marker sitting next to the left edge', () => {
    const result = snapToWorkArea({ x: 12, y: 400, ...MARKER }, WORK_AREA);
    expect(result).toEqual({ x: 0, y: 400, edge: 'left' });
  });

  it('snaps to the right edge and keeps the position on the perpendicular axis', () => {
    const result = snapToWorkArea({ x: 1888, y: 400, ...MARKER }, WORK_AREA);
    expect(result).toEqual({ x: 1892, y: 400, edge: 'right' });
  });

  it('prefers the closest edge', () => {
    const result = snapToWorkArea({ x: 900, y: 1015, ...MARKER }, WORK_AREA);
    expect(result.edge).toBe('bottom');
    expect(result.y).toBe(1012);
  });

  it('leaves a marker far from every edge free', () => {
    const result = snapToWorkArea({ x: 700, y: 400, ...MARKER }, WORK_AREA);
    expect(result).toEqual({ x: 700, y: 400, edge: 'free' });
  });

  it('clamps a marker that ended up outside the work area back inside', () => {
    const result = snapToWorkArea({ x: 2100, y: 1500, ...MARKER }, WORK_AREA);
    expect(result.x).toBe(1892);
    expect(result.y).toBe(1012);
  });

  it('uses the configured threshold', () => {
    const bounds: Rect = { x: 40, y: 400, ...MARKER };
    expect(snapToWorkArea(bounds, WORK_AREA).edge).toBe('free');
    expect(snapToWorkArea(bounds, WORK_AREA, 64).edge).toBe('left');
    expect(SNAP_THRESHOLD_PX).toBe(24);
  });
});

describe('anchor round trip', () => {
  it.each(['left', 'right', 'top', 'bottom', 'free'] as const)(
    'restores the same position for the %s edge',
    (edge) => {
      const bounds: Rect =
        edge === 'right'
          ? { x: 1892, y: 500, ...MARKER }
          : edge === 'left'
            ? { x: 0, y: 500, ...MARKER }
            : edge === 'top'
              ? { x: 900, y: 0, ...MARKER }
              : edge === 'bottom'
                ? { x: 900, y: 1012, ...MARKER }
                : { x: 700, y: 300, ...MARKER };

      const anchor = toAnchor(bounds, WORK_AREA, 'display-1', edge);
      const restored = fromAnchor(anchor, WORK_AREA, MARKER);
      expect(restored.x).toBeCloseTo(bounds.x, 6);
      expect(restored.y).toBeCloseTo(bounds.y, 6);
    },
  );

  it('keeps the ratio when the work area changes size', () => {
    const anchor = toAnchor({ x: 1892, y: 520, ...MARKER }, WORK_AREA, 'display-1', 'right');
    expect(anchor.ratioAlongEdge).toBeCloseTo(0.5138, 3);

    const larger: Rect = { x: 0, y: 0, width: 2560, height: 1400 };
    const restored = fromAnchor(anchor, larger, MARKER);
    expect(restored.x).toBe(2560 - MARKER.width);
    expect(restored.y).toBeCloseTo(anchor.ratioAlongEdge * (1400 - MARKER.height), 6);
  });

  it('round-trips a free anchor, which is what "snapping off" relies on', () => {
    // A zero threshold never snaps, so the release builds a `free` anchor; the
    // marker must then reproduce exactly the position the user dropped it at.
    const dropped: Rect = { x: 40, y: 300, ...MARKER };
    const snapped = snapToWorkArea(dropped, WORK_AREA, 0);
    expect(snapped.edge).toBe('free');

    const anchor = toAnchor({ ...dropped, x: snapped.x, y: snapped.y }, WORK_AREA, 'display-1', 'free');
    expect(fromAnchor(anchor, WORK_AREA, MARKER)).toEqual({ x: 40, y: 300 });
  });
});

describe('isVisibleIn', () => {
  it('accepts a marker on any of the connected displays', () => {
    const second: Rect = { x: 1920, y: 0, width: 1920, height: 1040 };
    expect(isVisibleIn({ x: 2400, y: 200, ...MARKER }, [WORK_AREA, second])).toBe(true);
  });

  it('rejects a marker that fell off every display', () => {
    expect(isVisibleIn({ x: 6000, y: 200, ...MARKER }, [WORK_AREA])).toBe(false);
  });
});

describe('placePanel', () => {
  it('opens downwards when the marker is parked at the top edge', () => {
    const rect = placePanel({ x: 900, y: 0, ...MARKER }, PANEL, WORK_AREA);
    expect(rect.y).toBe(MARKER.height + 8);
    expect(rect.x).toBe(Math.round(900 + (MARKER.width - PANEL.width) / 2));
  });

  it('opens upwards when the marker is parked at the bottom edge', () => {
    const marker: Rect = { x: 900, y: WORK_AREA.height - MARKER.height, ...MARKER };
    const rect = placePanel(marker, PANEL, WORK_AREA);
    expect(rect.y).toBe(WORK_AREA.height - MARKER.height - PANEL.height - 8);
    expect(rect.y + rect.height).toBeLessThanOrEqual(marker.y);
  });

  it('opens to the right when the marker is parked at the left edge', () => {
    const rect = placePanel({ x: 0, y: 500, ...MARKER }, PANEL, WORK_AREA);
    expect(rect.x).toBe(MARKER.width + 8);
    expect(rect.x).toBeGreaterThanOrEqual(MARKER.width);
  });

  it('opens to the left when the marker is parked at the right edge', () => {
    const marker: Rect = { x: WORK_AREA.width - MARKER.width, y: 500, ...MARKER };
    const rect = placePanel(marker, PANEL, WORK_AREA);
    expect(rect.x + rect.width).toBe(marker.x - 8);
  });

  it('needs no stored anchor: placement follows the geometry alone', () => {
    // The panel is re-placed on every drag frame, when the anchor is still the
    // pre-drag one — so two rectangles that differ only in how far in they sit
    // must produce two different sides.
    const docked = placePanel({ x: 900, y: 20, ...MARKER }, PANEL, WORK_AREA);
    const free = placePanel({ x: 900, y: 400, ...MARKER }, PANEL, WORK_AREA);
    expect(docked.y).toBe(20 + MARKER.height + 8);
    expect(free.y).toBe(400 + (MARKER.height - PANEL.height) / 2);
  });

  it('opens to the left when a free marker is on the right half of the screen', () => {
    const rect = placePanel({ x: 1800, y: 500, ...MARKER }, PANEL, WORK_AREA);
    expect(rect.x).toBe(1800 - PANEL.width - 8);
    expect(rect.y).toBe(500 + MARKER.height / 2 - PANEL.height / 2);
    expect(rect.width).toBe(PANEL.width);
  });

  it('opens to the right when a free marker is on the left half', () => {
    const rect = placePanel({ x: 40, y: 500, ...MARKER }, PANEL, WORK_AREA);
    expect(rect.x).toBe(40 + MARKER.width + 8);
  });

  it('never leaves the work area, even when the panel barely fits', () => {
    const narrow: Rect = { x: 0, y: 0, width: 400, height: 1040 };
    const rect = placePanel({ x: 350, y: 500, ...MARKER }, PANEL, narrow);
    expect(rect.x).toBe(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(narrow.width);
  });

  it('centres the panel on the marker when it opens downwards', () => {
    const rect = placePanel({ x: 900, y: 0, ...MARKER }, PANEL, WORK_AREA);
    expect(rect.x + rect.width / 2).toBeCloseTo(900 + MARKER.width / 2, 6);
  });

  it('honours a display with a non-zero origin', () => {
    const secondary: Rect = { x: 1920, y: 0, width: 1920, height: 1040 };
    const rect = placePanel({ x: 3700, y: 400, ...MARKER }, PANEL, secondary);
    expect(rect.x).toBeGreaterThanOrEqual(secondary.x);
    expect(rect.x + rect.width).toBeLessThanOrEqual(secondary.x + secondary.width);
  });
});

describe('dockedEdge', () => {
  it('reports the edge the marker is parked against', () => {
    expect(dockedEdge({ x: 900, y: 0, ...MARKER }, WORK_AREA)).toBe('top');
    expect(dockedEdge({ x: 900, y: 1012, ...MARKER }, WORK_AREA)).toBe('bottom');
    expect(dockedEdge({ x: 0, y: 500, ...MARKER }, WORK_AREA)).toBe('left');
    expect(dockedEdge({ x: 1892, y: 500, ...MARKER }, WORK_AREA)).toBe('right');
  });

  it('reports free past the dock threshold, in either direction', () => {
    expect(dockedEdge({ x: 40, y: 500, ...MARKER }, WORK_AREA)).toBe('free');
    expect(dockedEdge({ x: 900, y: 40, ...MARKER }, WORK_AREA)).toBe('free');
    expect(dockedEdge({ x: 900, y: 40, ...MARKER }, WORK_AREA, 64)).toBe('top');
  });
});

describe('placeReminderPopup', () => {
  const STEP = REMINDER_POPUP_SIZE.height + PANEL_GAP_PX;

  it('puts the first popup exactly where the panel would open', () => {
    const marker: Rect = { x: 900, y: 0, ...MARKER };
    expect(placeReminderPopup(marker, WORK_AREA, 0)).toEqual(
      placePanel(marker, REMINDER_POPUP_SIZE, WORK_AREA),
    );
  });

  it('stacks downwards from a marker docked to the top edge', () => {
    const marker: Rect = { x: 900, y: 0, ...MARKER };
    const first = placeReminderPopup(marker, WORK_AREA, 0);
    const second = placeReminderPopup(marker, WORK_AREA, 1);
    expect(second.y).toBe(first.y + STEP);
    expect(second.x).toBe(first.x);
  });

  it('stacks upwards from a marker docked to the bottom edge', () => {
    const marker: Rect = { x: 900, y: WORK_AREA.height - MARKER.height, ...MARKER };
    const first = placeReminderPopup(marker, WORK_AREA, 0);
    const second = placeReminderPopup(marker, WORK_AREA, 1);
    expect(second.y).toBe(first.y - STEP);
    expect(second.y + second.height).toBeLessThanOrEqual(first.y);
  });

  it('stacks downwards along a side edge, keeping the same column', () => {
    const marker: Rect = { x: 0, y: 500, ...MARKER };
    const first = placeReminderPopup(marker, WORK_AREA, 0);
    const second = placeReminderPopup(marker, WORK_AREA, 1);
    expect(second.y).toBe(first.y + STEP);
    expect(second.x).toBe(first.x);
  });

  it('piles a stack that runs out of room against the work-area edge', () => {
    const marker: Rect = { x: 900, y: WORK_AREA.height - MARKER.height, ...MARKER };
    const far = placeReminderPopup(marker, WORK_AREA, 12);
    expect(far.y).toBe(WORK_AREA.y);
    expect(far.y + far.height).toBeLessThanOrEqual(WORK_AREA.height);
  });

  it('clamps into a display with a non-zero origin', () => {
    const secondary: Rect = { x: 1920, y: 100, width: 1920, height: 1040 };
    const marker: Rect = { x: 2800, y: secondary.y + secondary.height - MARKER.height, ...MARKER };
    const far = placeReminderPopup(marker, secondary, 12);
    expect(far.y).toBe(secondary.y);
    expect(far.x).toBeGreaterThanOrEqual(secondary.x);
    expect(far.x + far.width).toBeLessThanOrEqual(secondary.x + secondary.width);
  });
});
