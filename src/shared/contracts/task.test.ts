import { describe, expect, it } from 'vitest';

import {
  reorderScopeInput,
  taskCreateInput,
  taskIdsInput,
  taskPatchInput,
  taskQueryInput,
  taskReorderInput,
  taskUpdateInput,
} from './task';
import { TASK_QUERY_MAX_LIMIT } from '../utils/task-query';

describe('taskCreateInput', () => {
  it('accepts a bare title and fills nothing in', () => {
    const parsed = taskCreateInput.parse({ title: '  buy milk  ' });

    expect(parsed.title).toBe('buy milk'); // trimmed on the way in
    expect(parsed.dueAt).toBeUndefined();
  });

  it('rejects a blank or over-long title', () => {
    expect(taskCreateInput.safeParse({ title: '   ' }).success).toBe(false);
    expect(taskCreateInput.safeParse({ title: 'x'.repeat(501) }).success).toBe(false);
    expect(taskCreateInput.safeParse({}).success).toBe(false);
  });

  it('rejects a priority outside the four levels', () => {
    expect(taskCreateInput.safeParse({ title: 'x', priority: 3 }).success).toBe(true);
    expect(taskCreateInput.safeParse({ title: 'x', priority: 4 }).success).toBe(false);
    expect(taskCreateInput.safeParse({ title: 'x', priority: 1.5 }).success).toBe(false);
  });

  it('rejects a due time that is not a whole millisecond', () => {
    expect(taskCreateInput.safeParse({ title: 'x', dueAt: 1_700_000_000_000 }).success).toBe(true);
    expect(taskCreateInput.safeParse({ title: 'x', dueAt: 1.5 }).success).toBe(false);
    expect(taskCreateInput.safeParse({ title: 'x', dueAt: -1 }).success).toBe(false);
    expect(taskCreateInput.safeParse({ title: 'x', dueAt: Number.NaN }).success).toBe(false);
  });

  it('caps an estimate at a year of minutes', () => {
    expect(taskCreateInput.safeParse({ title: 'x', estimateMin: 60 * 24 * 365 }).success).toBe(true);
    expect(taskCreateInput.safeParse({ title: 'x', estimateMin: 60 * 24 * 366 }).success).toBe(
      false,
    );
  });

  it('takes a bounded tag list and drops blank names', () => {
    expect(taskCreateInput.safeParse({ title: 'x', tags: ['work', ' urgent '] }).success).toBe(true);
    expect(taskCreateInput.safeParse({ title: 'x', tags: ['   '] }).success).toBe(false);
    expect(taskCreateInput.safeParse({ title: 'x', tags: Array(51).fill('a') }).success).toBe(false);
  });

  it('knows an absent patch field from a cleared one', () => {
    const cleared = taskPatchInput.parse({ dueAt: null, notes: null, listId: null });

    expect(cleared.dueAt).toBeNull();
    expect(cleared.notes).toBeNull();
    // `title` was never mentioned, so it must not be present at all: the
    // repository reads `undefined` as "leave it alone".
    expect('title' in cleared).toBe(false);
  });

  it('rejects an unknown status or repeat mode', () => {
    expect(taskPatchInput.safeParse({ status: 'archived' }).success).toBe(false);
    expect(taskPatchInput.safeParse({ status: 'cancelled' }).success).toBe(true);
    expect(taskPatchInput.safeParse({ repeatMode: 'weekly' }).success).toBe(false);
    expect(taskPatchInput.safeParse({ repeatMode: 'after_completion' }).success).toBe(true);
  });
});

describe('taskUpdateInput', () => {
  it('requires an id alongside the patch', () => {
    expect(taskUpdateInput.safeParse({ id: 'a', patch: {} }).success).toBe(true);
    expect(taskUpdateInput.safeParse({ patch: {} }).success).toBe(false);
    expect(taskUpdateInput.safeParse({ id: '', patch: {} }).success).toBe(false);
  });

  it('treats an empty patch as legal', () => {
    // The handler returns the task unchanged; nothing on the wire is wrong.
    expect(taskPatchInput.safeParse({}).success).toBe(true);
  });
});

describe('taskIdsInput', () => {
  it('needs at least one id and refuses a blank one', () => {
    expect(taskIdsInput.safeParse({ ids: ['a'] }).success).toBe(true);
    expect(taskIdsInput.safeParse({ ids: [] }).success).toBe(false);
    expect(taskIdsInput.safeParse({ ids: [''] }).success).toBe(false);
    expect(taskIdsInput.safeParse({}).success).toBe(false);
  });

  it('caps how many rows one message may name', () => {
    expect(taskIdsInput.safeParse({ ids: Array(TASK_QUERY_MAX_LIMIT).fill('a') }).success).toBe(
      true,
    );
    expect(
      taskIdsInput.safeParse({ ids: Array(TASK_QUERY_MAX_LIMIT + 1).fill('a') }).success,
    ).toBe(false);
  });
});

describe('reorderScopeInput', () => {
  it('tells a list apart from a parent, and the Inbox from a named list', () => {
    expect(reorderScopeInput.safeParse({ kind: 'top', listId: null }).success).toBe(true);
    expect(reorderScopeInput.safeParse({ kind: 'top', listId: 'l1' }).success).toBe(true);
    expect(reorderScopeInput.safeParse({ kind: 'subtask', parentId: 'p1' }).success).toBe(true);
  });

  it('rejects a half-formed scope', () => {
    expect(reorderScopeInput.safeParse({ kind: 'top' }).success).toBe(false);
    expect(reorderScopeInput.safeParse({ kind: 'subtask' }).success).toBe(false);
    expect(reorderScopeInput.safeParse({ kind: 'list', listId: 'l1' }).success).toBe(false);
    expect(reorderScopeInput.safeParse({ kind: 'subtask', parentId: '' }).success).toBe(false);
  });

  it('carries the scope through the reorder payload', () => {
    const parsed = taskReorderInput.parse({
      scope: { kind: 'top', listId: null },
      ids: ['a', 'b'],
    });

    expect(parsed.scope).toEqual({ kind: 'top', listId: null });
    expect(parsed.ids).toEqual(['a', 'b']);
  });
});

describe('taskQueryInput', () => {
  it('accepts an empty query, which asks for the default view', () => {
    expect(taskQueryInput.safeParse({}).success).toBe(true);
  });

  it('takes one status or a set of them, but not an empty set', () => {
    expect(taskQueryInput.safeParse({ status: 'done' }).success).toBe(true);
    expect(taskQueryInput.safeParse({ status: ['todo', 'doing'] }).success).toBe(true);
    expect(taskQueryInput.safeParse({ status: [] }).success).toBe(false);
    expect(taskQueryInput.safeParse({ status: 'archived' }).success).toBe(false);
  });

  it('rejects a sort it does not know', () => {
    expect(taskQueryInput.safeParse({ sort: 'due' }).success).toBe(true);
    expect(taskQueryInput.safeParse({ sort: 'random' }).success).toBe(false);
  });

  it('refuses a row window that is wider than the ceiling or absurd', () => {
    expect(taskQueryInput.safeParse({ limit: TASK_QUERY_MAX_LIMIT }).success).toBe(true);
    expect(taskQueryInput.safeParse({ limit: TASK_QUERY_MAX_LIMIT + 1 }).success).toBe(false);
    expect(taskQueryInput.safeParse({ limit: 0 }).success).toBe(false);
    expect(taskQueryInput.safeParse({ offset: -1 }).success).toBe(false);
  });

  it('tells an Inbox query apart from an unfiltered one', () => {
    expect(taskQueryInput.parse({ listId: null }).listId).toBeNull();
    expect('listId' in taskQueryInput.parse({})).toBe(false);
  });
});
