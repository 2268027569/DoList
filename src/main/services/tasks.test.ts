import { describe, expect, it } from 'vitest';

import type { TaskWithTags } from '@shared/types/task';

import { withTempDatabase } from '../db/test-db';
import {
  createTaskFromInput,
  deleteTasks,
  listTasks,
  readTask,
  reorderTaskGroup,
  restoreTasks,
  updateTaskFromPatch,
} from './tasks';

const NOW = new Date(2026, 4, 12, 10, 0, 0).getTime();

describe('createTaskFromInput', () => {
  it('returns the stored task with its tags and a created change', () => {
    withTempDatabase(() => {
      const { task, change } = createTaskFromInput({ title: 'buy milk', tags: ['shop'] }, NOW);

      expect(task.title).toBe('buy milk');
      expect(task.tags).toEqual(['shop']);
      expect(change).toEqual({ kind: 'created', ids: [task.id] });
    });
  });

  it('leaves the tags out of the query when there are none', () => {
    withTempDatabase(() => {
      const { task } = createTaskFromInput({ title: 'plain' }, NOW);

      expect(task.tags).toEqual([]);
    });
  });
});

describe('listTasks', () => {
  it('carries the tag names back with the rows', () => {
    withTempDatabase(() => {
      const first = createTaskFromInput({ title: 'a', tags: ['work', 'urgent'] }, NOW).task;
      const second = createTaskFromInput({ title: 'b' }, NOW + 1).task;

      const list = listTasks();

      expect(list.map((task: TaskWithTags) => [task.title, task.tags])).toEqual([
        ['a', ['urgent', 'work']],
        ['b', []],
      ]);
      // `listTasks()` and the rows the create call returned agree.
      expect(list[0]?.id).toBe(first.id);
      expect(list[1]?.id).toBe(second.id);
    });
  });

  it('runs a filter rather than returning everything', () => {
    withTempDatabase(() => {
      createTaskFromInput({ title: 'keep' }, NOW);
      const done = createTaskFromInput({ title: 'finish' }, NOW + 1).task;
      updateTaskFromPatch(done.id, { status: 'done' }, NOW + 2);

      expect(listTasks({ status: 'done' }).map((task) => task.title)).toEqual(['finish']);
      expect(listTasks({ status: 'todo' }).map((task) => task.title)).toEqual(['keep']);
      expect(listTasks()).toHaveLength(2);
    });
  });

  it('asks for the recycle bin explicitly', () => {
    withTempDatabase(() => {
      const task = createTaskFromInput({ title: 'gone' }, NOW).task;
      deleteTasks([task.id], NOW + 1);

      expect(listTasks()).toEqual([]);
      expect(listTasks({ includeDeleted: true })).toHaveLength(1);
    });
  });
});

describe('readTask', () => {
  it('returns the task with its tags, or null', () => {
    withTempDatabase(() => {
      const task = createTaskFromInput({ title: 'x', tags: ['a'] }, NOW).task;

      expect(readTask(task.id)?.tags).toEqual(['a']);
      expect(readTask('missing')).toBeNull();
    });
  });
});

describe('updateTaskFromPatch', () => {
  it('returns the updated task with its tags', () => {
    withTempDatabase(() => {
      const task = createTaskFromInput({ title: 'before' }, NOW).task;

      const { task: updated, change } = updateTaskFromPatch(
        task.id,
        { title: 'after', tags: ['a', 'b'] },
        NOW + 1,
      );

      expect(updated?.title).toBe('after');
      expect(updated?.tags).toEqual(['a', 'b']);
      expect(change).toEqual({ kind: 'updated', ids: [task.id] });
    });
  });

  it('reports null and no rows for an unknown id', () => {
    withTempDatabase(() => {
      const { task, change } = updateTaskFromPatch('missing', { title: 'x' }, NOW);

      expect(task).toBeNull();
      // The change descriptor is still built, but the handler drops it: it only
      // announces a write that happened.
      expect(change.kind).toBe('updated');
    });
  });
});

describe('deleteTasks', () => {
  it('counts the subtasks it takes down with the parent', () => {
    withTempDatabase(() => {
      const parent = createTaskFromInput({ title: 'parent' }, NOW).task;
      const child = createTaskFromInput({ title: 'child', parentId: parent.id }, NOW + 1).task;

      const { affected, change } = deleteTasks([parent.id], NOW + 2);

      expect(affected).toBe(2);
      expect(change).toEqual({ kind: 'deleted', ids: [parent.id] });
      expect(readTask(child.id)?.deletedAt).toBe(NOW + 2);
    });
  });

  it('de-duplicates the ids it announces', () => {
    withTempDatabase(() => {
      const task = createTaskFromInput({ title: 'x' }, NOW).task;

      const { affected, change } = deleteTasks([task.id, task.id], NOW + 1);

      expect(affected).toBe(1);
      expect(change.ids).toEqual([task.id]);
    });
  });
});

describe('restoreTasks', () => {
  it('brings the parent and its subtasks back', () => {
    withTempDatabase(() => {
      const parent = createTaskFromInput({ title: 'parent' }, NOW).task;
      createTaskFromInput({ title: 'child', parentId: parent.id }, NOW + 1);
      deleteTasks([parent.id], NOW + 2);

      const { affected, change } = restoreTasks([parent.id], NOW + 3);

      expect(affected).toBe(2);
      expect(change).toEqual({ kind: 'restored', ids: [parent.id] });
      expect(listTasks()).toHaveLength(2);
    });
  });
});

describe('reorderTaskGroup', () => {
  it('writes the order and echoes the scope back for the panel to re-fetch that group', () => {
    withTempDatabase(() => {
      const first = createTaskFromInput({ title: 'a' }, NOW).task;
      const second = createTaskFromInput({ title: 'b' }, NOW + 1).task;
      const scope = { kind: 'top', listId: null } as const;

      const { affected, change } = reorderTaskGroup(scope, [second.id, first.id], NOW + 2);

      expect(affected).toBe(2);
      expect(change).toEqual({ kind: 'reordered', ids: [second.id, first.id], scope });
      expect(listTasks().map((task) => task.title)).toEqual(['b', 'a']);
    });
  });

  it('orders subtasks inside their parent', () => {
    withTempDatabase(() => {
      const parent = createTaskFromInput({ title: 'parent' }, NOW).task;
      const first = createTaskFromInput({ title: 'first', parentId: parent.id }, NOW + 1).task;
      const second = createTaskFromInput({ title: 'second', parentId: parent.id }, NOW + 2).task;

      reorderTaskGroup(
        { kind: 'subtask', parentId: parent.id },
        [second.id, first.id],
        NOW + 3,
      );

      expect(listTasks({ parentId: parent.id }).map((task) => task.title)).toEqual([
        'second',
        'first',
      ]);
      // The reorder did not disturb the top level.
      expect(listTasks({ parentId: null }).map((task) => task.title)).toEqual(['parent']);
    });
  });
});

describe('the invariants the service inherits from the repository', () => {
  it('refuses to nest a subtask under a subtask', () => {
    withTempDatabase(() => {
      const parent = createTaskFromInput({ title: 'parent' }, NOW).task;
      const child = createTaskFromInput({ title: 'child', parentId: parent.id }, NOW + 1).task;

      expect(() =>
        createTaskFromInput({ title: 'grandchild', parentId: child.id }, NOW + 2),
      ).toThrow(/one level/);
    });
  });

  it('keeps a task from being created under a parent in the bin', () => {
    withTempDatabase(() => {
      const parent = createTaskFromInput({ title: 'parent' }, NOW).task;
      deleteTasks([parent.id], NOW + 1);

      expect(() =>
        createTaskFromInput({ title: 'child', parentId: parent.id }, NOW + 2),
      ).toThrow(/recycle bin/);
    });
  });
});
