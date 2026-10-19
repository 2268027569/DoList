import { create } from 'zustand';

import type { TaskQueryInput } from '@shared/contracts/task';
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

  /** Re-runs the Inbox query. Driven by `event:task-changed`, not by the writer. */
  refreshTasks: () => Promise<void>;
  /** Stores a new Inbox task; resolves to `false` when nothing was written. */
  addTask: (title: string) => Promise<boolean>;
  /** Ticks a task done, or puts it back to `todo`. */
  toggleTask: (id: string, done: boolean) => Promise<void>;

  setBoot: (boot: BootParams) => void;
  setPanelState: (state: PanelState) => void;
}

/**
 * The panel store stays deliberately small: view state and repository data live in
 * separate fields, so a re-render driven by one never implies the other
 * (docs/ARCHITECTURE.md §7). The task fields are the M02 slice.
 */
export const usePanelStore = create<PanelStore>((set) => ({
  boot: { mode: 'light', theme: 'minimal', locale: 'en' },
  panelState: 'hidden',

  tasks: [],
  tasksStatus: 'loading',

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

  setBoot: (boot) => set({ boot }),
  setPanelState: (panelState) => set({ panelState }),
}));
