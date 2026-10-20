import type { Reminder, ReminderState } from '@shared/types/reminder';
import { newId } from '@shared/utils/id';

import { getDatabase } from '../connection';

/**
 * Reminder instances (docs/ARCHITECTURE.md §5.3).
 *
 * The table holds *generated* instances rather than the user's intent: a task says
 * "remind me 30 minutes before", and this layer is where that becomes a row with a
 * concrete `fire_at`. Everything the delivery path needs a memory for — "this one
 * already went out", "the user answered it", "this one was missed" — is a `state` on
 * the row, so the rules above it stay stateless and survive a restart.
 *
 * There is no `updated_at`/`deleted_at` here, unlike the business tables: instances
 * are not synced entities (they are re-derived from the task on the other device) and
 * they are never edited in place beyond their state.
 */

const COLUMNS = 'r.id, r.task_id, r.fire_at, r.state, r.snooze_until';

interface ReminderRow {
  id: string;
  task_id: string;
  fire_at: number;
  state: string;
  snooze_until: number | null;
}

/** One row, or `null` when the id is unknown. */
export function getReminder(id: string): Reminder | null {
  const row = getDatabase()
    .prepare(`SELECT ${COLUMNS} FROM reminders r WHERE r.id = ?`)
    .get(id) as ReminderRow | undefined;
  return row === undefined ? null : mapReminder(row);
}

/** Every instance of one task, oldest fire first — history included. */
export function listRemindersForTask(taskId: string): Reminder[] {
  const rows = getDatabase()
    .prepare(`SELECT ${COLUMNS} FROM reminders r WHERE r.task_id = ? ORDER BY r.fire_at ASC, r.id ASC`)
    .all(taskId) as ReminderRow[];
  return rows.map(mapReminder);
}

/**
 * Makes `fireAt` the task's one waiting instance, or clears it when `fireAt` is
 * `null`.
 *
 * Deliberately a replace rather than an insert: a task has at most one reminder
 * *waiting*, and re-deriving it after the due date or the lead changed must not
 * leave the old one armed — the user would be told twice, once at a time they have
 * just moved away from. Instances that already fired are left alone: they are the
 * record of what was said, and re-reading the task later must not rewrite history.
 *
 * A moment already past is not armed: a reminder exists to speak *before* the
 * deadline, so arming one the user just walked past would announce something already
 * overdue the instant they set it. Reminders missed while the app was closed are a
 * different case — they are rows that were armed earlier and are still `pending`,
 * and the launch pass in `services/scheduler.ts` is what decides about those.
 */
export function replacePendingReminder(
  taskId: string,
  fireAt: number | null,
  now: number,
): Reminder | null {
  const db = getDatabase();
  const run = db.transaction((): string | null => {
    db.prepare(`DELETE FROM reminders WHERE task_id = ? AND state = 'pending'`).run(taskId);
    if (fireAt === null || fireAt <= now) return null;

    const id = newId(now);
    db.prepare(
      `INSERT INTO reminders (id, task_id, fire_at, state, snooze_until)
       VALUES (?, ?, ?, 'pending', NULL)`,
    ).run(id, taskId, fireAt);
    return id;
  });

  const id = run();
  return id === null ? null : getReminder(id);
}

/**
 * Drops the waiting instance of every named task. Used by a delete (a task in the
 * recycle bin must not still be announced) and by the bulk delete that takes the
 * subtasks down with it.
 */
export function clearPendingReminders(taskIds: readonly string[]): number {
  const unique = [...new Set(taskIds)];
  if (unique.length === 0) return 0;

  const placeholders = unique.map(() => '?').join(', ');
  return getDatabase()
    .prepare(`DELETE FROM reminders WHERE state = 'pending' AND task_id IN (${placeholders})`)
    .run(...unique).changes;
}

/** The earliest waiting fire time, or `null` when nothing is waiting. */
export function nextPendingFireAt(): number | null {
  const row = getDatabase()
    .prepare(`SELECT MIN(fire_at) AS at FROM reminders WHERE state = 'pending'`)
    .get() as { at: number | null } | undefined;
  return row?.at ?? null;
}

/** The waiting instances whose time has come, oldest first. */
export function pendingRemindersDueBy(at: number): Reminder[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${COLUMNS} FROM reminders r
        WHERE r.state = 'pending' AND r.fire_at <= ?
        ORDER BY r.fire_at ASC, r.id ASC`,
    )
    .all(at) as ReminderRow[];
  return rows.map(mapReminder);
}

/** Moves one instance to another state. Answers `false` when the id is unknown. */
export function setReminderState(id: string, state: ReminderState): boolean {
  return getDatabase().prepare('UPDATE reminders SET state = ? WHERE id = ?').run(state, id)
    .changes > 0;
}

/**
 * Dismisses every waiting instance that came due before `at`, and answers how many
 * there were.
 *
 * This is what a launch does with reminders that were missed while the app was not
 * running: one that is a few hours late is still worth saying, one from days ago is
 * not — the task itself already shows as overdue on the marker, and a burst of
 * notifications about things the user has long since dealt with is worse than
 * silence (§5.3, "错过的提醒").
 */
export function dismissPendingBefore(at: number): number {
  return getDatabase()
    .prepare(`UPDATE reminders SET state = 'dismissed' WHERE state = 'pending' AND fire_at < ?`)
    .run(at).changes;
}

function mapReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    taskId: row.task_id,
    fireAt: row.fire_at,
    state: row.state as ReminderState,
    snoozeUntil: row.snooze_until,
  };
}
