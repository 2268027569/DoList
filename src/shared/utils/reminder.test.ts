import { describe, expect, it } from 'vitest';

import {
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  REMINDER_GRACE_MS,
  REMIND_LEAD_PRESETS,
  armableFireAt,
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

describe('armableFireAt', () => {
  const now = new Date(2026, 4, 12, 18, 47, 0).getTime();

  it('takes a moment still to come as it is', () => {
    const due = now + 60 * 60_000;
    expect(armableFireAt(due, 30, now)).toBe(due - 30 * 60_000);
  });

  it('keeps a moment that has just gone by, so it speaks at once', () => {
    // "Five minutes before 18:50" finished being set at 18:47: the moment it names,
    // 18:45, is already behind us. Dropping it would leave the user with a reminder that
    // silently never arrives; keeping it leaves a waiting instance the scheduler arms
    // with a delay of zero.
    const due = now + 3 * 60_000;
    expect(armableFireAt(due, 5, now)).toBe(due - 5 * 60_000);
    expect(armableFireAt(due, 5, now)).toBeLessThan(now);
  });

  it('keeps a moment exactly now', () => {
    expect(armableFireAt(now + 30 * 60_000, 30, now)).toBe(now);
  });

  it('refuses a moment older than the grace', () => {
    // Nothing useful is left to say about a deadline a day gone: the task already reads
    // as overdue in its own list.
    const due = now - 24 * 60 * 60_000;
    expect(armableFireAt(due, 30, now)).toBeNull();
    // At the edge — a moment exactly the grace old — it is still kept.
    const edge = now - REMINDER_GRACE_MS + 30 * 60_000;
    expect(armableFireAt(edge, 30, now)).toBe(now - REMINDER_GRACE_MS);
    // And a moment a minute older than that is not.
    expect(armableFireAt(edge - 60_000, 30, now)).toBeNull();
  });

  it('answers null when either half of the reminder is missing', () => {
    expect(armableFireAt(null, 30, now)).toBeNull();
    expect(armableFireAt(now + 60 * 60_000, null, now)).toBeNull();
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
