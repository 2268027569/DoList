import { describe, expect, it } from 'vitest';

import { formatDate, formatNumber, formatRelative, weekStartDay } from './format';

describe('format', () => {
  it('formats a date for the requested locale', () => {
    const value = new Date(Date.UTC(2026, 0, 15, 12));
    expect(formatDate(value, 'en')).toContain('2026');
    expect(formatDate(value, 'zh-Hans')).toContain('2026');
  });

  it('formats a relative time with ICU', () => {
    const now = Date.UTC(2026, 0, 15, 12);
    expect(formatRelative(now + 2 * 3_600_000, 'en', now)).toBe('in 2 hours');
    expect(formatRelative(now - 3 * 86_400_000, 'en', now)).toBe('3 days ago');
  });

  it('formats numbers per locale', () => {
    expect(formatNumber(1234.5, 'en', { maximumFractionDigits: 0 })).toBe('1,235');
  });
});

describe('weekStartDay', () => {
  it('returns 0 for English (Sunday first)', () => {
    expect(weekStartDay('en')).toBe(0);
  });

  it('returns 1 for Chinese (Monday first)', () => {
    expect(weekStartDay('zh-Hans')).toBe(1);
  });

  it('falls back safely for an unresolvable tag', () => {
    expect(weekStartDay('')).toBe(1);
  });
});
