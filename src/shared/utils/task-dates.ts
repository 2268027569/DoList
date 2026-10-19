/**
 * Translating between the stored instant and the values the detail view's date
 * and time controls speak (docs/FEATURES.md M02, M02-PLAN §7).
 *
 * The database holds UTC milliseconds only, while a native `<input type="date">`
 * speaks a local `YYYY-MM-DD` and a `type="time"` a local `HH:mm`. Both sides are
 * pure functions so the daylight-saving edges are unit-testable: a "date only"
 * due sits at local midnight, and "today" is built from date parts rather than by
 * adding 24 hours, because a day is not always 24 hours long.
 */

/** The hour a due time starts at when the user first switches the clock on. */
export const DEFAULT_DUE_HOUR = 9;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD` in the machine's own timezone — the value a date input reads. */
export function toDateValue(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `HH:mm`, the value a time input reads. */
export function toTimeValue(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The instant a date/time pair means, or `null` when the date is missing.
 *
 * A date the month does not have is rejected instead of rolling over: `2026-02-30`
 * would otherwise silently become March 2nd, and the user would be saved a date
 * they never typed.
 */
export function fromDueValues(date: string, time: string, hasTime: boolean): number | null {
  const day = parseDateValue(date);
  if (day === null) return null;

  const [year, month, dateOfMonth] = day;
  if (!hasTime) return new Date(year, month - 1, dateOfMonth).getTime();

  const clock = parseTimeValue(time);
  const [hours, minutes] = clock ?? [DEFAULT_DUE_HOUR, 0];
  return new Date(year, month - 1, dateOfMonth, hours, minutes).getTime();
}

/**
 * Local midnight `offsetDays` away from `now`. Built from date parts so a
 * daylight-saving switch cannot land it at 23:00 or 01:00.
 */
export function dayStartOffset(now: number, offsetDays: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays).getTime();
}

/** The instant a due date means: midnight of today, or of tomorrow. */
export function dueToday(now: number = Date.now()): number {
  return dayStartOffset(now, 0);
}

export function dueTomorrow(now: number = Date.now()): number {
  return dayStartOffset(now, 1);
}

/**
 * Re-reads an instant under a new "include a time" setting.
 *
 * Switching the clock on gives a date-only value a usable hour instead of leaving
 * it at midnight, where the time control would show `00:00` and look broken; a
 * value that already carries a clock time keeps it.
 */
export function withDueTime(ms: number, hasTime: boolean): number {
  const date = new Date(ms);
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (!hasTime) return dayStart;
  if (date.getHours() === 0 && date.getMinutes() === 0) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), DEFAULT_DUE_HOUR, 0).getTime();
  }
  return ms;
}

function parseDateValue(date: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const dateOfMonth = Number(match[3]);
  if (month < 1 || month > 12 || dateOfMonth < 1 || dateOfMonth > 31) return null;

  const probe = new Date(year, month - 1, dateOfMonth);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== dateOfMonth) {
    return null;
  }
  return [year, month, dateOfMonth];
}

function parseTimeValue(time: string): [number, number] | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (match === null) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return [hours, minutes];
}
