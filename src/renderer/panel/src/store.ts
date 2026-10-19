import { create } from 'zustand';

import type { TaskPatchInput, TaskQueryInput } from '@shared/contracts/task';
import type { BootParams, PanelState } from '@shared/types/app';
import type { TaskWithTags } from '@shared/types/task';

/**
 * The Inbox: top-level tasks that are still open and belong to no list
 * (`list_id = NULL`, docs/ARCHITECTURE.md §5.2). The panel offers nothing else
 * yet — views with their own filters are M03.
 */
const INBOX_FILTER: TaskQueryInput = { listId: null, parentId: null, status: ['todo', 'doing'] };

export type TasksStatus = 'loading' | 'ready' | 'error';

interface PanelStore {
  boot: BootParams;
  panelState: PanelState;

  /**
   * The Inbox query result. It is re-fetched rather than patched in place: the
   * main process owns the rows, and a second copy kept here would drift from it
   * (M02 D4).
   */
  tasks: TaskWithTags[];
  tasksStatus: TasksStatus;

  /**
   * The open detail view's row (M02 S4). It is the panel's second read, and it is
   * a single row by id rather than the Inbox page: a task marked done would fall
   * out of the Inbox filter, and the screen being edited on would empty itself.
   */
  openTaskId: string | null;
  openTask: TaskWithTags | null;

  /** True after a write came back rejected, so the detail can say so. */
  saveFailed: boolean;

  /** Re-runs the Inbox query. Driven by `event:task-changed`, not by the writer. */
  refreshTasks: () => Promise<void>;
  /** Stores a new Inbox task; resolves to `false` when nothing was written. */
  addTask: (title: string) => Promise<boolean>;
  /** Ticks a task done, or puts it back to `todo`. */
  toggleTask: (id: string, done: boolean) => Promise<void>;

  /** Opens the detail on `id` and reads its row. */
  openTaskDetail: (id: string) => Promise<void>;
  /** Leaves the detail and goes back to the list. */
  closeTaskDetail: () => void;
  /** Re-reads the open row after a write announced itself. */
  refreshOpenTask: () => Promise<void>;
  /** Saves one field of the open task (M02 D9: there is no save button). */
  saveOpenTask: (patch: TaskPatchInput) => Promise<boolean>;
  /** Soft-deletes the open task and returns to the list. */
  deleteOpenTask: () => Promise<void>;

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
  saveFailed: false,

  refreshTasks: async () => {
    const result = await window.api.task.query(INBOX_FILTER);
    if (!result.ok) {
      set({ tasksStatus: 'error' });
      return;
    }
    set({ tasks: result.data, tasksStatus: 'ready' });
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

  openTaskDetail: async (id) => {
    set({ openTaskId: id, openTask: null, saveFailed: false });
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
  },

  closeTaskDetail: () => set({ openTaskId: null, openTask: null, saveFailed: false }),

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
    set({ openTaskId: null, openTask: null, saveFailed: false });
  },

  setBoot: (boot) => set({ boot }),
  setPanelState: (panelState) => set({ panelState }),
}));
