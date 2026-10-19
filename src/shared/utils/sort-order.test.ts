import { describe, expect, it } from 'vitest';

import { dropEdge, landingIndex, moveWithin } from './sort-order';

const IDS = ['a', 'b', 'c'] as const;

describe('moveWithin', () => {
  it('moves an item down and up inside the list', () => {
    expect(moveWithin(IDS, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveWithin(IDS, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveWithin(IDS, 1, 2)).toEqual(['a', 'c', 'b']);
  });

  it('clamps a move that runs off either end to the nearest real position', () => {
    expect(moveWithin(IDS, 0, -3)).toEqual(['a', 'b', 'c']);
    expect(moveWithin(IDS, 0, 9)).toEqual(['b', 'c', 'a']);
    expect(moveWithin(IDS, 99, 0)).toEqual(['c', 'a', 'b']);
  });

  it('hands the same array back when the move would change nothing', () => {
    // By reference, because that is how the caller knows there is no write to make.
    expect(moveWithin(IDS, 1, 1)).toBe(IDS);
    expect(moveWithin(IDS, 0, 0.4)).toBe(IDS);
    expect(moveWithin([], 0, 1)).toEqual([]);
    expect(moveWithin(IDS, Number.NaN, 1)).toBe(IDS);
  });

  it('leaves the input alone and returns a new array when it does move', () => {
    const input = [...IDS];
    const next = moveWithin(input, 0, 2);
    expect(input).toEqual(['a', 'b', 'c']);
    expect(next).not.toBe(input);
  });

  it('handles a group of one', () => {
    expect(moveWithin(['only'], 0, 1)).toEqual(['only']);
  });
});

describe('landingIndex', () => {
  /** Three 20px rows starting at y = 100. */
  const BANDS = [
    { top: 100, height: 20 },
    { top: 120, height: 20 },
    { top: 140, height: 20 },
  ];

  it('answers with the row whose midpoint the pointer has not passed', () => {
    expect(landingIndex(BANDS, 100)).toBe(0);
    expect(landingIndex(BANDS, 109)).toBe(0);
    expect(landingIndex(BANDS, 111)).toBe(1);
    expect(landingIndex(BANDS, 131)).toBe(2);
  });

  it('clamps a pointer above or below the list to its first or last row', () => {
    expect(landingIndex(BANDS, -500)).toBe(0);
    expect(landingIndex(BANDS, 9_000)).toBe(2);
    expect(landingIndex([], 50)).toBe(0);
  });
});

describe('dropEdge', () => {
  it('draws the edge the item will land against, and nothing when it stays put', () => {
    expect(dropEdge({ from: 2, to: 0 }, 0)).toBe('top');
    expect(dropEdge({ from: 0, to: 2 }, 2)).toBe('bottom');
    expect(dropEdge({ from: 0, to: 0 }, 0)).toBeNull();
    expect(dropEdge({ from: 0, to: 2 }, 1)).toBeNull();
    expect(dropEdge(null, 0)).toBeNull();
  });
});
