import type { Attachment } from '@shared/types/task';
import { newId } from '@shared/utils/id';

import { getDatabase } from '../connection';

/** The row shape lives in `shared/types/task.ts` so the panel can name it too. */
export type { Attachment };

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

const COLUMNS = 'id, task_id, path, name, size, created_at';

function mapAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    taskId: row.task_id,
    path: row.path,
    name: row.name,
    size: row.size,
    createdAt: row.created_at,
  };
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

/**
 * One row by id, or `null` when it is unknown.
 *
 * The panel holds an attachment id (it is what a click on the row names), while the
 * table is keyed by task, so opening a file needs this lookup rather than a task id.
 */
export function getAttachment(id: string): Attachment | null {
  const row = getDatabase()
    .prepare(`SELECT ${COLUMNS} FROM attachments WHERE id = ?`)
    .get(id) as AttachmentRow | undefined;
  return row === undefined ? null : mapAttachment(row);
}

export function attachmentsOfTask(taskId: string): Attachment[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${COLUMNS}
         FROM attachments
        WHERE task_id = ?
        ORDER BY created_at ASC`,
    )
    .all(taskId) as AttachmentRow[];

  return rows.map(mapAttachment);
}
