import { newId } from '@shared/utils/id';

import { getDatabase } from '../connection';

/**
 * One row of `attachments`. Only a *reference* to the file is stored — the file
 * itself stays where the user put it, which is what "local first" means here;
 * copying it into the database directory would duplicate gigabyte-scale files
 * and make folder sync (M10) carry them.
 */
export interface Attachment {
  id: string;
  taskId: string;
  path: string;
  /** Display name, usually the file's basename; `null` lets the panel derive one. */
  name: string | null;
  size: number | null;
  createdAt: number;
}

interface AttachmentRow {
  id: string;
  task_id: string;
  path: string;
  name: string | null;
  size: number | null;
  created_at: number;
}

export interface AttachmentInput {
  path: string;
  name?: string | null;
  size?: number | null;
}

export function addAttachment(taskId: string, input: AttachmentInput, now: number): Attachment {
  const id = newId(now);
  const name = input.name ?? null;
  const size = input.size ?? null;

  getDatabase()
    .prepare(
      'INSERT INTO attachments (id, task_id, path, name, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, taskId, input.path, name, size, now);

  return { id, taskId, path: input.path, name, size, createdAt: now };
}

/** True when a row was removed; false means the id was already gone. */
export function removeAttachment(id: string): boolean {
  return getDatabase().prepare('DELETE FROM attachments WHERE id = ?').run(id).changes > 0;
}

export function attachmentsOfTask(taskId: string): Attachment[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, task_id, path, name, size, created_at
         FROM attachments
        WHERE task_id = ?
        ORDER BY created_at ASC`,
    )
    .all(taskId) as AttachmentRow[];

  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    path: row.path,
    name: row.name,
    size: row.size,
    createdAt: row.created_at,
  }));
}
