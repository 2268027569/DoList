/**
 * Task entity types, shared by the main process, the preload bridge and the
 * panel. They mirror the `tasks` table (docs/ARCHITECTURE.md §5.2): same fields,
 * camelCase instead of snake_case, and every timestamp is UTC milliseconds.
 */

export const TASK_STATUSES = ['todo', 'doing', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** 0 = none, 1 = low, 2 = medium, 3 = high (mirrors the schema comment). */
export const TASK_PRIORITIES = [0, 1, 2, 3] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** `fixed` keeps the original schedule, `after_completion` counts from the moment it was ticked. */
export const REPEAT_MODES = ['fixed', 'after_completion'] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];

/** One row of `tasks`, as the data layer stores it. */
export interface Task {
  id: string;
  /** `null` = the Inbox, i.e. not filed under any list. */
  listId: string | null;
  /** `null` = top level. Subtasks are one level deep only (§5.2). */
  parentId: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: number | null;
  /** False when `dueAt` is a date without a clock time. */
  dueHasTime: boolean;
  /** RFC 5545 RRULE, e.g. `FREQ=WEEKLY;BYDAY=MO`. */
  repeatRule: string | null;
  repeatMode: RepeatMode | null;
  estimateMin: number | null;
  actualMin: number | null;
  /** Minutes before `dueAt` to remind; `null` = no reminder. */
  remindLeadMin: number | null;
  /** Position inside its group: a list (top-level tasks) or a parent's subtasks. */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  /** Soft-delete tombstone; a non-null value means the task is in the recycle bin. */
  deletedAt: number | null;
}

/** Fields a create call may set. Everything else takes its schema default. */
export interface TaskDraft {
  title: string;
  listId?: string | null;
  /** When set, the parent must be top level — subtasks stay one level deep. */
  parentId?: string | null;
  notes?: string | null;
  priority?: TaskPriority;
  dueAt?: number | null;
  dueHasTime?: boolean;
  repeatRule?: string | null;
  repeatMode?: RepeatMode | null;
  estimateMin?: number | null;
  remindLeadMin?: number | null;
  /** Tag names; ones that do not exist yet are created on the spot. */
  tags?: readonly string[];
}

/** Partial update. A `undefined` field is left alone; `null` clears the column. */
export interface TaskPatch {
  title?: string;
  listId?: string | null;
  notes?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: number | null;
  dueHasTime?: boolean;
  repeatRule?: string | null;
  repeatMode?: RepeatMode | null;
  estimateMin?: number | null;
  actualMin?: number | null;
  remindLeadMin?: number | null;
  /** Replaces the whole tag set when present. */
  tags?: readonly string[];
}

/** Row order `queryTasks` returns. `manual` is the stored `sort_order`. */
export const TASK_SORTS = ['manual', 'due', 'priority', 'created', 'title'] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

export interface TaskFilter {
  /** `null` = the Inbox; omitted = every list. */
  listId?: string | null;
  status?: TaskStatus | readonly TaskStatus[];
  /** `null` = top-level tasks; a task id = that task's subtasks. */
  parentId?: string | null;
  /** Case-insensitive substring over title and notes. */
  text?: string;
  /** Half-open window over `dueAt`, `[dueFrom, dueTo)`. */
  dueFrom?: number;
  dueTo?: number;
  sort?: TaskSort;
  limit?: number;
  offset?: number;
  /** Include soft-deleted rows (the recycle bin). Default false. */
  includeDeleted?: boolean;
}

/**
 * Which group a `sort_order` sequence belongs to. Top-level tasks are ordered
 * inside their list, subtasks inside their parent (§5.2, M02 D3).
 */
export type ReorderScope =
  | { kind: 'top'; listId: string | null }
  | { kind: 'subtask'; parentId: string };
