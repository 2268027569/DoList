import { describe, expect, it } from 'vitest';

import { DEFAULT_BOOT, bootQuery, parseBootParams } from './boot';

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
});

describe('bootQuery', () => {
  it('round trips through parseBootParams', () => {
    const params = { mode: 'light', theme: 'minimal', locale: 'ja' } as const;
    const query = new URLSearchParams(bootQuery(params)).toString();
    expect(parseBootParams(`?${query}`)).toEqual(params);
  });
});
