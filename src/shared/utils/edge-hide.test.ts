import { describe, expect, it } from 'vitest';

import type { Rect } from '../types/app';
import { distanceToRect, nextEdgeHideState, parkedRect } from './edge-hide';
import type { EdgeHideConfig } from './edge-hide';

/** A marker flush against the right edge of a 1920×1040 work area. */
const AT_RIGHT: Rect = { x: 1888, y: 700, width: 32, height: 39 };
const CONFIG: EdgeHideConfig = { peek: 5, revealDistance: 24, hideDistance: 48 };

describe('parkedRect', () => {
  it('leaves only the peek inside the work area, per edge', () => {
    expect(parkedRect({ x: 100, y: 200, width: 32, height: 39 }, 'right', 5)).toEqual({
      x: 127,
      y: 200,
      width: 32,
      height: 39,
    });
    expect(parkedRect({ x: 100, y: 200, width: 32, height: 39 }, 'left', 5)?.x).toBe(73);
    expect(parkedRect({ x: 100, y: 200, width: 32, height: 39 }, 'top', 5)?.y).toBe(166);
    expect(parkedRect({ x: 100, y: 200, width: 32, height: 39 }, 'bottom', 5)?.y).toBe(234);
  });

  it('never hides a marker with a free anchor', () => {
    expect(parkedRect(AT_RIGHT, 'free', 5)).toBeNull();
  });

  it('keeps the peek within the axis it slides along', () => {
    // A capsule is wider than it is tall, so a peek bigger than its height must
    // not push the whole marker off screen when it parks at the top.
    const pill: Rect = { x: 100, y: 200, width: 56, height: 28 };
    expect(parkedRect(pill, 'top', 60)?.y).toBe(200);
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
    expect(nextEdgeHideState('shown', { x: 0, y: 0 }, AT_RIGHT, 'free', CONFIG)).toBe('shown');
  });

  it('parks once the cursor is past the exit distance', () => {
    expect(nextEdgeHideState('shown', { x: 1900, y: 720 }, AT_RIGHT, 'right', CONFIG)).toBe('shown');
    expect(nextEdgeHideState('shown', { x: 1800, y: 720 }, AT_RIGHT, 'right', CONFIG)).toBe('hidden');
  });

  it('reveals when the cursor reaches the sliver', () => {
    const parked = parkedRect(AT_RIGHT, 'right', CONFIG.peek) as Rect;
    // On the sliver: revealed.
    expect(nextEdgeHideState('hidden', { x: parked.x + 2, y: 720 }, AT_RIGHT, 'right', CONFIG)).toBe(
      'shown',
    );
    // Just beyond the reveal distance: still parked, even though it is inside
    // the exit distance — that gap is what stops the marker from flickering.
    expect(
      nextEdgeHideState('hidden', { x: parked.x - CONFIG.revealDistance - 1, y: 720 }, AT_RIGHT, 'right', CONFIG),
    ).toBe('hidden');
  });

  it('does not flicker while the cursor sits between the two distances', () => {
    const parked = parkedRect(AT_RIGHT, 'right', CONFIG.peek) as Rect;
    const between = { x: parked.x - 30, y: 720 };
    expect(distanceToRect(between, AT_RIGHT)).toBeLessThan(CONFIG.hideDistance);
    expect(distanceToRect(between, parked)).toBeGreaterThan(CONFIG.revealDistance);
    expect(nextEdgeHideState('hidden', between, AT_RIGHT, 'right', CONFIG)).toBe('hidden');
    expect(nextEdgeHideState('shown', between, AT_RIGHT, 'right', CONFIG)).toBe('shown');
  });
});
