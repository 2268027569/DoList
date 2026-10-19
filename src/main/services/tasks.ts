import type { TaskChangedPayload, TaskCreateInput, TaskQueryInput } from '@shared/contracts/task';
import type { ReorderScope, Task, TaskPatch, TaskWithTags } from '@shared/types/task';
import { tagsOfTasks } from '../db/repositories/tags';
import {
  createTask,
  getTask,
  queryTasks,
  reorderTasks,
  restore,
  softDelete,
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

/** Reads the rows a filter selects, each with its tag names. */
export function listTasks(filter: TaskQueryInput = {}): TaskWithTags[] {
  const tasks = queryTasks(filter);
  const tags = tagsOfTasks(tasks.map((task) => task.id));
  return tasks.map((task) => ({ ...task, tags: tags.get(task.id) ?? [] }));
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
 */
export function updateTaskFromPatch(
  id: string,
  patch: TaskPatch,
  now: number = Date.now(),
): { task: TaskWithTags | null; change: TaskChangedPayload } {
  const task = updateTask(id, patch, now);
  return {
    task: task === null ? null : withTags(task),
    change: { kind: 'updated', ids: [id] },
  };
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
