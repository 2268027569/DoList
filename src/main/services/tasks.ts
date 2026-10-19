import type {
  TaskBulkInput,
  TaskBulkOp,
  TaskChangedPayload,
  TaskCreateInput,
  TaskQueryInput,
} from '@shared/contracts/task';
import type {
  ReorderScope,
  Task,
  TaskListItem,
  TaskPatch,
  TaskWithTags,
} from '@shared/types/task';
import { nextOccurrence } from '@shared/utils/recurrence';
import { tagsOfTasks } from '../db/repositories/tags';
import {
  createTask,
  getTask,
  queryTasks,
  reorderTasks,
  restore,
  restoreTask,
  softDelete,
  subtaskCounts,
  updateTask,
} from '../db/repositories/tasks';
import { popUndo, pushUndo, type UndoRow } from './undo';

/**
 * The task domain, between the IPC handlers and the repositories
 * (docs/ARCHITECTURE.md §6.1). It deliberately imports nothing from Electron, so
 * every rule here is unit-tested against a real temporary database rather than
 * only through a running app.
 *
 * Each write returns the stored rows *and* a change descriptor: the caller's IPC
 * handler is what turns that descriptor into the one notification per write
 * (`services/task-events.ts`).
 *
 * It is also where the undo stack is fed (M02 D7). The recording sits next to the
 * write rather than in the handler because only the write knows what it changed,
 * and because a bulk command has to leave *one* entry on the stack however many
 * rows it touched.
 */

export interface TaskWrite {
  change: TaskChangedPayload;
}

/** A bulk command: everything `task:bulk` can ask for except the delete. */
type BulkCommand = Exclude<TaskBulkOp, { kind: 'delete' }>;

/** A write that reports how many rows it touched, for the undo stack (M02 D7). */
export interface TaskWriteResult extends TaskWrite {
  affected: number;
}

/**
 * Reads the rows a filter selects, each with its tag names and its subtask tally.
 *
 * Both extras are read in the same call because both are drawn on every row: a
 * second round trip per render would be paid on every keystroke in the quick-add
 * field, since each one re-fetches the list (M02 D4).
 */
export function listTasks(filter: TaskQueryInput = {}): TaskListItem[] {
  const tasks = queryTasks(filter);
  const ids = tasks.map((task) => task.id);
  const tags = tagsOfTasks(ids);
  const subtasks = subtaskCounts(ids);
  return tasks.map((task) => ({
    ...task,
    tags: tags.get(task.id) ?? [],
    subtasks: subtasks.get(task.id) ?? { total: 0, done: 0 },
  }));
}

/** Reads one task with its tags, or `null` when the id is unknown. */
export function readTask(id: string): TaskWithTags | null {
  const task = getTask(id);
  return task === null ? null : withTags(task);
}

export function createTaskFromInput(
  input: TaskCreateInput,
  now: number = Date.now(),
): { task: TaskWithTags; change: TaskChangedPayload } {
  // The contract and `TaskDraft` carry the same fields, so the parsed input is
  // the draft: a second mapping step would only be a place to forget a field.
  const task = createTask(input, now);
  // Undoing a create takes the row away again, so the entry records no `before`.
  pushUndo({ rows: [{ id: task.id, before: null, tags: null }] });
  return { task: withTags(task), change: { kind: 'created', ids: [task.id] } };
}

/**
 * Applies a patch. `task` is `null` when the id is unknown — the handler reports
 * `NOT_FOUND` in that case and must not notify, since nothing changed.
 */
export function updateTaskFromPatch(
  id: string,
  patch: TaskPatch,
  now: number = Date.now(),
): { task: TaskWithTags | null; next: TaskWithTags | null; change: TaskChangedPayload } {
  const applied = applyPatch(id, patch, now);
  if (applied.task === null) return { task: null, next: null, change: { kind: 'updated', ids: [id] } };

  pushUndo({ rows: applied.rows });
  return {
    task: applied.task,
    next: applied.next,
    change: { kind: 'updated', ids: applied.ids },
  };
}

/** One command, many rows: one write, one notification, one undo entry (S7). */
export function bulkTasks(input: TaskBulkInput, now: number = Date.now()): TaskWriteResult {
  const { op } = input;
  const ids = unique(input.ids);
  // A bulk delete is a bulk delete however few rows it names, so it goes through
  // the same path as a single one — including the cascade and the one entry.
  if (op.kind === 'delete') return deleteTasks(ids, now);

  const rows: UndoRow[] = [];
  const changed: string[] = [];
  let affected = 0;

  for (const id of ids) {
    const applied = applyPatch(id, patchFor(op), now);
    if (applied.task === null) continue;
    affected += 1;
    rows.push(...applied.rows);
    changed.push(...applied.ids);
  }

  // Nothing was written, so nothing is announced and nothing can be taken back.
  if (affected === 0) return { affected: 0, change: { kind: 'updated', ids } };

  // The whole selection is one entry: `Ctrl+Z` takes back the command, not the
  // twentieth of it.
  pushUndo({ rows });
  // Ticking a repeating task mints its next occurrence, so a bulk tick can touch
  // more rows than the selection named — the notification carries all of them.
  return { affected, change: { kind: 'updated', ids: changed } };
}

/** Soft-deletes the ids, plus the subtasks that go down with them. */
export function deleteTasks(ids: readonly string[], now: number = Date.now()): TaskWriteResult {
  const { affected, tombstoned } = softDelete(ids, now);
  if (affected > 0) pushUndo({ rows: undoRowsFor(tombstoned) });
  return { affected, change: { kind: 'deleted', ids: unique(ids) } };
}

/** Takes the ids back out of the recycle bin. */
export function restoreTasks(ids: readonly string[], now: number = Date.now()): TaskWriteResult {
  const { affected, restored } = restore(ids, now);
  // The rows come back as they were in the bin, tombstone included, so undoing a
  // restore puts them back there (and takes their subtasks along).
  if (affected > 0) pushUndo({ rows: undoRowsFor(restored) });
  return { affected, change: { kind: 'restored', ids: unique(ids) } };
}

/** Writes the order the user dragged into place, inside one group (M02 D3). */
export function reorderTaskGroup(
  scope: ReorderScope,
  ids: readonly string[],
  now: number = Date.now(),
): TaskWriteResult {
  const { affected, moved } = reorderTasks(scope, ids, now);
  if (affected > 0) {
    // A reorder writes positions and nothing else, so the entry carries no tag
    // set: restoring one from an empty list would drop tags the row still has.
    pushUndo({
      rows: moved.map((row) => ({ id: row.id, before: row, tags: null })),
    });
  }
  return { affected, change: { kind: 'reordered', ids: unique(ids), scope } };
}

/**
 * Takes the newest write back (M02 D7), and reports what it touched.
 *
 * Returns `null` when the stack is empty — the user pressed the shortcut one time
 * too many, which is not an error — so the handler answers `ok(null)` and the
 * panel does nothing.
 *
 * The entry is *not* pushed back afterwards: a run of `Ctrl+Z` would otherwise keep
 * undoing its own undo, and the stack would never empty.
 */
export function undoLastWrite(now: number = Date.now()): TaskChangedPayload | null {
  const entry = popUndo();
  if (entry === null) return null;

  const ids: string[] = [];
  for (const row of entry.rows) {
    if (row.before === null) softDelete([row.id], now);
    else restoreTask(row.before, row.tags, now);
    ids.push(row.id);
  }
  return { kind: 'undone', ids };
}

interface PatchApplication {
  /** The stored row, or `null` when the id is unknown. */
  task: TaskWithTags | null;
  /** The occurrence a completion minted, if any. */
  next: TaskWithTags | null;
  /** What an undo has to put back; empty when nothing was written. */
  rows: UndoRow[];
  /** Every row this write touched: the patched one, plus any minted occurrence. */
  ids: string[];
}

/**
 * The core of a patch: writes it and reports what takes it back.
 *
 * Pushing the entry is left to the callers because a bulk command runs this once
 * per row and must still leave one entry behind.
 *
 * Ticking off a task that repeats also **creates its next occurrence** (M02 D10):
 * the completed one stays as the record of what was done, and the new one is the
 * same task moved forward. That is why the ids can name two rows for one user
 * action — the undo entry carries both, so `Ctrl+Z` takes back the whole tick
 * rather than leaving an orphaned occurrence behind.
 */
function applyPatch(id: string, patch: TaskPatch, now: number): PatchApplication {
  const before = getTask(id);
  if (before === null) return { task: null, next: null, rows: [], ids: [id] };
  // Read before the write: a patch that sets tags must be undone back to the set
  // the row had, not to the one it just acquired.
  const tagsBefore = tagsOfTasks([id]).get(id) ?? [];

  const task = updateTask(id, patch, now);
  if (task === null) return { task: null, next: null, rows: [], ids: [id] };

  // Only the transition matters, not the resulting status: unticking a task and
  // ticking it again is a new completion and does mint a new occurrence.
  const next =
    task.status === 'done' && before.status !== 'done' ? scheduleNextOccurrence(task, now) : null;

  const rows: UndoRow[] = [{ id, before, tags: tagsBefore }];
  if (next !== null) rows.push({ id: next.id, before: null, tags: null });

  return {
    task: withTags(task),
    next: next === null ? null : withTags(next),
    rows,
    ids: next === null ? [id] : [id, next.id],
  };
}

/** The patch one bulk command writes. `delete` is routed away before this runs. */
function patchFor(op: BulkCommand): TaskPatch {
  switch (op.kind) {
    case 'complete':
      return { status: 'done' };
    case 'priority':
      return { priority: op.priority };
  }
}

/**
 * The task's next occurrence, written as a new row, or `null` when there is none.
 *
 * What carries over is what describes *the task*: title, list, notes, priority,
 * tags, estimate, reminder lead, and the rule itself. What does not is what
 * describes *this run of it*: the subtasks (a fresh checklist, not one already
 * ticked), the actual time and the completion stamp — and the new row starts open,
 * because the whole point of it is that there is still work to do.
 */
function scheduleNextOccurrence(task: Task, now: number): Task | null {
  if (task.repeatRule === null) return null;

  // A task with no due still repeats: without a schedule to stay on, the pattern
  // is anchored on the completion, which puts the first occurrence one interval
  // after the moment the user ticked it.
  const anchor = task.dueAt ?? now;
  const dueAt = nextOccurrence({
    rule: task.repeatRule,
    mode: task.repeatMode ?? 'fixed',
    due: anchor,
    dueHasTime: task.dueHasTime,
    now,
  });
  // The rule has run out (an exhausted `COUNT` / `UNTIL`) or is not one at all.
  if (dueAt === null) return null;

  return createTask(
    {
      title: task.title,
      listId: task.listId,
      // A repeating subtask repeats under the same parent; the repository refuses
      // a parent that would nest deeper than one level.
      parentId: task.parentId,
      notes: task.notes,
      priority: task.priority,
      dueAt,
      dueHasTime: task.dueHasTime,
      repeatRule: task.repeatRule,
      repeatMode: task.repeatMode,
      estimateMin: task.estimateMin,
      remindLeadMin: task.remindLeadMin,
      tags: tagsOfTasks([task.id]).get(task.id) ?? [],
    },
    now,
  );
}

/** Undo entries for a write that read the rows it changed (a delete or a restore). */
function undoRowsFor(rows: readonly Task[]): UndoRow[] {
  if (rows.length === 0) return [];
  const tags = tagsOfTasks(rows.map((row) => row.id));
  return rows.map((row) => ({ id: row.id, before: row, tags: tags.get(row.id) ?? [] }));
}

function withTags(task: Task): TaskWithTags {
  return { ...task, tags: tagsOfTasks([task.id]).get(task.id) ?? [] };
}

/** Reorder and delete payloads may repeat an id; the notification should not. */
function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
