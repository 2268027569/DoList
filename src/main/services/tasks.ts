import type { TaskChangedPayload, TaskCreateInput, TaskQueryInput } from '@shared/contracts/task';
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
  softDelete,
  subtaskCounts,
  updateTask,
} from '../db/repositories/tasks';

/**
 * The task domain, between the IPC handlers and the repositories
 * (docs/ARCHITECTURE.md §6.1). It deliberately imports nothing from Electron, so
 * every rule here is unit-tested against a real temporary database rather than
 * only through a running app.
 *
 * Each write returns the stored rows *and* a change descriptor: the caller's IPC
 * handler is what turns that descriptor into the one notification per write
 * (`services/task-events.ts`).
 */

export interface TaskWrite {
  change: TaskChangedPayload;
}

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

export function createTaskFromInput(input: TaskCreateInput, now: number = Date.now()): {
  task: TaskWithTags;
  change: TaskChangedPayload;
} {
  // The contract and `TaskDraft` carry the same fields, so the parsed input is
  // the draft: a second mapping step would only be a place to forget a field.
  const task = createTask(input, now);
  return { task: withTags(task), change: { kind: 'created', ids: [task.id] } };
}

/**
 * Applies a patch. `task` is `null` when the id is unknown — the handler reports
 * `NOT_FOUND` in that case and must not notify, since nothing changed.
 *
 * Ticking off a task that repeats also **creates its next occurrence** (M02 D10):
 * the completed one stays as the record of what was done, and the new one is the
 * same task moved forward. That is why the change descriptor can name two rows for
 * one user action — `ids` carries both, so the undo stack and the marker's recount
 * see the whole effect of the tick rather than half of it.
 */
export function updateTaskFromPatch(
  id: string,
  patch: TaskPatch,
  now: number = Date.now(),
): { task: TaskWithTags | null; next: TaskWithTags | null; change: TaskChangedPayload } {
  const before = getTask(id);
  const task = updateTask(id, patch, now);
  if (task === null) return { task: null, next: null, change: { kind: 'updated', ids: [id] } };

  // Only the transition matters, not the resulting status: unticking a task and
  // ticking it again is a new completion and does mint a new occurrence.
  const next =
    task.status === 'done' && before?.status !== 'done' ? scheduleNextOccurrence(task, now) : null;

  return {
    task: withTags(task),
    next: next === null ? null : withTags(next),
    change: { kind: 'updated', ids: next === null ? [id] : [id, next.id] },
  };
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

/** Soft-deletes the ids, plus the subtasks that go down with them. */
export function deleteTasks(ids: readonly string[], now: number = Date.now()): TaskWriteResult {
  const affected = softDelete(ids, now);
  return { affected, change: { kind: 'deleted', ids: unique(ids) } };
}

/** Takes the ids back out of the recycle bin. */
export function restoreTasks(ids: readonly string[], now: number = Date.now()): TaskWriteResult {
  const affected = restore(ids, now);
  return { affected, change: { kind: 'restored', ids: unique(ids) } };
}

/** Writes the order the user dragged into place, inside one group (M02 D3). */
export function reorderTaskGroup(
  scope: ReorderScope,
  ids: readonly string[],
  now: number = Date.now(),
): TaskWriteResult {
  const affected = reorderTasks(scope, ids, now);
  return { affected, change: { kind: 'reordered', ids: unique(ids), scope } };
}

function withTags(task: Task): TaskWithTags {
  return { ...task, tags: tagsOfTasks([task.id]).get(task.id) ?? [] };
}

/** Reorder and delete payloads may repeat an id; the notification should not. */
function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
