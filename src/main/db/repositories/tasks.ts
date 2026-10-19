import type { RepeatMode, ReorderScope, Task, TaskDraft, TaskFilter, TaskPatch, TaskPriority, TaskStatus } from '@shared/types/task';
import type { DayBounds } from '@shared/utils/day';
import { newId } from '@shared/utils/id';
import { buildTaskQuery } from '@shared/utils/task-query';

import { getDatabase } from '../connection';
import { setTaskTags } from './tags';

/** Task counts the marker badge and ring are derived from (docs/FEATURES.md M01). */
export interface MarkerCounts {
  /** Not done and not cancelled. */
  open: number;
  /** Not done, with a due time already in the past. */
  overdue: number;
  /** Every task due inside today's window, done or not. */
  dueToday: number;
  /** Of those, the ones already completed. */
  doneToday: number;
  /** Not done, due within the next 24 hours but not yet overdue. */
  dueSoon: number;
}

/** Statuses that still represent work (mirrors the schema's status comment). */
const ACTIVE = "status NOT IN ('done', 'cancelled')";

/**
 * Single round trip per count, all filtered through the `deleted_at` soft-delete
 * tombstone (§5.1). Kept as one function so M02's task queries and this badge
 * source cannot drift apart.
 */
export function markerCounts(now: number, day: DayBounds): MarkerCounts {
  const db = getDatabase();
  const scalar = (sql: string, ...params: unknown[]): number => {
    const row = db.prepare(sql).get(...params) as { count?: number } | undefined;
    return row?.count ?? 0;
  };
  const live = 'FROM tasks WHERE deleted_at IS NULL';

  return {
    open: scalar(`SELECT COUNT(*) AS count ${live} AND ${ACTIVE}`),
    overdue: scalar(`SELECT COUNT(*) AS count ${live} AND ${ACTIVE} AND due_at IS NOT NULL AND due_at < ?`, now),
    dueToday: scalar(`SELECT COUNT(*) AS count ${live} AND due_at >= ? AND due_at < ?`, day.start, day.end),
    doneToday: scalar(`SELECT COUNT(*) AS count ${live} AND status = 'done' AND due_at >= ? AND due_at < ?`, day.start, day.end),
    dueSoon: scalar(
      `SELECT COUNT(*) AS count ${live} AND ${ACTIVE} AND due_at IS NOT NULL AND due_at >= ? AND due_at < ?`,
      now,
      now + 86_400_000,
    ),
  };
}

/**
 * Every column of `tasks`, aliased to `t` so the same list works for a plain
 * select and for the filtered query. The alias is the reason `COLUMNS` lives
 * next to the mapper rather than in a schema module.
 */
const COLUMNS = `t.id, t.list_id, t.parent_id, t.title, t.notes, t.status, t.priority,
  t.due_at, t.due_has_time, t.repeat_rule, t.repeat_mode, t.estimate_min, t.actual_min,
  t.remind_lead_min, t.sort_order, t.created_at, t.updated_at, t.completed_at, t.deleted_at`;

interface TaskRow {
  id: string;
  list_id: string | null;
  parent_id: string | null;
  title: string;
  notes: string | null;
  status: string;
  priority: number;
  due_at: number | null;
  due_has_time: number;
  repeat_rule: string | null;
  repeat_mode: string | null;
  estimate_min: number | null;
  actual_min: number | null;
  remind_lead_min: number | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  deleted_at: number | null;
}

interface ScopeSql {
  where: string;
  params: unknown[];
}

/** One row, or `null` when the id is unknown. Soft-deleted rows are still returned. */
export function getTask(id: string): Task | null {
  const row = getDatabase()
    .prepare(`SELECT ${COLUMNS} FROM tasks t WHERE t.id = ?`)
    .get(id) as TaskRow | undefined;
  return row === undefined ? null : mapTask(row);
}

/**
 * Inserts a task and returns it. `now` is passed in rather than read from the
 * clock so a caller's several writes in one action share a timestamp, and so
 * tests are deterministic.
 *
 * Throws on a blank title or on a `parentId` that would nest deeper than one
 * level — both are data-layer invariants (§5.2), not only input validation, so
 * they hold no matter which caller writes.
 */
export function createTask(draft: TaskDraft, now: number): Task {
  const db = getDatabase();
  const title = draft.title.trim();
  if (title === '') throw new Error('a task title must not be blank');

  const parentId = draft.parentId ?? null;
  if (parentId !== null) assertTopLevelParent(parentId);
  const listId = draft.listId ?? null;

  const id = newId(now);
  const sortOrder = nextSortOrder(scopeOf(listId, parentId));

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks (id, list_id, parent_id, title, notes, status, priority,
         due_at, due_has_time, repeat_rule, repeat_mode, estimate_min, actual_min,
         remind_lead_min, sort_order, created_at, updated_at, completed_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL)`,
    ).run(
      id,
      listId,
      parentId,
      title,
      draft.notes ?? null,
      draft.priority ?? 0,
      draft.dueAt ?? null,
      draft.dueHasTime === true ? 1 : 0,
      draft.repeatRule ?? null,
      draft.repeatMode ?? null,
      draft.estimateMin ?? null,
      draft.remindLeadMin ?? null,
      sortOrder,
      now,
      now,
    );
    if (draft.tags !== undefined && draft.tags.length > 0) setTaskTags(id, draft.tags, now);
  });
  insert();

  const created = getTask(id);
  if (created === null) throw new Error(`task ${id} vanished right after insert`);
  return created;
}

/**
 * Applies a patch and returns the stored row, or `null` when the id is unknown.
 *
 * `undefined` leaves a field alone and `null` clears it, which is what lets the
 * panel save a single field on every keystroke (M02 D9) without having to send
 * the whole task back.
 */
export function updateTask(id: string, patch: TaskPatch, now: number): Task | null {
  const db = getDatabase();
  const current = getTask(id);
  if (current === null) return null;

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title === '') throw new Error('a task title must not be blank');
    set('title', title);
  }
  if (patch.listId !== undefined) {
    set('list_id', patch.listId);
    // A top-level task's sort_order only means something inside one list, so a
    // move re-appends it instead of dropping it in the middle of the new list.
    if (patch.listId !== current.listId) {
      set('sort_order', nextSortOrder({ kind: 'top', listId: patch.listId }));
    }
  }
  if (patch.notes !== undefined) set('notes', patch.notes);
  if (patch.status !== undefined) {
    set('status', patch.status);
    // completed_at records the tick itself; unticking clears it again.
    if (patch.status === 'done' && current.status !== 'done') set('completed_at', now);
    if (patch.status !== 'done' && current.completedAt !== null) set('completed_at', null);
  }
  if (patch.priority !== undefined) set('priority', patch.priority);
  if (patch.dueAt !== undefined) set('due_at', patch.dueAt);
  if (patch.dueHasTime !== undefined) set('due_has_time', patch.dueHasTime ? 1 : 0);
  if (patch.repeatRule !== undefined) set('repeat_rule', patch.repeatRule);
  if (patch.repeatMode !== undefined) set('repeat_mode', patch.repeatMode);
  if (patch.estimateMin !== undefined) set('estimate_min', patch.estimateMin);
  if (patch.actualMin !== undefined) set('actual_min', patch.actualMin);
  if (patch.remindLeadMin !== undefined) set('remind_lead_min', patch.remindLeadMin);

  const tags = patch.tags;
  if (sets.length === 0 && tags === undefined) return current;

  // Any write, tags included, moves updated_at: it is the last-writer-wins basis
  // folder sync compares (M10).
  set('updated_at', now);

  const apply = db.transaction(() => {
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    if (tags !== undefined) setTaskTags(id, tags, now);
  });
  apply();

  return getTask(id);
}

/**
 * Moves tasks to the recycle bin, subtasks included and in the same transaction.
 *
 * A subtask has no life of its own — leaving it behind would mean an orphan the
 * panel cannot reach, since the list only renders tasks whose parent is visible.
 * Returns the number of rows actually touched.
 */
export function softDelete(ids: readonly string[], now: number): number {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;

  const db = getDatabase();
  const deleteOne = db.prepare(
    'UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
  );
  const deleteChildren = db.prepare(
    'UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE parent_id = ? AND deleted_at IS NULL',
  );

  const run = db.transaction(() => {
    let affected = 0;
    for (const id of unique) {
      affected += deleteOne.run(now, now, id).changes;
      // Subtasks are one level deep, so a single extra pass reaches all of them.
      affected += deleteChildren.run(now, now, id).changes;
    }
    return affected;
  });
  return run();
}

/**
 * Takes tasks out of the recycle bin.
 *
 * Subtasks come back only when they carry the *same* tombstone timestamp as the
 * parent they went down with: one that was deleted on its own earlier keeps its
 * own stamp and stays in the bin, which is what the user asked for at the time.
 */
export function restore(ids: readonly string[], now: number): number {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;

  const db = getDatabase();
  const readStamp = db.prepare('SELECT deleted_at FROM tasks WHERE id = ?');
  const restoreOne = db.prepare(
    'UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at = ?',
  );
  const restoreChildren = db.prepare(
    'UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE parent_id = ? AND deleted_at = ?',
  );

  const run = db.transaction(() => {
    let affected = 0;
    for (const id of unique) {
      const row = readStamp.get(id) as { deleted_at: number | null } | undefined;
      const stamp = row?.deleted_at ?? null;
      if (stamp === null) continue; // live already, or an unknown id

      affected += restoreOne.run(now, id, stamp).changes;
      affected += restoreChildren.run(now, id, stamp).changes;
    }
    return affected;
  });
  return run();
}

/** Runs a filter (docs/ARCHITECTURE.md §5.6) and returns the rows it selects. */
export function queryTasks(filter: TaskFilter = {}): Task[] {
  const query = buildTaskQuery(filter);
  const rows = getDatabase()
    .prepare(
      `SELECT ${COLUMNS} FROM tasks t
        WHERE ${query.where}
        ORDER BY ${query.orderBy}
        LIMIT ? OFFSET ?`,
    )
    .all(...query.params, query.limit, query.offset) as TaskRow[];
  return rows.map(mapTask);
}

/**
 * Writes the order the user dragged into place (M02 D3).
 *
 * Only rows belonging to `scope` are written, so an id from another list is
 * ignored rather than stealing a position. Rewriting the whole group is a single
 * small transaction on a local file — far cheaper than the fractional-rank
 * bookkeeping that would otherwise be needed to insert in the middle.
 *
 * `ids` may be a subset — the panel passes what its view is showing, and a done
 * task in the same group is not in that view. The rest of the group is therefore
 * read first and appended after the named rows in its own order, which keeps
 * `sort_order` a clean 0…n-1 sequence across the whole group. Writing only the
 * named rows would leave the others holding positions in the middle of that
 * sequence, and a later view that shows both would draw two rows with the same
 * `sort_order` in whatever order the table happened to be in.
 *
 * Returns how many rows actually moved. A row already sitting where it is asked to
 * sit keeps its `updated_at`, so a partial reorder does not mark rows the user
 * never touched as modified — M08 resolves sync conflicts by that timestamp.
 */
export function reorderTasks(
  scope: ReorderScope,
  ids: readonly string[],
  now: number,
): number {
  if (ids.length === 0) return 0;

  const db = getDatabase();
  const { where, params: scopeParams } = scopeSql(scope);
  const group = db
    .prepare(`SELECT id, sort_order FROM tasks WHERE ${where} ORDER BY sort_order, rowid`)
    .all(...scopeParams) as { id: string; sort_order: number }[];

  const named = new Set(ids);
  const sequence = [
    ...ids,
    ...group.filter((row) => !named.has(row.id)).map((row) => row.id),
  ];
  const positionOf = new Map(group.map((row) => [row.id, row.sort_order]));

  const update = db.prepare(
    `UPDATE tasks SET sort_order = ?, updated_at = ? WHERE id = ? AND ${where}`,
  );

  const run = db.transaction(() => {
    let affected = 0;
    sequence.forEach((id, index) => {
      // `positionOf` has no entry for an id from another group: the update below
      // matches nothing, and the count of moved rows stays honest.
      if (positionOf.get(id) === index) return;
      affected += update.run(index, now, id, ...scopeParams).changes;
    });
    return affected;
  });
  return run();
}

/**
 * The next free position inside a group. Soft-deleted rows count, so restoring
 * one can never collide with a task created while it was in the bin.
 */
function nextSortOrder(scope: ReorderScope): number {
  const { where, params } = scopeSql(scope);
  const row = getDatabase()
    .prepare(`SELECT MAX(sort_order) AS max FROM tasks WHERE ${where}`)
    .get(...params) as { max: number | null } | undefined;
  return (row?.max ?? -1) + 1;
}

function scopeSql(scope: ReorderScope): ScopeSql {
  if (scope.kind === 'subtask') return { where: 'parent_id = ?', params: [scope.parentId] };
  return scope.listId === null
    ? { where: 'parent_id IS NULL AND list_id IS NULL', params: [] }
    : { where: 'parent_id IS NULL AND list_id = ?', params: [scope.listId] };
}

function scopeOf(listId: string | null, parentId: string | null): ReorderScope {
  return parentId === null ? { kind: 'top', listId } : { kind: 'subtask', parentId };
}

/** Subtasks stay one level deep, so a parent must itself be top level and live. */
function assertTopLevelParent(parentId: string): void {
  const row = getDatabase()
    .prepare('SELECT parent_id, deleted_at FROM tasks WHERE id = ?')
    .get(parentId) as { parent_id: string | null; deleted_at: number | null } | undefined;

  if (row === undefined) throw new Error(`parent task ${parentId} does not exist`);
  if (row.parent_id !== null) throw new Error('subtasks cannot be nested more than one level');
  if (row.deleted_at !== null) throw new Error('a task in the recycle bin cannot take subtasks');
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    listId: row.list_id,
    parentId: row.parent_id,
    title: row.title,
    notes: row.notes,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    dueAt: row.due_at,
    dueHasTime: row.due_has_time === 1,
    repeatRule: row.repeat_rule,
    repeatMode: row.repeat_mode as RepeatMode | null,
    estimateMin: row.estimate_min,
    actualMin: row.actual_min,
    remindLeadMin: row.remind_lead_min,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    deletedAt: row.deleted_at,
  };
}
