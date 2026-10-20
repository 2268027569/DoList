/**
 * Reminder timing, as pure arithmetic shared by the main process and the panel
 * (docs/FEATURES.md M04 「提前提醒」).
 */

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/**
 * The five lead times the detail offers before its custom field: 5 / 10 / 30
 * minutes, 1 hour, 1 day. Minutes, because that is the unit the column stores.
 */
export const REMIND_LEAD_PRESETS = [5, 10, 30, MINUTES_PER_HOUR, MINUTES_PER_DAY] as const;

/**
 * When a task's reminder should fire: the due time minus its lead.
 *
 * `null` when either half is missing — a reminder is defined *relative to* a
 * deadline, so a task with no due date and a task with no lead both have nothing to
 * schedule. It is deliberately not "now plus something": the user picks how long
 * before the deadline to be told, and the deadline is what places the moment.
 */
export function fireAtFor(dueAt: number | null, leadMin: number | null): number | null {
  if (dueAt === null || leadMin === null) return null;
  return dueAt - leadMin * 60_000;
}

/**
 * How late a reminder moment is still worth speaking at.
 *
 * The same rule is read twice, and this is where it is written down once: a launch that
 * finds a waiting instance missed while the app was closed, and a write that arms a lead
 * whose moment the user has just walked past. A few hours late is still useful — the
 * task is not yet out of mind. A day or a week late is not: the task already shows as
 * overdue in its own list, and a burst of notifications about things long since dealt
 * with only teaches the user to ignore the next one.
 */
export const REMINDER_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * The moment a task's reminder should be armed for, or `null` when there is none to arm.
 *
 * `fireAtFor` answers what the user asked for; this answers whether it is still worth
 * asking. A moment in the future is taken as it is. A moment that has *just* gone by is
 * kept rather than dropped — the instance is then waiting at a time already past, and
 * the scheduler arms its timer with a delay of zero, so it speaks on the next tick
 * instead of never. That is what stops "remind me five minutes before 18:50" from being
 * silently thrown away when the user finishes setting it at 18:47. Only a moment further
 * back than the grace is refused, and then on purpose: there is nothing useful left to
 * say about it.
 */
export function armableFireAt(
  dueAt: number | null,
  leadMin: number | null,
  now: number,
): number | null {
  const at = fireAtFor(dueAt, leadMin);
  if (at === null || at > now) return at;
  return now - at <= REMINDER_GRACE_MS ? at : null;
}

/**
 * The name a preset shows. Written as a lookup rather than a bare number so the
 * panel never has to explain "1440" to a reader, and so a preset can be a whole
 * hour or a whole day where it is one.
 */
export function leadBucketOf(leadMin: number): 'minutes' | 'hours' | 'days' {
  if (leadMin >= MINUTES_PER_DAY && leadMin % MINUTES_PER_DAY === 0) return 'days';
  if (leadMin >= MINUTES_PER_HOUR && leadMin % MINUTES_PER_HOUR === 0) return 'hours';
  return 'minutes';
}
