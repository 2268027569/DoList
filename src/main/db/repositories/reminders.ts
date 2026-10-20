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
 * Makes `fireAt` the task's one waiting instance, or clears it when `fireAt` is `null`.
 *
 * Deliberately a replace rather than an insert: a task has at most one reminder
 * *waiting*, and re-deriving it after the due date or the lead changed must not
 * leave the old one armed — the user would be told twice, once at a time they have
 * just moved away from. Instances that already fired are left alone: they are the
 * record of what was said, and re-reading the task later must not rewrite history.
 *
 * A moment that has already gone by is written down as it is, not refused. Whether it is
 * still worth saying needs the grace rule, which the caller applies first (`armableFireAt`
 * in `shared/utils/reminder.ts`); by the time this is called, the moment is simply the
 * moment. A waiting instance at a past time is ordinary — the scheduler arms a zero-delay
 * timer for it and speaks on the next tick.
 *
 * One moment is announced once. A moment that already has an instance which is not
 * waiting has been spoken or answered, so re-deriving the task after an unrelated edit
 * (a renamed title) leaves it alone rather than resurrecting the reminder.
 */
export function replacePendingReminder(
  taskId: string,
  fireAt: number | null,
  now: number,
): Reminder | null {
  const db = getDatabase();
  const run = db.transaction((): string | null => {
    db.prepare(`DELETE FROM reminders WHERE task_id = ? AND state = 'pending'`).run(taskId);
    if (fireAt === null) return null;

    const spoken = db
      .prepare(
        `SELECT 1 FROM reminders
          WHERE task_id = ? AND fire_at = ? AND state <> 'pending'
          LIMIT 1`,
      )
      .get(taskId, fireAt);
    if (spoken !== undefined) return null;

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

/** An open task whose reminder is due, as the reconciliation pass needs it. */
export interface TaskAwaitingReminder {
  id: string;
  dueAt: number;
  remindLeadMin: number;
}

/**
 * Open tasks whose reminder moment has no instance of its own.
 *
 * An instance is derived data — the task row and its lead decide the moment — so this is
 * the query that lets the projection be rebuilt. Whatever a write failed to leave behind
 * (a process that died between the two writes, or a build whose rule was different) shows
 * up here, and the pass that consumes it re-derives it.
 *
 * A moment that already has an instance of *any* state is not returned: one that is
 * waiting belongs to the scheduler, and one that has spoken must not be said again.
 * `fire_at` is computed the way `fireAtFor` computes it, which is what makes the lookup
 * land on the same moment the write would have written.
 */
export function tasksMissingReminderInstance(): TaskAwaitingReminder[] {
  return getDatabase()
    .prepare(
      `SELECT t.id AS id, t.due_at AS dueAt, t.remind_lead_min AS remindLeadMin
         FROM tasks t
        WHERE t.deleted_at IS NULL
          AND t.status NOT IN ('done', 'cancelled')
          AND t.due_at IS NOT NULL
          AND t.remind_lead_min IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM reminders r
                 WHERE r.task_id = t.id
                   AND r.fire_at = t.due_at - t.remind_lead_min * 60000
              )`,
    )
    .all() as TaskAwaitingReminder[];
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
