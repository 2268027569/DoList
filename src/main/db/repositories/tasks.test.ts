import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';

import { localDayBounds } from '@shared/utils/day';

import { withTempDatabase } from '../test-db';
import { markerCounts } from './tasks';

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
