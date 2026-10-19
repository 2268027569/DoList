import { describe, expect, it } from 'vitest';

import { isValidRule, nextOccurrence } from './recurrence';

/**
 * Local dates, asserted through their local components: the data layer stores UTC
 * milliseconds, but what a user means by "next Monday" is a local date, and these
 * cases stay true in whatever timezone the suite runs in.
 */
const at = (year: number, month: number, day: number, hours = 0, minutes = 0): number =>
  new Date(year, month - 1, day, hours, minutes).getTime();

const parts = (ms: number): [number, number, number, number, number] => {
  const date = new Date(ms);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
};

/** A date-only due at local midnight, which is how the panel stores one. */
const dayOnly = (year: number, month: number, day: number): number => at(year, month, day);

describe('nextOccurrence', () => {
  it('advances a daily task to the next day, keeping its clock time', () => {
    const next = nextOccurrence({
      rule: 'FREQ=DAILY',
      mode: 'fixed',
      due: at(2026, 10, 19, 9),
      dueHasTime: true,
      now: at(2026, 10, 19, 20),
    });
    expect(next).not.toBeNull();
    expect(parts(next as number)).toEqual([2026, 10, 20, 9, 0]);
  });

  it('keeps a date-only task at local midnight', () => {
    const next = nextOccurrence({
      rule: 'FREQ=DAILY',
      mode: 'fixed',
      due: dayOnly(2026, 10, 19),
      dueHasTime: false,
      now: at(2026, 10, 19, 20),
    });
    expect(parts(next as number)).toEqual([2026, 10, 20, 0, 0]);
  });

  it('skips the weekend for a workday rule, and the missed days of a late one', () => {
    // Friday the 16th; the next workday is Monday the 19th.
    expect(
      parts(
        nextOccurrence({
          rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
          mode: 'fixed',
          due: at(2026, 10, 16, 9),
          dueHasTime: true,
          now: at(2026, 10, 16, 10),
        }) as number,
      ),
    ).toEqual([2026, 10, 19, 9, 0]);

    // Completed three weeks late: the Mondays it sat through are skipped rather
    // than queued up, so the follow-up is the next Monday, not one in the past.
    expect(
      parts(
        nextOccurrence({
          rule: 'FREQ=WEEKLY;BYDAY=MO',
          mode: 'fixed',
          due: at(2026, 9, 7, 9),
          dueHasTime: true,
          now: at(2026, 9, 28, 10),
        }) as number,
      ),
    ).toEqual([2026, 10, 5, 9, 0]);
  });

  it('keeps a weekly rule on the day of the week it was scheduled for', () => {
    expect(
      parts(
        nextOccurrence({
          rule: 'FREQ=WEEKLY',
          mode: 'fixed',
          due: at(2026, 10, 19, 9),
          dueHasTime: true,
          now: at(2026, 10, 19, 9, 5),
        }) as number,
      ),
    ).toEqual([2026, 10, 26, 9, 0]);
  });

  it('skips the months a 31st does not exist in, and the years February 29th does not', () => {
    // RRULE means the 31st itself: February is skipped, not clamped to the 28th.
    expect(
      parts(
        nextOccurrence({
          rule: 'FREQ=MONTHLY',
          mode: 'fixed',
          due: at(2026, 1, 31, 9),
          dueHasTime: true,
          now: at(2026, 2, 1, 9),
        }) as number,
      ),
    ).toEqual([2026, 3, 31, 9, 0]);

    expect(
      parts(
        nextOccurrence({
          rule: 'FREQ=YEARLY',
          mode: 'fixed',
          due: at(2024, 2, 29, 9),
          dueHasTime: true,
          now: at(2024, 3, 1, 9),
        }) as number,
      ),
    ).toEqual([2028, 2, 29, 9, 0]);

    // The last day of the month is a rule the user can type instead (`BYMONTHDAY=-1`).
    expect(
      parts(
        nextOccurrence({
          rule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
          mode: 'fixed',
          due: at(2026, 1, 31, 9),
          dueHasTime: true,
          now: at(2026, 1, 31, 10),
        }) as number,
      ),
    ).toEqual([2026, 2, 28, 9, 0]);
  });

  it('counts from the completion day in after_completion mode, keeping the clock time', () => {
    // Every 3 days, due on the 10th, ticked late on the 13th: the interval starts
    // again there, so the follow-up is the 16th.
    expect(
      parts(
        nextOccurrence({
          rule: 'FREQ=DAILY;INTERVAL=3',
          mode: 'after_completion',
          due: at(2026, 10, 10, 9),
          dueHasTime: true,
          now: at(2026, 10, 13, 20),
        }) as number,
      ),
    ).toEqual([2026, 10, 16, 9, 0]);

    // In fixed mode the same completion stays on the original cadence.
    expect(
      parts(
        nextOccurrence({
          rule: 'FREQ=DAILY;INTERVAL=3',
          mode: 'fixed',
          due: at(2026, 10, 10, 9),
          dueHasTime: true,
          now: at(2026, 10, 13, 20),
        }) as number,
      ),
    ).toEqual([2026, 10, 16, 9, 0]);
  });

  it('re-anchors the weekday in after_completion mode', () => {
    // Scheduled Mondays, ticked on a Wednesday: counting from completion moves the
    // pattern onto Wednesdays, which is what this mode is for.
    expect(
      parts(
        nextOccurrence({
          rule: 'FREQ=WEEKLY',
          mode: 'after_completion',
          due: at(2026, 10, 19, 9),
          dueHasTime: true,
          now: at(2026, 10, 21, 9, 30),
        }) as number,
      ),
    ).toEqual([2026, 10, 28, 9, 0]);
  });

  it('answers null when the rule has run out', () => {
    expect(
      nextOccurrence({
        rule: 'FREQ=DAILY;COUNT=1',
        mode: 'fixed',
        due: at(2026, 10, 19, 9),
        dueHasTime: true,
        now: at(2026, 10, 19, 10),
      }),
    ).toBeNull();

    expect(
      nextOccurrence({
        rule: 'FREQ=DAILY;UNTIL=20261019T000000',
        mode: 'fixed',
        due: at(2026, 10, 18, 9),
        dueHasTime: true,
        now: at(2026, 10, 18, 10),
      }),
    ).toBeNull();
  });

  it('answers null rather than throwing on a rule that is not one', () => {
    for (const rule of ['', '   ', 'RRULE:', 'NOPE=1', 'FREQ=NOPE', 'COUNT=5', 'FREQ=WEEKLY;BYDAY=XX']) {
      expect(
        nextOccurrence({
          rule,
          mode: 'fixed',
          due: at(2026, 10, 19, 9),
          dueHasTime: true,
          now: at(2026, 10, 19, 10),
        }),
        rule,
      ).toBeNull();
    }
  });

  it('accepts a rule with the RFC prefix in front', () => {
    expect(
      parts(
        nextOccurrence({
          rule: 'RRULE:FREQ=DAILY',
          mode: 'fixed',
          due: at(2026, 10, 19, 9),
          dueHasTime: true,
          now: at(2026, 10, 19, 10),
        }) as number,
      ),
    ).toEqual([2026, 10, 20, 9, 0]);
  });
});

describe('isValidRule', () => {
  it('accepts the rules the presets use and a custom one', () => {
    for (const rule of [
      'FREQ=DAILY',
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      'FREQ=WEEKLY',
      'FREQ=MONTHLY;BYMONTHDAY=-1',
      'FREQ=YEARLY',
      'RRULE:FREQ=DAILY;INTERVAL=2',
    ]) {
      expect(isValidRule(rule), rule).toBe(true);
    }
  });

  it('rejects what would silently never repeat', () => {
    for (const rule of ['', '  ', 'every day', 'FREQ=', 'NOPE=1', 'FREQ=WEEKLY;BYDAY=XX']) {
      expect(isValidRule(rule), rule).toBe(false);
    }
  });
});
