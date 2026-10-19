import { formatDayOffset, formatRelative, formatTime } from '../i18n/format';
import { localDayBounds } from './day';

/**
 * The due-date chip a list row renders (docs/FEATURES.md M02).
 *
 * Pure and locale-aware so the colour and the wording are decided in one place
 * and can be unit-tested without a DOM. The renderer only maps `kind` onto a
 * token, it never decides whether something is late.
 *
 * A date-only task is judged by the local day it falls in, not by the instant:
 * one due "today" is not overdue at 5pm just because its `due_at` is midnight.
 */

export type DueChipKind = 'overdue' | 'today' | 'later';

export interface DueChip {
  /** Drives the chip's colour; only `overdue` reads as a failure. */
  kind: DueChipKind;
  /** Locale-aware: "today" / "in 3 days" / "5:00 PM" / "2 hours ago". */
  text: string;
}

const MS_PER_DAY = 86_400_000;

/** `null` when the task has no due date, so the row renders no chip at all. */
export function dueChip(
  dueAt: number | null,
  dueHasTime: boolean,
  locale: string,
  now: number = Date.now(),
): DueChip | null {
  if (dueAt === null) return null;

  const today = localDayBounds(now).start;
  const dueDay = localDayBounds(dueAt).start;
  // Whole local days apart, from the day starts rather than from the instants, so
  // a midnight timestamp and a 9am one land on the same day.
  const dayOffset = Math.round((dueDay - today) / MS_PER_DAY);
  const overdue = dueHasTime ? dueAt < now : dayOffset < 0;

  // A timed task reads as how long ago it was ("2 hours ago"); a date-only one as
  // which day it was ("yesterday"), which is the only thing its instant knows.
  if (overdue) {
    return {
      kind: 'overdue',
      text: dueHasTime ? formatRelative(dueAt, locale, now) : formatDayOffset(dayOffset, locale),
    };
  }

  if (dayOffset === 0) {
    // A clock time is the useful detail when the task is due later today;
    // otherwise "today" itself is the whole answer.
    return {
      kind: 'today',
      text: dueHasTime ? formatTime(dueAt, locale) : formatDayOffset(0, locale),
    };
  }

  return { kind: 'later', text: formatDayOffset(dayOffset, locale) };
}
