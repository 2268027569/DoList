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
 * The name a preset shows. Written as a lookup rather than a bare number so the
 * panel never has to explain "1440" to a reader, and so a preset can be a whole
 * hour or a whole day where it is one.
 */
export function leadBucketOf(leadMin: number): 'minutes' | 'hours' | 'days' {
  if (leadMin >= MINUTES_PER_DAY && leadMin % MINUTES_PER_DAY === 0) return 'days';
  if (leadMin >= MINUTES_PER_HOUR && leadMin % MINUTES_PER_HOUR === 0) return 'hours';
  return 'minutes';
}
