import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DUE_HOUR,
  dayStartOffset,
  dueToday,
  dueTomorrow,
  fromDueValues,
  toDateValue,
  toTimeValue,
  withDueTime,
} from './task-dates';

/**
 * Local-time constructors on purpose, exactly as in `task-due-label.test.ts`: what
 * is being checked is how the stored instant relates to the machine's own day, so
 * UTC-built inputs would test the runner's timezone instead of the functions.
 */
const NOW = new Date(2026, 9, 19, 15, 30, 0).getTime(); // 2026-10-19 15:30 local
const at = (...parts: [number, number, number, number?, number?]): number =>
  new Date(parts[0], parts[1], parts[2], parts[3] ?? 0, parts[4] ?? 0).getTime();

describe('toDateValue / toTimeValue', () => {
  it('reads an instant back in the local day and clock the controls speak', () => {
    expect(toDateValue(at(2026, 9, 19, 15, 30))).toBe('2026-10-19');
    expect(toTimeValue(at(2026, 9, 19, 15, 30))).toBe('15:30');
  });

  it('pads single digit months, days and minutes', () => {
    expect(toDateValue(at(2026, 0, 5, 9, 5))).toBe('2026-01-05');
    expect(toTimeValue(at(2026, 0, 5, 9, 5))).toBe('09:05');
  });
});

describe('fromDueValues', () => {
  it('sends a date without a time to local midnight', () => {
    expect(fromDueValues('2026-10-20', '', false)).toBe(at(2026, 9, 20));
  });

  it('combines the date and the clock when the time is included', () => {
    expect(fromDueValues('2026-10-20', '08:45', true)).toBe(at(2026, 9, 20, 8, 45));
  });

  it('falls back to the default morning hour when the time is blank', () => {
    expect(fromDueValues('2026-10-20', '', true)).toBe(at(2026, 9, 20, DEFAULT_DUE_HOUR));
  });

  it('has no instant when the date input is empty or incomplete', () => {
    expect(fromDueValues('', '08:45', true)).toBeNull();
    expect(fromDueValues('2026-1-2', '', false)).toBeNull();
    expect(fromDueValues('20 October', '', false)).toBeNull();
  });

  it('rejects a day the month does not have instead of rolling it over', () => {
    // February 30th would otherwise become March 2nd and save a date nobody typed.
    expect(fromDueValues('2026-02-30', '', false)).toBeNull();
    expect(fromDueValues('2026-13-01', '', false)).toBeNull();
  });

  it('accepts February 29th of a leap year', () => {
    expect(fromDueValues('2028-02-29', '', false)).toBe(at(2028, 1, 29));
  });
});

describe('dueToday / dueTomorrow', () => {
  it('builds the day from date parts, so both are local midnight', () => {
    expect(dueToday(NOW)).toBe(at(2026, 9, 19));
    expect(dueTomorrow(NOW)).toBe(at(2026, 9, 20));
  });

  it('rolls into the next month and year correctly', () => {
    expect(dayStartOffset(at(2026, 11, 31, 23, 0), 1)).toBe(at(2027, 0, 1));
    expect(dayStartOffset(at(2026, 0, 1, 0, 30), -1)).toBe(at(2025, 11, 31));
  });
});

describe('withDueTime', () => {
  it('moves a date-only due to the default hour when the clock is switched on', () => {
    expect(withDueTime(at(2026, 9, 20), true)).toBe(at(2026, 9, 20, DEFAULT_DUE_HOUR));
  });

  it('keeps an existing clock time', () => {
    expect(withDueTime(at(2026, 9, 20, 8, 45), true)).toBe(at(2026, 9, 20, 8, 45));
  });

  it('drops the clock again when it is switched off, keeping the day', () => {
    expect(withDueTime(at(2026, 9, 20, 23, 59), false)).toBe(at(2026, 9, 20));
  });
});
