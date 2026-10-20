import { describe, expect, it } from 'vitest';

import type { MarkerAppearance } from '../types/app';
import { DEFAULT_BOOT, bootQuery, parseBootParams } from './boot';

const APPEARANCE: MarkerAppearance = {
  shape: 'pill',
  scale: 1.25,
  opacity: 0.6,
  tint: 'warning',
  badgeMode: 'today',
  showRing: false,
};

describe('parseBootParams', () => {
  it('reads mode, theme and locale from the query string', () => {
    expect(parseBootParams('?mode=dark&theme=graphite&locale=zh-Hans')).toEqual({
      mode: 'dark',
      theme: 'graphite',
      locale: 'zh-Hans',
    });
  });

  it('falls back to defaults for unknown values', () => {
    expect(parseBootParams('?mode=neon&theme=rainbow&locale=%21%21')).toEqual(DEFAULT_BOOT);
  });

  it('returns defaults for an empty query', () => {
    expect(parseBootParams('')).toEqual(DEFAULT_BOOT);
  });

  it('accepts script subtags', () => {
    expect(parseBootParams('?locale=zh-Hant').locale).toBe('zh-Hant');
  });

  it('decodes the marker appearance when the token is well formed', () => {
    expect(parseBootParams('?marker=pill,1.25,0.6,warning,today,0').marker).toEqual(APPEARANCE);
  });

  it('ignores a malformed marker token, and clamps out-of-range numbers', () => {
    expect(parseBootParams('?marker=blob,1,1,accent,open,1').marker).toBeUndefined();
    expect(parseBootParams('?marker=dot,9,0,accent,open,1').marker).toMatchObject({
      scale: 1.5,
      opacity: 0.4,
    });
  });

  it('reads the glass flag only when the main process said the window has a material', () => {
    expect(parseBootParams('?glass=1').glass).toBe(true);
    expect(parseBootParams('?glass=0').glass).toBeUndefined();
  });
});

describe('bootQuery', () => {
  it('round trips through parseBootParams', () => {
    const params = { mode: 'light', theme: 'minimal', locale: 'ja' } as const;
    const query = new URLSearchParams(bootQuery(params)).toString();
    expect(parseBootParams(`?${query}`)).toEqual(params);
  });

  it('carries the marker appearance so the first paint matches the window size', () => {
    const params = { mode: 'dark', theme: 'graphite', locale: 'en', marker: APPEARANCE } as const;
    const query = new URLSearchParams(bootQuery(params)).toString();
    expect(parseBootParams(`?${query}`)).toEqual(params);
  });

  it('omits the marker token for the panel entry', () => {
    expect(bootQuery(DEFAULT_BOOT)).not.toHaveProperty('marker');
  });

  it('carries the glass flag, and leaves it out when the window paints its own surface', () => {
    expect(bootQuery({ ...DEFAULT_BOOT, glass: true }).glass).toBe('1');
    expect(bootQuery(DEFAULT_BOOT)).not.toHaveProperty('glass');
  });
});
