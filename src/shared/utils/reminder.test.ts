import { describe, expect, it } from 'vitest';

import {
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  REMIND_LEAD_PRESETS,
  fireAtFor,
  leadBucketOf,
} from './reminder';

describe('fireAtFor', () => {
  it('counts back from the due moment, not forward from now', () => {
    const due = new Date(2026, 4, 12, 9, 0, 0).getTime();
    expect(fireAtFor(due, 30)).toBe(due - 30 * 60_000);
  });

  it('answers null when the task has no deadline', () => {
    // A lead with nothing to lead up to is not a reminder at a default time — there
    // is no time to default to.
    expect(fireAtFor(null, 30)).toBeNull();
  });

  it('answers null when the task has no lead', () => {
    expect(fireAtFor(new Date(2026, 4, 12).getTime(), null)).toBeNull();
  });

  it('accepts a lead of zero, which fires at the deadline itself', () => {
    const due = new Date(2026, 4, 12, 9, 0, 0).getTime();
    expect(fireAtFor(due, 0)).toBe(due);
  });
});

describe('REMIND_LEAD_PRESETS', () => {
  it('is the five leads the detail offers, in ascending order', () => {
    expect(REMIND_LEAD_PRESETS).toEqual([5, 10, 30, MINUTES_PER_HOUR, MINUTES_PER_DAY]);
  });

  it('stays ascending, so the chips read as a scale', () => {
    const sorted = [...REMIND_LEAD_PRESETS].sort((a, b) => a - b);
    expect([...REMIND_LEAD_PRESETS]).toEqual(sorted);
  });
});

describe('leadBucketOf', () => {
  it('names a whole day as days', () => {
    expect(leadBucketOf(MINUTES_PER_DAY)).toBe('days');
    expect(leadBucketOf(MINUTES_PER_DAY * 2)).toBe('days');
  });

  it('names a whole hour as hours', () => {
    expect(leadBucketOf(MINUTES_PER_HOUR)).toBe('hours');
    expect(leadBucketOf(MINUTES_PER_HOUR * 2)).toBe('hours');
  });

  it('names everything else as minutes, including a day-and-a-half', () => {
    expect(leadBucketOf(5)).toBe('minutes');
    expect(leadBucketOf(90)).toBe('minutes');
    // 1500 minutes is 25 hours: a whole number of hours but not of days, so it is
    // spoken in hours rather than being rounded up into a day it is not.
    expect(leadBucketOf(MINUTES_PER_DAY + MINUTES_PER_HOUR)).toBe('hours');
  });
});
