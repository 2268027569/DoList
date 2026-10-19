import type { Task } from '@shared/types/task';

/**
 * The undo stack (M02 D7): one entry per write, newest on top, in memory only.
 *
 * It lives here rather than in the database because an entry is a fact about this
 * *session* — the rows as they were a minute ago — and a table of them would be a
 * second history to reconcile with folder sync (M10). Losing it on restart is the
 * documented behaviour: after a relaunch there is nothing to take back.
 *
 * An entry is a list of rows to put back rather than a list of inverse operations.
 * One mechanism covers every write the panel can make: a row that did not exist
 * comes back as `before: null` (undoing a create means taking it away again), and a
 * row that did exist carries the snapshot it had, tombstones and all. Inverse
 * operations would need one branch per write kind, and every new write kind would
 * be a chance to forget one.
 */
export interface UndoRow {
  id: string;
  /** The row as it was before the write; `null` when the write created it. */
  before: Task | null;
  /**
   * The tag set the row had, or `null` when the write never touched tags — a
   * reorder, where restoring an empty list would delete tags still on the row.
   */
  tags: readonly string[] | null;
}

export interface UndoEntry {
  rows: UndoRow[];
}

/** How many writes can be taken back. Older ones fall off the bottom. */
export const UNDO_LIMIT = 30;

const stack: UndoEntry[] = [];

/** Records a write so `Ctrl+Z` can take it back. Entries past the cap are dropped. */
export function pushUndo(entry: UndoEntry): void {
  if (entry.rows.length === 0) return;
  stack.push(entry);
  if (stack.length > UNDO_LIMIT) stack.splice(0, stack.length - UNDO_LIMIT);
}

/**
 * Takes the newest entry off the stack, or `null` when there is nothing to undo.
 *
 * The caller applies it and never pushes it back, which is what keeps a run of
 * `Ctrl+Z` from undoing its own undo.
 */
export function popUndo(): UndoEntry | null {
  return stack.pop() ?? null;
}

/** How many writes are waiting to be taken back. */
export function undoDepth(): number {
  return stack.length;
}

/** Empties the stack. For tests, which each start from a clean session. */
export function clearUndo(): void {
  stack.length = 0;
}
