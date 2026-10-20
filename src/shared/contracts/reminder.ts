import { z } from 'zod';

/**
 * Zod contracts for the reminder channels (docs/ARCHITECTURE.md §6.4).
 *
 * The renderer does not ask for reminders and does not schedule them: the scheduler
 * arms them and the notification layer announces them. What a renderer can say back is
 * the two ways a user answers the popup — that the task is done, or that the popup was
 * read and put away — both of which are facts the main process cannot observe for
 * itself (M04).
 */

const identifier = z.string().min(1).max(128);

export const reminderDismissInput = z.object({ id: identifier });

/**
 * The other answer: the user ticked the task off from the popup (M04).
 *
 * It names the task as well as the instance because the two writes it stands for are
 * different kinds of row — the task's status and the reminder's state — and the popup
 * is the only place that knows they belong together.
 */
export const reminderDoneInput = z.object({ id: identifier, taskId: identifier });

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

/**
 * The query-string name the popup's payload travels under (M04).
 *
 * The popup window is drawn from this rather than from an IPC read: the payload is four
 * small fields, and handing them over with the window means the popup paints the right
 * reminder on its first frame instead of flashing an empty card while it waits.
 */
export const REMINDER_POPUP_QUERY_KEY = 'reminder';

const reminderPopupPayloadSchema = z.object({
  id: identifier,
  taskId: identifier,
  title: z.string(),
  dueAt: z.number().nullable(),
});

export function encodeReminderPopupPayload(payload: ReminderDuePayload): string {
  return JSON.stringify(payload);
}

/** Reads the payload back out of the popup's query string; anything malformed is `null`. */
export function parseReminderPopupPayload(value: string | null): ReminderDuePayload | null {
  if (value === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }
  const parsed = reminderPopupPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Main -> panel: open this task (a reminder notification was clicked). */
export interface TaskFocusPayload {
  taskId: string;
}
