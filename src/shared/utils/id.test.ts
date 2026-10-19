import { describe, expect, it } from 'vitest';

import { newId } from './id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The 48-bit millisecond prefix, read back out of an id. */
function timestampOf(id: string): number {
  return Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

describe('newId', () => {
  it('formats a v7 UUID with the RFC 4122 variant', () => {
    const id = newId(0);
    expect(id).toMatch(UUID);
    expect(id[14]).toBe('7'); // version nibble
    expect(['8', '9', 'a', 'b']).toContain(id[19]); // variant bits
  });

  it('encodes the millisecond timestamp in the prefix', () => {
    const now = Date.UTC(2026, 4, 12, 10, 0, 0);
    expect(timestampOf(newId(now))).toBe(now);
  });

  it('sorts chronologically, which is the whole point of v7', () => {
    const early = newId(1_000);
    const late = newId(2_000);
    expect(early < late).toBe(true);
  });

  it('does not repeat itself within the same millisecond', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId(1_700_000_000_000)));
    expect(ids.size).toBe(500);
  });
});
