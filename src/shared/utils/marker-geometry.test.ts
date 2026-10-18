import { describe, expect, it } from 'vitest';

import { MARKER_ARTWORK, markerArtworkSize, markerWindowSize } from './marker-geometry';

const WINDOWS_FLOOR = { width: 32, height: 39 };

describe('markerArtworkSize', () => {
  it('returns the design size of each shape at scale 1', () => {
    expect(markerArtworkSize('dot', 1)).toEqual(MARKER_ARTWORK.dot);
    expect(markerArtworkSize('pill', 1)).toEqual({ width: 56, height: 28 });
    expect(markerArtworkSize('icon', 1)).toEqual({ width: 40, height: 40 });
  });

  it('scales both axes and rounds to whole DIPs', () => {
    expect(markerArtworkSize('dot', 1.5)).toEqual({ width: 42, height: 42 });
    expect(markerArtworkSize('pill', 0.8)).toEqual({ width: 45, height: 22 });
  });
});

describe('markerWindowSize', () => {
  it('clamps the artwork up to the platform floor on Windows', () => {
    // A 28px dot cannot be shown in a 28×28 window on Windows (§9.1.1).
    expect(markerWindowSize('dot', 1, WINDOWS_FLOOR)).toEqual(WINDOWS_FLOOR);
  });

  it('lets a scaled-up artwork outgrow the floor on the axis it exceeds', () => {
    expect(markerWindowSize('dot', 1.5, WINDOWS_FLOOR)).toEqual({ width: 42, height: 42 });
    // A capsule is wider than the floor but not taller, so the axes differ.
    expect(markerWindowSize('pill', 1, WINDOWS_FLOOR)).toEqual({ width: 56, height: 39 });
  });

  it('uses the raw artwork where the platform has no floor (macOS)', () => {
    expect(markerWindowSize('dot', 1, null)).toEqual({ width: 28, height: 28 });
  });
});
