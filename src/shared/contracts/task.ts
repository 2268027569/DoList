import { z } from 'zod';

import type { ReorderScope, TaskFilter } from '../types/task';
import { REPEAT_MODES, TASK_SORTS, TASK_STATUSES } from '../types/task';
import { TASK_QUERY_MAX_LIMIT } from '../utils/task-query';

/**
 * Zod contracts for the task channels (docs/ARCHITECTURE.md §6.4). The renderer
 * is never trusted, so every field is bounded here rather than in the repository:
 * a bad payload has to come back as `VALIDATION_FAILED`, not as a database error
 * from a `CHECK` constraint.
 *
 * `undefined` means "leave this alone" and `null` means "clear it" — the same
 * distinction `TaskPatch` makes, so a patch can carry a single field.
 */

/** UTC milliseconds. The upper bound is the safe-integer ceiling. */
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** A minute count big enough for a year, small enough to stay sensible. */
const minuteCount = z.number().int().min(0).max(60 * 24 * 365);
const identifier = z.string().min(1).max(128);

const title = z.string().trim().min(1).max(500);
const notes = z.string().max(20_000);
/** RRULE text is only sanity-checked here; S6 parses it with `rrule` (M02 D2). */
const repeatRule = z.string().min(1).max(1_000);
const tagName = z.string().trim().min(1).max(64);

const status = z.enum(TASK_STATUSES);
const repeatMode = z.enum(REPEAT_MODES);
const sort = z.enum(TASK_SORTS);
/**
 * Kept as literals rather than a number range so the parsed type is the
 * `TaskPriority` union and a future priority cannot slip through unnoticed.
 */
const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

/** Which sequence a reorder describes: a parent's subtasks, or a list's top level. */
export const reorderScopeInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('top'), listId: identifier.nullable() }),
  z.object({ kind: z.literal('subtask'), parentId: identifier }),
]);

export const taskCreateInput = z.object({
  title,
  listId: identifier.nullable().optional(),
  parentId: identifier.nullable().optional(),
  notes: notes.nullable().optional(),
  priority: priority.optional(),
  dueAt: timestamp.nullable().optional(),
  dueHasTime: z.boolean().optional(),
  repeatRule: repeatRule.nullable().optional(),
  repeatMode: repeatMode.nullable().optional(),
  estimateMin: minuteCount.nullable().optional(),
  remindLeadMin: minuteCount.nullable().optional(),
  tags: z.array(tagName).max(50).optional(),
});

/**
 * Every field is optional: the panel saves one field at a time as the user edits
 * (M02 D9), so a patch always describes a small change rather than a whole task.
 */
export const taskPatchInput = z.object({
  title: title.optional(),
  listId: identifier.nullable().optional(),
  notes: notes.nullable().optional(),
  status: status.optional(),
  priority: priority.optional(),
  dueAt: timestamp.nullable().optional(),
  dueHasTime: z.boolean().optional(),
  repeatRule: repeatRule.nullable().optional(),
  repeatMode: repeatMode.nullable().optional(),
  estimateMin: minuteCount.nullable().optional(),
  actualMin: minuteCount.nullable().optional(),
  remindLeadMin: minuteCount.nullable().optional(),
  tags: z.array(tagName).max(50).optional(),
});

export const taskUpdateInput = z.object({ id: identifier, patch: taskPatchInput });

/**
 * The id list a delete, restore or reorder carries. Bounded because a single IPC
 * message has no business naming thousands of rows.
 */
const idList = z.array(identifier).min(1).max(TASK_QUERY_MAX_LIMIT);

export const taskIdsInput = z.object({ ids: idList });

export const taskReorderInput = z.object({ scope: reorderScopeInput, ids: idList });

export const taskQueryInput = z.object({
  listId: identifier.nullable().optional(),
  status: z.union([status, z.array(status).min(1).max(TASK_STATUSES.length)]).optional(),
  parentId: identifier.nullable().optional(),
  text: z.string().max(200).optional(),
  dueFrom: timestamp.optional(),
  dueTo: timestamp.optional(),
  sort: sort.optional(),
  limit: z.number().int().min(1).max(TASK_QUERY_MAX_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
  includeDeleted: z.boolean().optional(),
});

export type TaskCreateInput = z.infer<typeof taskCreateInput>;
export type TaskPatchInput = z.infer<typeof taskPatchInput>;
export type TaskQueryInput = z.infer<typeof taskQueryInput>;

/** Compile-time proof that the wire contract still covers the repository's filter. */
export type TaskQueryCoversFilter = TaskQueryInput extends TaskFilter ? true : never;
/** Same, for the reorder scope. */
export type ReorderScopeCoversScope = ReorderScope extends z.infer<
  typeof reorderScopeInput
>
  ? true
  : never;

/** `kind` describes what happened; the panel re-fetches rather than patching a mirror. */
export type TaskChangeKind = 'created' | 'updated' | 'deleted' | 'restored' | 'reordered';

export interface TaskChangedPayload {
  kind: TaskChangeKind;
  /** The rows the change touched — used for the toast and for optimistic marking. */
  ids: string[];
  /** Set by `reordered`: the group whose order this describes. */
  scope?: ReorderScope;
}
