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

  it('carries the subtask tally back with the rows', () => {
    withTempDatabase(() => {
      const parent = createTaskFromInput({ title: 'move house' }, NOW).task;
      const plain = createTaskFromInput({ title: 'no subtasks' }, NOW + 1).task;
      const a = createTaskFromInput({ title: 'boxes', parentId: parent.id }, NOW + 2).task;
      const b = createTaskFromInput({ title: 'van', parentId: parent.id }, NOW + 3).task;
      createTaskFromInput({ title: 'cancelled', parentId: parent.id }, NOW + 4);
      updateTaskFromPatch(a.id, { status: 'done' }, NOW + 5);
      updateTaskFromPatch(b.id, { status: 'done' }, NOW + 6);

      const list = listTasks();
      const first = list.find((task) => task.id === parent.id);
      const second = list.find((task) => task.id === plain.id);

      expect(first?.subtasks).toEqual({ total: 3, done: 2 });
      expect(second?.subtasks).toEqual({ total: 0, done: 0 });
    });
  });

  it('drops cancelled and binned subtasks out of the tally', () => {
    withTempDatabase(() => {
      const parent = createTaskFromInput({ title: 'parent' }, NOW).task;
      const keep = createTaskFromInput({ title: 'keep', parentId: parent.id }, NOW + 1).task;
      const dropped = createTaskFromInput({ title: 'dropped', parentId: parent.id }, NOW + 2).task;
      const binned = createTaskFromInput({ title: 'binned', parentId: parent.id }, NOW + 3).task;
      updateTaskFromPatch(dropped.id, { status: 'cancelled' }, NOW + 4);
      deleteTasks([binned.id], NOW + 5);

      expect(listTasks().find((task) => task.id === parent.id)?.subtasks).toEqual({
        total: 1,
        done: 0,
      });
      expect(keep.id).toBeDefined();
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

describe('repeating tasks', () => {
  /** A daily 9am task whose due is the day before the tick, i.e. ticked late. */
  const repeating = (overrides: Record<string, unknown> = {}) =>
    createTaskFromInput(
      {
        title: 'stand-up',
        dueAt: new Date(2026, 4, 11, 9).getTime(),
        dueHasTime: true,
        repeatRule: 'FREQ=DAILY',
        repeatMode: 'fixed',
        priority: 2,
        notes: 'the usual',
        tags: ['work'],
        ...overrides,
      },
      NOW,
    ).task;

  it('mints the next occurrence when the task is ticked off', () => {
    withTempDatabase(() => {
      const task = repeating();

      const { task: done, next, change } = updateTaskFromPatch(task.id, { status: 'done' }, NOW);

      expect(done?.status).toBe('done');
      expect(next).not.toBeNull();
      expect(next?.title).toBe('stand-up');
      expect(next?.status).toBe('todo');
      // Late by a day, so the follow-up is the next 9am rather than one already
      // in the past.
      expect(new Date(next?.dueAt as number).getDate()).toBe(13);
      expect(new Date(next?.dueAt as number).getHours()).toBe(9);
      expect(next?.dueHasTime).toBe(true);
      expect(next?.repeatRule).toBe('FREQ=DAILY');
      // What describes the task carries over; what describes this run of it does not.
      expect(next?.notes).toBe('the usual');
      expect(next?.priority).toBe(2);
      expect(next?.tags).toEqual(['work']);
      expect(next?.completedAt).toBeNull();
      // One action, two rows named, so the undo stack and the marker's recount see
      // the whole effect of the tick.
      expect(change).toEqual({ kind: 'updated', ids: [task.id, next?.id] });
    });
  });

  it('leaves the task alone when it does not repeat', () => {
    withTempDatabase(() => {
      const task = createTaskFromInput({ title: 'one-off' }, NOW).task;

      const { next, change } = updateTaskFromPatch(task.id, { status: 'done' }, NOW + 1);

      expect(next).toBeNull();
      expect(change.ids).toEqual([task.id]);
      expect(listTasks({ status: 'done' })).toHaveLength(1);
    });
  });

  it('does not mint a second occurrence when a patch that is not the tick is saved', () => {
    withTempDatabase(() => {
      const task = repeating({ dueAt: new Date(2026, 8, 1, 9).getTime() });
      updateTaskFromPatch(task.id, { status: 'done' }, NOW + 1);
      // Editing the completed task's title must not be read as completing it again.
      updateTaskFromPatch(task.id, { title: 'renamed' }, NOW + 2);

      expect(listTasks().find((t) => t.title === 'renamed')?.status).toBe('done');
      expect(listTasks()).toHaveLength(2);
    });
  });

  it('counts the interval from the tick in after_completion mode', () => {
    withTempDatabase(() => {
      const task = repeating({
        repeatMode: 'after_completion',
        repeatRule: 'FREQ=DAILY;INTERVAL=3',
      });

      // Ticked on the 12th at 10:00, so the follow-up is the 15th at 9am — the
      // task's own clock time, not the hour it happened to be completed at.
      const { next } = updateTaskFromPatch(task.id, { status: 'done' }, NOW);
      const due = new Date(next?.dueAt as number);

      expect(due.getDate()).toBe(15);
      expect(due.getHours()).toBe(9);
    });
  });

  it('mints nothing when the rule has run out', () => {
    withTempDatabase(() => {
      const task = repeating({ repeatRule: 'FREQ=DAILY;COUNT=1' });

      const { next } = updateTaskFromPatch(task.id, { status: 'done' }, NOW);

      expect(next).toBeNull();
      expect(listTasks()).toHaveLength(1);
    });
  });

  it('gives the new occurrence a checklist of its own', () => {
    withTempDatabase(() => {
      const task = repeating();
      const subtask = createTaskFromInput({ title: 'check boxes', parentId: task.id }, NOW + 1)
        .task;
      updateTaskFromPatch(subtask.id, { status: 'done' }, NOW + 2);

      const { next } = updateTaskFromPatch(task.id, { status: 'done' }, NOW + 3);

      expect(next).not.toBeNull();
      expect(listTasks({ parentId: next?.id as string })).toEqual([]);
      // The completed one keeps the subtask it had.
      expect(listTasks({ parentId: task.id })).toHaveLength(1);
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
