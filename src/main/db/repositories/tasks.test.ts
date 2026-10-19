import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';

import type { Task } from '@shared/types/task';
import { localDayBounds } from '@shared/utils/day';

import { withTempDatabase } from '../test-db';
import { tagsOfTasks } from './tags';
import {
  createTask,
  getTask,
  markerCounts,
  queryTasks,
  reorderTasks,
  restore,
  softDelete,
  updateTask,
} from './tasks';

/** A local 10:00, so every boundary below is read in the same local day. */
const NOW = new Date(2026, 4, 12, 10, 0, 0).getTime();
const HOUR = 3_600_000;

interface Row {
  id: string;
  status?: string;
  dueAt?: number | null;
  deletedAt?: number | null;
}

/** Inserts a task with only the columns these counts read. */
function insertTask(db: Database.Database, row: Row): void {
  db.prepare(
    `INSERT INTO tasks (id, title, status, priority, due_at, sort_order, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 0, ?, 0, ?, ?, ?)`,
  ).run(
    row.id,
    `task ${row.id}`,
    row.status ?? 'todo',
    row.dueAt ?? null,
    NOW,
    NOW,
    row.deletedAt ?? null,
  );
}

/** A task cannot reference a list that does not exist, so the FK needs a row. */
function insertList(db: Database.Database, id: string): void {
  db.prepare(
    'INSERT INTO lists (id, name, sort_order, is_archived, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?)',
  ).run(id, id, NOW, NOW);
}

describe('markerCounts', () => {
  it('reports zeros on an empty database', () => {
    withTempDatabase(() => {
      expect(markerCounts(NOW, localDayBounds(NOW))).toEqual({
        open: 0,
        overdue: 0,
        dueToday: 0,
        doneToday: 0,
        dueSoon: 0,
      });
    });
  });

  it('counts open, overdue, today, done-today and due-soon separately', () => {
    withTempDatabase((db) => {
      insertTask(db, { id: 'a', dueAt: NOW + 2 * HOUR }); // today, later
      insertTask(db, { id: 'b', status: 'doing', dueAt: NOW - 3 * HOUR }); // overdue
      insertTask(db, { id: 'c', status: 'done', dueAt: NOW + HOUR }); // finished today
      insertTask(db, { id: 'd', status: 'cancelled', dueAt: NOW + HOUR }); // today, not work
      insertTask(db, { id: 'e', dueAt: NOW + 30 * HOUR }); // tomorrow, past the 24h window
      insertTask(db, { id: 'f', dueAt: NOW, deletedAt: NOW }); // in the recycle bin
      insertTask(db, { id: 'g', dueAt: NOW }); // exactly now: overdue uses `<`, not `<=`

      expect(markerCounts(NOW, localDayBounds(NOW))).toEqual({
        open: 4, // a, b, e, g
        overdue: 1, // b — g is due right now, which is not yet late
        dueToday: 5, // a, b, c, d, g
        doneToday: 1, // c
        dueSoon: 2, // a, g — b is already overdue, so it is not "upcoming"
      });
    });
  });

  it('leaves soft-deleted tasks out of every count', () => {
    withTempDatabase((db) => {
      insertTask(db, { id: 'gone', dueAt: NOW - HOUR, deletedAt: NOW });

      expect(markerCounts(NOW, localDayBounds(NOW))).toEqual({
        open: 0,
        overdue: 0,
        dueToday: 0,
        doneToday: 0,
        dueSoon: 0,
      });
    });
  });

  it('keeps today and tomorrow apart across the local midnight boundary', () => {
    withTempDatabase((db) => {
      const day = localDayBounds(NOW);
      insertTask(db, { id: 'late', dueAt: day.end - 1 });
      insertTask(db, { id: 'next', dueAt: day.end });

      const counts = markerCounts(NOW, day);
      expect(counts.dueToday).toBe(1); // `due_at < end` is exclusive on the upper bound
      expect(counts.open).toBe(2);
    });
  });
});

describe('createTask', () => {
  it('trims the title and fills in the schema defaults', () => {
    withTempDatabase(() => {
      const task = createTask({ title: '  write the plan  ' }, NOW);

      expect(task.title).toBe('write the plan');
      expect(task.status).toBe('todo');
      expect(task.priority).toBe(0);
      expect(task.listId).toBeNull();
      expect(task.parentId).toBeNull();
      expect(task.dueAt).toBeNull();
      expect(task.dueHasTime).toBe(false);
      expect(task.completedAt).toBeNull();
      expect(task.deletedAt).toBeNull();
      expect(task.createdAt).toBe(NOW);
      expect(task.updatedAt).toBe(NOW);
    });
  });

  it('appends to the end of its own group only', () => {
    withTempDatabase((db) => {
      insertList(db, 'l1');
      const inbox = createTask({ title: 'inbox' }, NOW);
      const listed = createTask({ title: 'listed', listId: 'l1' }, NOW);
      const inboxAgain = createTask({ title: 'inbox again' }, NOW);

      expect(inbox.sortOrder).toBe(0);
      expect(inboxAgain.sortOrder).toBe(1); // the listed task did not consume a slot
      expect(listed.sortOrder).toBe(0);
    });
  });

  it('rejects a blank title', () => {
    withTempDatabase(() => {
      expect(() => createTask({ title: '   ' }, NOW)).toThrow(/blank/);
    });
  });

  it('allows one level of subtasks and refuses a second', () => {
    withTempDatabase(() => {
      const parent = createTask({ title: 'parent' }, NOW);
      const child = createTask({ title: 'child', parentId: parent.id }, NOW);

      expect(child.parentId).toBe(parent.id);
      expect(child.sortOrder).toBe(0); // subtasks carry their own sequence
      expect(() => createTask({ title: 'grandchild', parentId: child.id }, NOW)).toThrow(
        /one level/,
      );
    });
  });

  it('refuses a subtask under a parent in the recycle bin', () => {
    withTempDatabase(() => {
      const parent = createTask({ title: 'parent' }, NOW);
      softDelete([parent.id], NOW);

      expect(() => createTask({ title: 'child', parentId: parent.id }, NOW)).toThrow(
        /recycle bin/,
      );
    });
  });

  it('creates the tags it is given, collapsing the duplicates', () => {
    withTempDatabase((db) => {
      const task = createTask({ title: 'tagged', tags: ['work', ' work ', 'urgent'] }, NOW);
      const count = db.prepare('SELECT COUNT(*) AS count FROM tags').get() as { count: number };

      expect(count.count).toBe(2); // " work " is the same tag as "work"
      expect(tagsOfTasks([task.id]).get(task.id)).toEqual(['urgent', 'work']);
    });
  });
});

describe('updateTask', () => {
  it('returns null for an unknown id', () => {
    withTempDatabase(() => {
      expect(updateTask('nope', { title: 'x' }, NOW)).toBeNull();
    });
  });

  it('leaves untouched fields alone and moves updated_at', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'before', notes: 'keep me' }, NOW);
      const later = NOW + 1_000;
      const updated = updateTask(task.id, { priority: 3 }, later) as Task;

      expect(updated.priority).toBe(3);
      expect(updated.title).toBe('before');
      expect(updated.notes).toBe('keep me');
      expect(updated.createdAt).toBe(NOW);
      expect(updated.updatedAt).toBe(later);
    });
  });

  it('clears a field passed as null', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x', notes: 'note' }, NOW);
      const updated = updateTask(task.id, { notes: null }, NOW) as Task;

      expect(updated.notes).toBeNull();
    });
  });

  it('stamps completed_at on the tick and clears it on the untick', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);

      const done = updateTask(task.id, { status: 'done' }, NOW + 5) as Task;
      expect(done.completedAt).toBe(NOW + 5);

      // Ticking an already-done task must not move the original stamp.
      const again = updateTask(task.id, { status: 'done' }, NOW + 7) as Task;
      expect(again.completedAt).toBe(NOW + 5);

      const undone = updateTask(task.id, { status: 'todo' }, NOW + 9) as Task;
      expect(undone.completedAt).toBeNull();
    });
  });

  it('re-appends a task moved to another list', () => {
    withTempDatabase((db) => {
      insertList(db, 'l1');
      insertList(db, 'l2');
      createTask({ title: 'a', listId: 'l2' }, NOW);
      const moved = createTask({ title: 'b', listId: 'l2' }, NOW);
      expect(moved.sortOrder).toBe(1);

      const after = updateTask(moved.id, { listId: 'l1' }, NOW) as Task;
      expect(after.listId).toBe('l1');
      expect(after.sortOrder).toBe(0); // appended, not left in the middle
    });
  });

  it('replaces the whole tag set when tags are sent', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x', tags: ['a', 'b'] }, NOW);

      updateTask(task.id, { tags: ['b', 'c'] }, NOW);
      expect(tagsOfTasks([task.id]).get(task.id)).toEqual(['b', 'c']);

      updateTask(task.id, { tags: [] }, NOW);
      expect(tagsOfTasks([task.id]).get(task.id)).toBeUndefined();
    });
  });
});

describe('softDelete', () => {
  it('takes the subtasks down with their parent', () => {
    withTempDatabase(() => {
      const parent = createTask({ title: 'parent' }, NOW);
      const child = createTask({ title: 'child', parentId: parent.id }, NOW);

      expect(softDelete([parent.id], NOW)).toBe(2);
      expect(getTask(child.id)?.deletedAt).toBe(NOW);
      expect(queryTasks()).toEqual([]);
    });
  });

  it('does nothing the second time', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);

      expect(softDelete([task.id], NOW)).toBe(1);
      expect(softDelete([task.id], NOW)).toBe(0);
    });
  });
});

describe('restore', () => {
  it('brings back the subtasks that went down with the parent', () => {
    withTempDatabase(() => {
      const parent = createTask({ title: 'parent' }, NOW);
      const child = createTask({ title: 'child', parentId: parent.id }, NOW);
      softDelete([parent.id], NOW);

      expect(restore([parent.id], NOW + 1)).toBe(2);
      expect(getTask(child.id)?.deletedAt).toBeNull();
      expect(queryTasks()).toHaveLength(2);
    });
  });

  it('leaves a subtask behind when it was deleted on its own earlier', () => {
    withTempDatabase(() => {
      const parent = createTask({ title: 'parent' }, NOW);
      const child = createTask({ title: 'child', parentId: parent.id }, NOW);
      softDelete([child.id], NOW); // its own tombstone
      softDelete([parent.id], NOW + 1); // a later cascade leaves it alone

      expect(restore([parent.id], NOW + 2)).toBe(1);
      expect(getTask(parent.id)?.deletedAt).toBeNull();
      expect(getTask(child.id)?.deletedAt).toBe(NOW);
    });
  });

  it('ignores a task that is not in the bin', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);

      expect(restore([task.id], NOW)).toBe(0);
    });
  });
});

describe('queryTasks', () => {
  it('hides the recycle bin unless it is asked for', () => {
    withTempDatabase(() => {
      const live = createTask({ title: 'live' }, NOW);
      const gone = createTask({ title: 'gone' }, NOW + 1);
      softDelete([gone.id], NOW + 2);

      expect(queryTasks().map((task) => task.id)).toEqual([live.id]);
      expect(queryTasks({ includeDeleted: true })).toHaveLength(2);
    });
  });

  it('filters by list, status and a text fragment', () => {
    withTempDatabase((db) => {
      insertList(db, 'l1');
      const listed = createTask({ title: 'Buy milk', listId: 'l1' }, NOW);
      const inbox = createTask({ title: 'buy bread' }, NOW + 1_000);
      const noted = createTask({ title: 'call mum', notes: 'about milk' }, NOW + 2_000);
      updateTask(listed.id, { status: 'done' }, NOW + 3_000);

      expect(queryTasks({ listId: 'l1' }).map((task) => task.id)).toEqual([listed.id]);
      expect(queryTasks({ listId: null }).map((task) => task.id)).toEqual([inbox.id, noted.id]);
      expect(queryTasks({ status: 'done' }).map((task) => task.id)).toEqual([listed.id]);
      // SQLite's LIKE is case-insensitive for ASCII, and the notes are searched too.
      expect(queryTasks({ text: 'milk' }).map((task) => task.title)).toEqual([
        'Buy milk',
        'call mum',
      ]);
      expect(queryTasks({ text: 'buy' }).map((task) => task.title)).toEqual([
        'Buy milk',
        'buy bread',
      ]);
    });
  });

  it('respects the row window', () => {
    withTempDatabase(() => {
      createTask({ title: 'one' }, NOW);
      createTask({ title: 'two' }, NOW + 1);
      createTask({ title: 'three' }, NOW + 2);

      expect(queryTasks({ limit: 2 }).map((task) => task.title)).toEqual(['one', 'two']);
      expect(queryTasks({ limit: 2, offset: 2 }).map((task) => task.title)).toEqual(['three']);
    });
  });

  it('puts undated tasks last when ordering by due date', () => {
    withTempDatabase(() => {
      createTask({ title: 'undated' }, NOW);
      createTask({ title: 'later', dueAt: NOW + 5_000 }, NOW + 1);
      createTask({ title: 'sooner', dueAt: NOW + 1_000 }, NOW + 2);

      expect(queryTasks({ sort: 'due' }).map((task) => task.title)).toEqual([
        'sooner',
        'later',
        'undated',
      ]);
    });
  });
});

describe('reorderTasks', () => {
  it('writes the order it is given and ignores rows from another group', () => {
    withTempDatabase((db) => {
      insertList(db, 'l1');
      const first = createTask({ title: 'a' }, NOW);
      const second = createTask({ title: 'b' }, NOW + 1);
      const foreign = createTask({ title: 'other', listId: 'l1' }, NOW + 2);

      expect(
        reorderTasks({ kind: 'top', listId: null }, [second.id, foreign.id, first.id], NOW + 9),
      ).toBe(2);
      expect(queryTasks({ listId: null }).map((task) => task.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(getTask(foreign.id)?.sortOrder).toBe(0); // untouched
    });
  });

  it('orders the subtasks inside their parent', () => {
    withTempDatabase(() => {
      const parent = createTask({ title: 'parent' }, NOW);
      const first = createTask({ title: 'first', parentId: parent.id }, NOW);
      const second = createTask({ title: 'second', parentId: parent.id }, NOW);

      expect(
        reorderTasks({ kind: 'subtask', parentId: parent.id }, [second.id, first.id], NOW),
      ).toBe(2);
      expect(queryTasks({ parentId: parent.id }).map((task) => task.id)).toEqual([
        second.id,
        first.id,
      ]);
    });
  });
});
