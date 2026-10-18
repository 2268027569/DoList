import { getDatabase } from '../connection';
import type { DayBounds } from '@shared/utils/day';

/** Task counts the marker badge and ring are derived from (docs/FEATURES.md M01). */
export interface MarkerCounts {
  /** Not done and not cancelled. */
  open: number;
  /** Not done, with a due time already in the past. */
  overdue: number;
  /** Every task due inside today's window, done or not. */
  dueToday: number;
  /** Of those, the ones already completed. */
  doneToday: number;
  /** Not done, due within the next 24 hours but not yet overdue. */
  dueSoon: number;
}

/** Statuses that still represent work (mirrors the schema's status comment). */
const ACTIVE = "status NOT IN ('done', 'cancelled')";

/**
 * Single round trip per count, all filtered through the `deleted_at` soft-delete
 * tombstone (§5.1). Kept as one function so M02's task queries and this badge
 * source cannot drift apart.
 */
export function markerCounts(now: number, day: DayBounds): MarkerCounts {
  const db = getDatabase();
  const scalar = (sql: string, ...params: unknown[]): number => {
    const row = db.prepare(sql).get(...params) as { count?: number } | undefined;
    return row?.count ?? 0;
  };
  const live = 'FROM tasks WHERE deleted_at IS NULL';

  return {
    open: scalar(`SELECT COUNT(*) AS count ${live} AND ${ACTIVE}`),
    overdue: scalar(`SELECT COUNT(*) AS count ${live} AND ${ACTIVE} AND due_at IS NOT NULL AND due_at < ?`, now),
    dueToday: scalar(`SELECT COUNT(*) AS count ${live} AND due_at >= ? AND due_at < ?`, day.start, day.end),
    doneToday: scalar(`SELECT COUNT(*) AS count ${live} AND status = 'done' AND due_at >= ? AND due_at < ?`, day.start, day.end),
    dueSoon: scalar(
      `SELECT COUNT(*) AS count ${live} AND ${ACTIVE} AND due_at IS NOT NULL AND due_at >= ? AND due_at < ?`,
      now,
      now + 86_400_000,
    ),
  };
}
