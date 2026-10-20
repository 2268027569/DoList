import { z } from 'zod';

/**
 * Zod contracts for the reminder channels (docs/ARCHITECTURE.md §6.4).
 *
 * There is only one renderer -> main channel here on purpose: the panel does not ask
 * for reminders and does not schedule them. It is told when one is due, and the one
 * thing it can say back is "the user answered it" — which is the fact the main
 * process cannot observe for itself (M04).
 */

const identifier = z.string().min(1).max(128);

export const reminderDismissInput = z.object({ id: identifier });

/**
 * Main -> panel: a reminder went unanswered long enough that the in-app card takes
 * over from the OS notification. Carries the little the card draws, rather than an
 * id the panel would have to look up: the row it stands for is the main process's
 * record, and the card is a notification, not a view of the data.
 */
export interface ReminderDuePayload {
  /** The reminder instance, which is what `reminder:dismiss` names back. */
  id: string;
  taskId: string;
  title: string;
  /** The task's due time, UTC ms; `null` when it has none. */
  dueAt: number | null;
}

/** Main -> panel: open this task (a reminder notification was clicked). */
export interface TaskFocusPayload {
  taskId: string;
}
