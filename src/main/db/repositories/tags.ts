import { newId } from '@shared/utils/id';

import { getDatabase } from '../connection';

/** One row of `tags`; `color` is unused until the tag manager lands in M03. */
export interface Tag {
  id: string;
  name: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
}

interface TagRow {
  id: string;
  name: string;
  color: string | null;
  created_at: number;
  updated_at: number;
}

/** Tags are padded inside the model, so `" work "` and `"work"` are the same tag. */
export function normaliseTagName(name: string): string {
  return name.trim();
}

/**
 * Returns the tag with this name, creating it on first use (§5.2).
 *
 * The lookup deliberately ignores `deleted_at`: `name` is UNIQUE across the
 * table, so a recycled tag with the same text has to be reused rather than
 * inserted again.
 */
export function findOrCreateTag(name: string, now: number): Tag {
  const db = getDatabase();
  const normalised = normaliseTagName(name);
  if (normalised === '') throw new Error('a tag name must not be blank');

  const existing = db
    .prepare('SELECT id, name, color, created_at, updated_at FROM tags WHERE name = ?')
    .get(normalised) as TagRow | undefined;
  if (existing !== undefined) return mapTag(existing);

  const id = newId(now);
  db.prepare(
    'INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)',
  ).run(id, normalised, now, now);
  return { id, name: normalised, color: null, createdAt: now, updatedAt: now };
}

/** Replaces a task's whole tag set. Wrapped in a transaction, so callers may nest it. */
export function setTaskTags(taskId: string, names: readonly string[], now: number): void {
  const db = getDatabase();
  const wanted = [...new Set(names.map(normaliseTagName).filter((name) => name !== ''))];

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId);
    const insert = db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)');
    for (const name of wanted) insert.run(taskId, findOrCreateTag(name, now).id);
  });
  replace();
}

/**
 * Tag names per task, in one query rather than one per row.
 *
 * `task_tags` has no position column, so the order is the tag name — stable and
 * the same on every device, which matters once sync merges two tag sets.
 */
export function tagsOfTasks(taskIds: readonly string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return result;

  const placeholders = ids.map(() => '?').join(', ');
  const rows = getDatabase()
    .prepare(
      `SELECT tt.task_id AS taskId, tg.name AS name
         FROM task_tags tt
         JOIN tags tg ON tg.id = tt.tag_id
        WHERE tt.task_id IN (${placeholders})
        ORDER BY tg.name COLLATE NOCASE ASC`,
    )
    .all(...ids) as { taskId: string; name: string }[];

  for (const row of rows) {
    const names = result.get(row.taskId);
    if (names === undefined) result.set(row.taskId, [row.name]);
    else names.push(row.name);
  }
  return result;
}

function mapTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
