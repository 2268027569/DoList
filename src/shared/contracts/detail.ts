import { z } from 'zod';

/**
 * The task detail window's contract (docs/FEATURES.md M02 D6).
 *
 * The detail is not a page of the panel any more: it is a window of its own that opens
 * *beside* the list, so a task can be edited without the list going away. These channels
 * are the only way in and out — one asks for a task to be opened, one puts the window
 * away — and, exactly like the reminder popup (M04), which task it opened on arrives in
 * the window's own query string rather than over IPC, so the first frame is already the
 * right row instead of an empty card waiting for one.
 */

/**
 * The task id, bounded rather than merely non-empty: these values reach a SQLite query
 * and a filesystem-shaped path, so a megabyte of text is rejected at the boundary
 * instead of being carried down to the service layer and refused there.
 */
const identifier = z.string().min(1).max(128);

/** Both channels name the task they are about; one shape, two commands. */
export const detailTaskInput = z.object({ taskId: identifier });

export type DetailTaskInput = z.infer<typeof detailTaskInput>;

/**
 * The query-string name the task id travels under. A JSON payload like the popup's
 * would be ceremony here — there is one field, and a bare id in the query string is
 * impossible to misread.
 */
export const DETAIL_TASK_QUERY_KEY = 'task';

/** Reads the task id back out of the detail window's query string; malformed is `null`. */
export function parseDetailTaskId(value: string | null): string | null {
  const parsed = identifier.safeParse(value);
  return parsed.success ? parsed.data : null;
}
