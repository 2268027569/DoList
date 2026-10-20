/**
 * Reminder entity types, shared by the main process, the preload bridge and the
 * panel. They mirror the `reminders` table (docs/ARCHITECTURE.md §5.2): same fields,
 * camelCase instead of snake_case, every timestamp in UTC milliseconds.
 *
 * A row is one **instance** of a reminder, not the user's intent — the intent lives
 * on the task as `remindLeadMin`, and the scheduler turns it into an instance (§5.3).
 * That is what gives "this one already fired", "this one was answered" and a future
 * "snoozed until" a place to be recorded, which a single `remind_at` column on the
 * task could not.
 */

export const REMINDER_STATES = ['pending', 'fired', 'snoozed', 'dismissed'] as const;
export type ReminderState = (typeof REMINDER_STATES)[number];

/** One row of `reminders`, as the data layer stores it. */
export interface Reminder {
  id: string;
  taskId: string;
  /** When the instance should be delivered, UTC ms. */
  fireAt: number;
  /**
   * `pending` waits for `fireAt`; `fired` has been delivered (the OS notification
   * went out) and is only left once the user answers it; `dismissed` is answered.
   * `snoozed` waits for `snoozeUntil` — the column is in place for M04 P2.
   */
  state: ReminderState;
  /** Set by a snooze; `null` otherwise. */
  snoozeUntil: number | null;
}
