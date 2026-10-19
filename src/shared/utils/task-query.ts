/**
 * Filter object → SQL fragment + bound parameters (docs/ARCHITECTURE.md §5.6).
 *
 * Kept pure and separate from the repository so the translation is unit-tested
 * without a database: the repository only runs what this returns. Every value
 * reaches SQLite as a bound parameter, and the sort falls back to a fixed
 * whitelist, so nothing a filter may carry can end up as raw SQL text.
 */
import type { TaskFilter, TaskStatus } from '../types/task';

/** Hard ceiling per query — the panel scrolls its result, it does not page forever. */
export const TASK_QUERY_MAX_LIMIT = 500;
export const TASK_QUERY_DEFAULT_LIMIT = 200;

/**
 * Sort whitelist. `due` puts undated tasks last so a dated task is never hidden
 * below them; ties everywhere fall back to `sort_order`, which keeps the manual
 * arrangement the user dragged into place.
 */
const ORDER_BY: Record<string, string> = {
  manual: 't.sort_order ASC, t.created_at ASC',
  due: 't.due_at IS NULL ASC, t.due_at ASC, t.sort_order ASC',
  priority: 't.priority DESC, t.sort_order ASC',
  created: 't.created_at ASC',
  title: 't.title COLLATE NOCASE ASC',
};

export interface TaskQuerySql {
  where: string;
  orderBy: string;
  params: unknown[];
  limit: number;
  offset: number;
}

export function buildTaskQuery(filter: TaskFilter = {}): TaskQuerySql {
  const clauses: string[] = [];
  const params: unknown[] = [];

  // Soft-deleted rows are the recycle bin: out of every query unless asked for.
  clauses.push(filter.includeDeleted === true ? '1 = 1' : 't.deleted_at IS NULL');

  if (filter.listId !== undefined) {
    if (filter.listId === null) {
      clauses.push('t.list_id IS NULL');
    } else {
      clauses.push('t.list_id = ?');
      params.push(filter.listId);
    }
  }

  if (filter.parentId !== undefined) {
    if (filter.parentId === null) {
      clauses.push('t.parent_id IS NULL');
    } else {
      clauses.push('t.parent_id = ?');
      params.push(filter.parentId);
    }
  }

  if (filter.status !== undefined) {
    const statuses: readonly TaskStatus[] =
      typeof filter.status === 'string' ? [filter.status] : filter.status;
    if (statuses.length > 0) {
      clauses.push(`t.status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
  }

  const text = filter.text?.trim();
  if (text !== undefined && text !== '') {
    const pattern = `%${escapeLike(text)}%`;
    clauses.push("(t.title LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }

  if (filter.dueFrom !== undefined) {
    clauses.push('t.due_at >= ?');
    params.push(filter.dueFrom);
  }
  if (filter.dueTo !== undefined) {
    clauses.push('t.due_at < ?');
    params.push(filter.dueTo);
  }

  return {
    where: clauses.join(' AND '),
    orderBy: ORDER_BY[filter.sort ?? 'manual'] ?? ORDER_BY['manual']!,
    params,
    limit: clampLimit(filter.limit),
    offset: clampOffset(filter.offset),
  };
}

/**
 * Neutralises LIKE's own wildcards so a title containing `%` searches for that
 * character instead of matching anything. `\` is the ESCAPE character above.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return TASK_QUERY_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), TASK_QUERY_MAX_LIMIT);
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(Math.floor(offset), 0);
}
