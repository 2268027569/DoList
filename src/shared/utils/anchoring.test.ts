import { describe, expect, it } from 'vitest';

import type { Rect } from '../types/app';
import { SNAP_THRESHOLD_PX, fromAnchor, isVisibleIn, placePanel, snapToWorkArea, toAnchor } from './anchoring';

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
  it('opens to the left when the marker is on the right half of the screen', () => {
    const rect = placePanel({ x: 1800, y: 500, ...MARKER }, PANEL, WORK_AREA);
    expect(rect.x).toBe(1800 - PANEL.width - 8);
    expect(rect.y).toBe(500 + MARKER.height / 2 - PANEL.height / 2);
    expect(rect.width).toBe(PANEL.width);
  });

  it('opens to the right when the marker is on the left half', () => {
    const rect = placePanel({ x: 40, y: 500, ...MARKER }, PANEL, WORK_AREA);
    expect(rect.x).toBe(40 + MARKER.width + 8);
  });

  it('never leaves the work area, even when the panel barely fits', () => {
    const narrow: Rect = { x: 0, y: 0, width: 400, height: 1040 };
    const rect = placePanel({ x: 350, y: 500, ...MARKER }, PANEL, narrow);
    expect(rect.x).toBe(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(narrow.width);
  });

  it('clamps the vertical position at the bottom edge', () => {
    const rect = placePanel({ x: 1800, y: 1030, ...MARKER }, PANEL, WORK_AREA);
    expect(rect.y).toBe(WORK_AREA.height - PANEL.height);
  });

  it('honours a display with a non-zero origin', () => {
    const secondary: Rect = { x: 1920, y: 0, width: 1920, height: 1040 };
    const rect = placePanel({ x: 3700, y: 400, ...MARKER }, PANEL, secondary);
    expect(rect.x).toBeGreaterThanOrEqual(secondary.x);
    expect(rect.x + rect.width).toBeLessThanOrEqual(secondary.x + secondary.width);
  });
});
