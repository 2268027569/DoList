/**
 * Local-day boundaries (docs/ARCHITECTURE.md §5.1): the database stores UTC
 * milliseconds only, so "today" is resolved against the machine's own clock
 * rather than persisted as a date string.
 *
 * Usage: count tasks whose `due_at` falls inside `[start, end)`.
 */
export interface DayBounds {
  /** Local midnight, inclusive. */
  start: number;
  /** Next local midnight, exclusive. */
  end: number;
}

export function localDayBounds(now: number): DayBounds {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Rebuilding from the date parts (instead of adding 24h) keeps the boundary
  // correct across daylight-saving transitions, where a day is not 24 hours.
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  return { start, end };
}
