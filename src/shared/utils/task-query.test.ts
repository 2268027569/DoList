import { describe, expect, it } from 'vitest';

import { TASK_SORTS } from '@shared/types/task';

import {
  buildTaskQuery,
  TASK_QUERY_DEFAULT_LIMIT,
  TASK_QUERY_MAX_LIMIT,
} from './task-query';

describe('buildTaskQuery', () => {
  it('excludes soft-deleted rows unless the filter asks for them', () => {
    expect(buildTaskQuery().where).toBe('t.deleted_at IS NULL');
    expect(buildTaskQuery({ includeDeleted: true }).where).toBe('1 = 1');
  });

  it('tells the Inbox apart from every list', () => {
    expect(buildTaskQuery({ listId: null }).where).toContain('t.list_id IS NULL');
    expect(buildTaskQuery({}).where).not.toContain('t.list_id');
    expect(buildTaskQuery({ listId: 'l1' })).toMatchObject({
      params: ['l1'],
    });
  });

  it('tells top-level tasks apart from a parent\u2019s subtasks', () => {
    expect(buildTaskQuery({ parentId: null }).where).toContain('t.parent_id IS NULL');
    expect(buildTaskQuery({ parentId: 'p1' }).params).toEqual(['p1']);
  });

  it('takes one status or several', () => {
    expect(buildTaskQuery({ status: 'done' }).where).toContain('t.status IN (?)');
    expect(buildTaskQuery({ status: ['todo', 'doing'] }).where).toContain(
      't.status IN (?, ?)',
    );
    expect(buildTaskQuery({ status: ['todo', 'doing'] }).params).toEqual(['todo', 'doing']);
  });

  it('escapes the LIKE wildcards a title may contain', () => {
    const query = buildTaskQuery({ text: '50%_off\\' });
    expect(query.where).toContain("ESCAPE '\\'");
    expect(query.params).toEqual(['%50\\%\\_off\\\\%', '%50\\%\\_off\\\\%']);
  });

  it('leaves a blank search out of the query', () => {
    expect(buildTaskQuery({ text: '   ' }).where).not.toContain('LIKE');
  });

  it('uses a half-open due window', () => {
    const query = buildTaskQuery({ dueFrom: 10, dueTo: 20 });
    expect(query.where).toContain('t.due_at >= ?');
    expect(query.where).toContain('t.due_at < ?');
    expect(query.params).toEqual([10, 20]);
  });

  it('clamps the row window instead of trusting the caller', () => {
    expect(buildTaskQuery().limit).toBe(TASK_QUERY_DEFAULT_LIMIT);
    expect(buildTaskQuery({ limit: 10_000 }).limit).toBe(TASK_QUERY_MAX_LIMIT);
    expect(buildTaskQuery({ limit: 0 }).limit).toBe(1);
    expect(buildTaskQuery({ limit: 12.7 }).limit).toBe(12);
    expect(buildTaskQuery({ offset: -5 }).offset).toBe(0);
    expect(buildTaskQuery({ offset: 8.9 }).offset).toBe(8);
  });

  it('orders by a whitelisted clause, falling back to the manual order', () => {
    expect(buildTaskQuery({ sort: 'due' }).orderBy).toContain('t.due_at IS NULL ASC');
    expect(buildTaskQuery().orderBy).toBe(buildTaskQuery({ sort: 'manual' }).orderBy);
    // A value that got past the type (and past zod) must not reach SQL as text.
    const rogue = { sort: 'DROP TABLE tasks' } as unknown as Parameters<typeof buildTaskQuery>[0];
    expect(buildTaskQuery(rogue).orderBy).toContain('t.sort_order ASC');
  });

  it('orders a finished row by when it was finished, not by the manual order', () => {
    // 已完成 reads newest first (M03 D4): `sort_order` is the order the open rows were
    // dragged into, which says nothing about the order they were completed in, so the
    // archive sorts on `completed_at` with the manual order only as a tiebreak.
    expect(TASK_SORTS).toContain('completed');
    expect(buildTaskQuery({ sort: 'completed' }).orderBy).toContain('t.completed_at DESC');
  });
});
