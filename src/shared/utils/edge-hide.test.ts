import { describe, expect, it } from 'vitest';

import type { Rect } from '../types/app';
import { distanceToRect, nextEdgeHideState, parkedRect } from './edge-hide';
import type { EdgeHideConfig } from './edge-hide';

/** A marker flush against the right edge of a 1920×1040 work area. */
const AT_RIGHT: Rect = { x: 1888, y: 700, width: 32, height: 39 };
const CONFIG: EdgeHideConfig = { peek: 5, revealDistance: 24, hideDistance: 48 };
/** A work area with an origin, so the maths cannot pass by ignoring it. */
const AREA: Rect = { x: 0, y: 0, width: 1920, height: 1040 };

describe('parkedRect', () => {
  it('leaves only the peek inside the work area, per edge', () => {
    const full = { x: 100, y: 200, width: 32, height: 39 };
    expect(parkedRect(full, 'right', 5, AREA)).toEqual({ x: 1915, y: 200, width: 32, height: 39 });
    expect(parkedRect(full, 'left', 5, AREA)).toEqual({ x: -27, y: 200, width: 32, height: 39 });
    expect(parkedRect(full, 'top', 5, AREA)).toEqual({ x: 100, y: -34, width: 32, height: 39 });
    expect(
      parkedRect(full, 'bottom', 5, AREA)?.y,
    ).toBe(1040 - 5);
  });

  it('measures the peek from the work area, not from the anchor', () => {
    // The regression that made the marker never really hide: the default anchor
    // keeps a 12px inset, and measuring the peek from the marker instead of the
    // edge left those 12px visible on top of the 5px peek.
    const inset: Rect = { x: 1876, y: 695, width: 32, height: 39 };
    const flush: Rect = { x: 1888, y: 695, width: 32, height: 39 };

    expect(parkedRect(inset, 'right', 5, AREA)?.x).toBe(parkedRect(flush, 'right', 5, AREA)?.x);
    // Whatever the inset, exactly `peek` px of the window stays on screen.
    const parked = parkedRect(inset, 'right', 5, AREA) as Rect;
    expect(AREA.x + AREA.width - parked.x).toBe(5);
  });

  it('offsets the geometry by the work area origin', () => {
    // Second display to the right of the primary: work areas do not start at 0.
    const second: Rect = { x: 1920, y: 0, width: 1280, height: 1000 };
    expect(parkedRect(AT_RIGHT, 'right', 5, second)?.x).toBe(1920 + 1280 - 5);
    expect(parkedRect(AT_RIGHT, 'left', 5, second)?.x).toBe(1920 - 32 + 5);
  });

  it('never hides a marker with a free anchor', () => {
    expect(parkedRect(AT_RIGHT, 'free', 5, AREA)).toBeNull();
  });

  it('shows the whole marker when the peek exceeds its height', () => {
    // A capsule is wider than it is tall, so a peek bigger than its height is
    // clamped to the height: the marker ends up flush with the work area top
    // (`y = workArea.y`) instead of poking past it off screen.
    const pill: Rect = { x: 100, y: 200, width: 56, height: 28 };
    expect(parkedRect(pill, 'top', 60, AREA)?.y).toBe(0);
  });
});

describe('distanceToRect', () => {
  it('is zero inside the rectangle and the gap outside it', () => {
    const rect: Rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(distanceToRect({ x: 5, y: 5 }, rect)).toBe(0);
    expect(distanceToRect({ x: -3, y: 5 }, rect)).toBeCloseTo(3);
    expect(distanceToRect({ x: 13, y: 14 }, rect)).toBeCloseTo(5);
  });
});

describe('nextEdgeHideState', () => {
  it('stays visible while the panel needs the marker, and off a free anchor', () => {
    expect(nextEdgeHideState('shown', { x: 0, y: 0 }, AT_RIGHT, 'free', CONFIG, AREA)).toBe('shown');
  });

  it('parks once the cursor is past the exit distance', () => {
    expect(nextEdgeHideState('shown', { x: 1900, y: 720 }, AT_RIGHT, 'right', CONFIG, AREA)).toBe(
      'shown',
    );
    expect(nextEdgeHideState('shown', { x: 1800, y: 720 }, AT_RIGHT, 'right', CONFIG, AREA)).toBe(
      'hidden',
    );
  });

  it('reveals when the cursor reaches the sliver', () => {
    const parked = parkedRect(AT_RIGHT, 'right', CONFIG.peek, AREA) as Rect;
    // On the sliver: revealed.
    expect(
      nextEdgeHideState('hidden', { x: parked.x + 2, y: 720 }, AT_RIGHT, 'right', CONFIG, AREA),
    ).toBe('shown');
    // Just beyond the reveal distance: still parked, even though it is inside
    // the exit distance — that gap is what stops the marker from flickering.
    expect(
      nextEdgeHideState(
        'hidden',
        { x: parked.x - CONFIG.revealDistance - 1, y: 720 },
        AT_RIGHT,
        'right',
        CONFIG,
        AREA,
      ),
    ).toBe('hidden');
  });

  it('does not flicker while the cursor sits between the two distances', () => {
    const parked = parkedRect(AT_RIGHT, 'right', CONFIG.peek, AREA) as Rect;
    const between = { x: parked.x - 30, y: 720 };
    expect(distanceToRect(between, AT_RIGHT)).toBeLessThan(CONFIG.hideDistance);
    expect(distanceToRect(between, parked)).toBeGreaterThan(CONFIG.revealDistance);
    expect(nextEdgeHideState('hidden', between, AT_RIGHT, 'right', CONFIG, AREA)).toBe('hidden');
    expect(nextEdgeHideState('shown', between, AT_RIGHT, 'right', CONFIG, AREA)).toBe('shown');
  });
});
