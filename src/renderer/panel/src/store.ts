import { create } from 'zustand';

import type { TaskBulkOp, TaskPatchInput, TaskQueryInput } from '@shared/contracts/task';
import type { BootParams, PanelState } from '@shared/types/app';
import type { Attachment, ReorderScope, TaskListItem, TaskWithTags } from '@shared/types/task';
import { moveWithin } from '@shared/utils/sort-order';

/**
 * The Inbox: top-level tasks that are still open and belong to no list
 * (`list_id = NULL`, docs/ARCHITECTURE.md §5.2). The panel offers nothing else
 * yet — views with their own filters are M03.
 */
const INBOX_FILTER: TaskQueryInput = { listId: null, parentId: null, status: ['todo', 'doing'] };

/** The group the list's manual order lives in, which is also what a move rewrites. */
const INBOX_SCOPE: ReorderScope = { kind: 'top', listId: null };

/**
 * The subtasks the open detail shows. Every status, because the checklist under a
 * parent is where its finished steps belong too — unlike the Inbox, which is a list
 * of what is still to be done.
 */
const SUBTASK_FILTER: Omit<TaskQueryInput, 'parentId'> = { status: ['todo', 'doing', 'done'] };

export type TasksStatus = 'loading' | 'ready' | 'error';

interface PanelStore {
  boot: BootParams;
  panelState: PanelState;

  /**
   * The Inbox query result. It is re-fetched rather than patched in place: the
   * main process owns the rows, and a second copy kept here would drift from it
   * (M02 D4).
   */
  tasks: TaskListItem[];
  tasksStatus: TasksStatus;

  /**
   * The open detail view's row (M02 S4). It is the panel's second read, and it is
   * a single row by id rather than the Inbox page: a task marked done would fall
   * out of the Inbox filter, and the screen being edited on would empty itself.
   */
  openTaskId: string | null;
  openTask: TaskWithTags | null;

  /**
   * The open task's own checklist (M02 S6). Read separately from the row the
   * detail was opened on, because it is a different query — one task's children
   * rather than the Inbox page.
   */
  subtasks: TaskWithTags[];

  /**
   * The open task's attachments (M02 S7). References to files the user picked
   * through the OS dialog: the rows say where a file is, and the file stays there.
   */
  attachments: Attachment[];

  /**
   * The rows the user multi-selected in the list (M02 S7). Ids rather than rows:
   * the list is re-fetched wholesale after every write, so a row object held here
   * would be a stale copy of a row that is drawn from somewhere else.
   */
  selectedIds: string[];

  /** True after a write came back rejected, so the detail can say so. */
  saveFailed: boolean;

  /** Re-runs the Inbox query. Driven by `event:task-changed`, not by the writer. */
  refreshTasks: () => Promise<void>;
  /** Stores a new Inbox task; resolves to `false` when nothing was written. */
  addTask: (title: string) => Promise<boolean>;
  /** Ticks a task done, or puts it back to `todo`. */
  toggleTask: (id: string, done: boolean) => Promise<void>;
  /**
   * Moves a row to `to` inside the Inbox group, writing the group's order back
   * (M02 D3). Resolves to `false` when there was nothing to move.
   */
  moveTask: (id: string, to: number) => Promise<boolean>;

  /** Opens the detail on `id` and reads its row. */
  openTaskDetail: (id: string) => Promise<void>;
  /** Leaves the detail and goes back to the list. */
  closeTaskDetail: () => void;
  /** Re-reads the open row and its checklist after a write announced itself. */
  refreshOpenTask: () => Promise<void>;
  /** Re-reads just the open task's checklist. */
  refreshSubtasks: () => Promise<void>;
  /** Saves one field of the open task (M02 D9: there is no save button). */
  saveOpenTask: (patch: TaskPatchInput) => Promise<boolean>;
  /** Soft-deletes the open task and returns to the list. */
  deleteOpenTask: () => Promise<void>;
  /** Adds a subtask to the open task and keeps the caret in the field. */
  addSubtask: (title: string) => Promise<boolean>;
  /** Soft-deletes a subtask of the open task. */
  removeSubtask: (id: string) => Promise<void>;

  /** Adds or removes one row from the multi-selection (M02 S7). */
  toggleSelected: (id: string) => void;
  /** Drops the selection without writing anything. */
  clearSelection: () => void;
  /**
   * Applies one command to the whole selection in a single write. The selection is
   * dropped afterwards, whatever the command was.
   */
  bulk: (op: TaskBulkOp) => Promise<boolean>;
  /**
   * Takes the newest write back (M02 D7). Resolves to `false` when the stack was
   * empty — pressing the shortcut one time too many is not a failure.
   */
  undo: () => Promise<boolean>;

  /** Re-reads the open task's attachments. */
  refreshAttachments: () => Promise<void>;
  /** Opens the OS file picker and stores whatever it returned. */
  pickAttachments: () => Promise<void>;
  /** Drops one attachment row; the file itself is left alone. */
  removeAttachment: (id: string) => Promise<void>;
  /** Opens one attachment with whatever handler the OS has for it. */
  openAttachment: (id: string) => Promise<void>;

  setBoot: (boot: BootParams) => void;
  setPanelState: (state: PanelState) => void;
}

/**
 * The panel store stays deliberately small: view state and repository data live in
 * separate fields, so a re-render driven by one never implies the other
 * (docs/ARCHITECTURE.md §7). The task fields are the M02 slice.
 */
export const usePanelStore = create<PanelStore>((set, get) => ({
  boot: { mode: 'light', theme: 'minimal', locale: 'en' },
  panelState: 'hidden',

  tasks: [],
  tasksStatus: 'loading',

  openTaskId: null,
  openTask: null,
  subtasks: [],
  attachments: [],
  selectedIds: [],
  saveFailed: false,

  refreshTasks: async () => {
    const result = await window.api.task.query(INBOX_FILTER);
    if (!result.ok) {
      set({ tasksStatus: 'error' });
      return;
    }
    // The selection is cut down to rows that are still on screen: a tick or a
    // delete can take a selected row out of the Inbox, and a selection nobody can
    // see would be a bulk command waiting to hit rows the user cannot check.
    const visible = new Set(result.data.map((task) => task.id));
    set({
      tasks: result.data,
      tasksStatus: 'ready',
      selectedIds: get().selectedIds.filter((id) => visible.has(id)),
    });
  },

  addTask: async (title) => {
    const result = await window.api.task.create({ title });
    if (!result.ok) {
      set({ tasksStatus: 'error' });
      return false;
    }
    // Nothing is inserted here: the write announces itself with
    // `event:task-changed` and `refreshTasks` is the one path that updates the
    // list, so one write still causes exactly one fetch (M02 §5, D4).
    return true;
  },

  toggleTask: async (id, done) => {
    const result = await window.api.task.update(id, { status: done ? 'done' : 'todo' });
    if (!result.ok) set({ tasksStatus: 'error' });
  },

  moveTask: async (id, to) => {
    const current = get().tasks;
    const from = current.findIndex((task) => task.id === id);
    if (from < 0) return false;

    const ids = current.map((task) => task.id);
    const next = moveWithin(ids, from, to);
    // The same array by reference means the row would not move: sending it anyway
    // would be a write, a reorder event and a re-fetch for nothing.
    if (next === ids) return false;

    // Only the rows this view is showing are sent. The rest of the group — a done
    // task, which the Inbox filter leaves out — is parked after them by the
    // repository, so the visible sequence is exactly the one stored and the group
    // still ends up a clean 0…n-1 (reorderTasks).
    const result = await window.api.task.reorder(INBOX_SCOPE, [...next]);
    // Same failure surface as the other writes here: the order did not change, so
    // the list still shows the truth, but the user should not be left believing the
    // move was stored.
    if (!result.ok) set({ tasksStatus: 'error' });
    return result.ok;
  },

  openTaskDetail: async (id) => {
    set({
      openTaskId: id,
      openTask: null,
      subtasks: [],
      attachments: [],
      saveFailed: false,
    });
    const result = await window.api.task.get(id);
    if (!result.ok) {
      set({ saveFailed: true });
      return;
    }
    // The row can have been deleted from another surface; there is nothing to edit.
    if (result.data === null) {
      set({ openTaskId: null, openTask: null });
      return;
    }
    set({ openTask: result.data });
    await get().refreshSubtasks();
    await get().refreshAttachments();
  },

  closeTaskDetail: () =>
    set({
      openTaskId: null,
      openTask: null,
      subtasks: [],
      attachments: [],
      saveFailed: false,
    }),

  refreshOpenTask: async () => {
    const id = get().openTaskId;
    if (id === null) return;

    const result = await window.api.task.get(id);
    if (!result.ok) return;
    if (result.data === null) {
      set({ openTaskId: null, openTask: null });
      return;
    }
    set({ openTask: result.data });
    // The checklist is read again too: ticking a subtask from this screen changes
    // it, and so does anything that happened on another surface while it was open.
    await get().refreshSubtasks();
  },

  refreshSubtasks: async () => {
    const id = get().openTaskId;
    if (id === null) return;

    const result = await window.api.task.query({ ...SUBTASK_FILTER, parentId: id });
    if (!result.ok) return;
    // The query returns rows without their tags; the checklist does not draw any,
    // and asking for them would be a second read on every subtask write.
    set({ subtasks: result.data.map((task) => ({ ...task, tags: [] })) });
  },

  saveOpenTask: async (patch) => {
    const id = get().openTaskId;
    if (id === null) return false;

    const result = await window.api.task.update(id, patch);
    set({ saveFailed: !result.ok });
    // On success the row comes back through `event:task-changed` and
    // `refreshOpenTask`, so one write is still one read (M02 D4).
    return result.ok;
  },

  deleteOpenTask: async () => {
    const id = get().openTaskId;
    if (id === null) return;

    const result = await window.api.task.delete([id]);
    if (!result.ok) {
      set({ saveFailed: true });
      return;
    }
    set({
      openTaskId: null,
      openTask: null,
      subtasks: [],
      attachments: [],
      saveFailed: false,
    });
  },

  addSubtask: async (title) => {
    const parentId = get().openTaskId;
    if (parentId === null) return false;

    // Empty is not a subtask, and the field keeps whatever whitespace the user
    // typed — same rule as the quick-add field (S3).
    if (title.trim() === '') return false;

    const result = await window.api.task.create({ title, parentId });
    if (!result.ok) {
      set({ saveFailed: true });
      return false;
    }
    return true;
  },

  removeSubtask: async (id) => {
    const result = await window.api.task.delete([id]);
    if (!result.ok) set({ saveFailed: true });
  },

  toggleSelected: (id) => {
    const selected = get().selectedIds;
    set({
      selectedIds: selected.includes(id)
        ? selected.filter((selectedId) => selectedId !== id)
        : [...selected, id],
    });
  },

  clearSelection: () => set({ selectedIds: [] }),

  bulk: async (op) => {
    const ids = get().selectedIds;
    if (ids.length === 0) return false;

    const result = await window.api.task.bulk(ids, op);
    if (!result.ok) {
      set({ tasksStatus: 'error' });
      return false;
    }
    // The command is one write, so the panel answers it with one thing: the
    // selection goes away. Half of it may have just left the view — a bulk tick
    // takes rows out of the Inbox — and the re-fetch is what draws the result.
    set({ selectedIds: [] });
    return true;
  },

  undo: async () => {
    const result = await window.api.task.undo();
    if (!result.ok) {
      set({ tasksStatus: 'error' });
      return false;
    }
    // `null` is an empty stack. Nothing was written, so there is nothing to
    // re-read and nothing to say: the shortcut simply did nothing (M02 D7).
    if (result.data === null) return false;

    // The selection is left alone on purpose: an undo reverses the last write,
    // which is not usually the selection the user is holding right now.
    return true;
  },

  refreshAttachments: async () => {
    const id = get().openTaskId;
    if (id === null) {
      set({ attachments: [] });
      return;
    }
    const result = await window.api.attachment.list(id);
    if (!result.ok) return;
    set({ attachments: result.data });
  },

  pickAttachments: async () => {
    const id = get().openTaskId;
    if (id === null) return;

    const result = await window.api.attachment.add(id);
    if (!result.ok) {
      set({ saveFailed: true });
      return;
    }
    // A cancelled picker answers with an empty list, and the re-read is what draws
    // whatever was stored, so both cases take the same path.
    await get().refreshAttachments();
  },

  removeAttachment: async (id) => {
    const result = await window.api.attachment.remove(id);
    if (!result.ok) {
      set({ saveFailed: true });
      return;
    }
    await get().refreshAttachments();
  },

  openAttachment: async (id) => {
    const result = await window.api.attachment.open(id);
    // A file that has been moved or deleted since it was attached is reported
    // rather than opened: the row is still a true record of what was attached.
    if (!result.ok) set({ saveFailed: true });
  },

  setBoot: (boot) => set({ boot }),
  setPanelState: (panelState) => set({ panelState }),
}));
