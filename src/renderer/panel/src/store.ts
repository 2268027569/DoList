import { create } from 'zustand';

import type { TaskBulkOp, TaskQueryInput } from '@shared/contracts/task';
import { isArchiveView } from '@shared/types/app';
import type { BootParams, PanelState, PanelView } from '@shared/types/app';
import type { ReorderScope, TaskListItem, TaskStatus } from '@shared/types/task';
import { localDayBounds } from '@shared/utils/day';
import { moveWithin } from '@shared/utils/sort-order';

/**
 * The Inbox: top-level tasks that are still open and belong to no list
 * (`list_id = NULL`, docs/ARCHITECTURE.md §5.2). It is also the base of every dated
 * view — those are the Inbox with a window over `due_at` — and of the two archives,
 * which keep the same "unfiled, top level" scope and swap the status.
 */
const INBOX_FILTER: TaskQueryInput = { listId: null, parentId: null, status: ['todo', 'doing'] };

/** The group the list's manual order lives in, which is also what a move rewrites. */
const INBOX_SCOPE: ReorderScope = { kind: 'top', listId: null };

/**
 * What an open view draws: the unfinished rows, plus the ones finished today.
 *
 * A ticked row stays in the list — struck through, still numbered — because the tick
 * should read as "done", not as "gone": sending it to the archive on the same frame
 * makes the row look deleted, and the day's work is worth seeing once it is finished.
 * The boundary is the local day, so yesterday's completions are the archive's alone;
 * `sort: 'active'` keeps the finished rows below the open ones.
 */
const ACTIVE_STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];

function openView(filter: TaskQueryInput = {}): TaskQueryInput {
  return {
    ...INBOX_FILTER,
    ...filter,
    status: ACTIVE_STATUSES,
    completedFrom: localDayBounds(Date.now()).start,
    sort: 'active',
  };
}

/**
 * Local midnight `offset` days from today. Built from the date parts rather than by
 * adding 24 hours, so a day that is not that long (a DST transition) still lands on
 * a midnight — the same reason `localDayBounds` rebuilds instead of adding (§5.1).
 */
function dayStart(offset: number): number {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime();
}

/**
 * The filter one view stands for (`setView` / `refreshTasks`, docs/M03-PLAN.md D3).
 *
 * Six views, one query: showing another view is re-reading the same table through a
 * different filter, never a second copy of the rows (ARCHITECTURE §5.1).
 */
function filterFor(view: PanelView): TaskQueryInput {
  // 明天 is where both dated views start: 明天 is that one day, 即将到期 the seven days
  // from there. Resolved from the same clock the views themselves are.
  const tomorrow = localDayBounds(dayStart(1));

  switch (view) {
    case 'inbox':
      return openView();

    // 今日 is "due by the end of the local day", overdue included: the repository's
    // window over `due_at` is half-open, and its open end is exactly that. A task
    // with no due date is not due today, so it stays in the Inbox rather than being
    // pulled in to make the view look fuller.
    case 'today':
      return openView({ dueTo: localDayBounds(Date.now()).end });

    // 明天 is a closed day (`dueFrom` 明天零点, `dueTo` 明天末尾), so overdue rows stay
    // out of it: they are today's business, and 今日 is where the overdue chip lives.
    case 'tomorrow':
      return openView({ dueFrom: tomorrow.start, dueTo: tomorrow.end });

    // 即将到期 is tomorrow through the seventh day, today excluded — today has a view
    // of its own, and a list that repeated it would be the same list twice.
    case 'upcoming':
      return openView({ dueFrom: tomorrow.start, dueTo: localDayBounds(dayStart(7)).end });

    // The archives. 已完成 reads newest first: `sort_order` is the order the open rows
    // were dragged into, which says nothing about when they were finished (D4).
    case 'completed':
      return { ...INBOX_FILTER, status: ['done'], sort: 'completed' };

    case 'cancelled':
      return { ...INBOX_FILTER, status: ['cancelled'] };
  }
}

/**
 * The `dueAt` a task gets when it is added from a view's quick-add (M03 D6), as a day
 * rather than an instant — the same shape the detail's 今天 preset writes (S4).
 *
 * The rule is "a view with a definite date supplies it": the view *is* the filter, so
 * a task stored without a date would be written and then not drawn, which is the
 * opposite of what "add to 明天" means. A view with no date of its own leaves the
 * field alone.
 */
function defaultDueAt(view: PanelView): number | null {
  if (view === 'today') return dayStart(0);
  // 明天 and 即将到期 both start at tomorrow, so that is the day a row added from
  // either one belongs to — and the first day either view would draw it in.
  if (view === 'tomorrow' || view === 'upcoming') return dayStart(1);
  return null;
}

export type TasksStatus = 'loading' | 'ready' | 'error';

interface PanelStore {
  boot: BootParams;
  panelState: PanelState;

  /**
   * Which slice of the tasks the list is showing (M03 S1). Six views, and the panel
   * owns the choice: the app menu's 今日 item asks for it over `event:panel-view`,
   * and the sidebar sets it directly, both landing on this one field. There is one
   * entrance per view, on purpose — two controls writing one state leave the user
   * unable to tell which of them is showing the truth.
   */
  view: PanelView;

  /**
   * The view's query result. It is re-fetched rather than patched in place: the
   * main process owns the rows, and a second copy kept here would drift from it
   * (M02 D4).
   */
  tasks: TaskListItem[];
  tasksStatus: TasksStatus;

  /**
   * The rows the user multi-selected in the list (M02 S7). Ids rather than rows:
   * the list is re-fetched wholesale after every write, so a row object held here
   * would be a stale copy of a row that is drawn from somewhere else.
   */
  selectedIds: string[];

  /** Re-runs the current view's query. Driven by `event:task-changed`, not the writer. */
  refreshTasks: () => Promise<void>;
  /** Shows another view and re-reads it. Re-reading is part of showing it. */
  setView: (view: PanelView) => Promise<void>;
  /** Stores a new Inbox task; resolves to `false` when nothing was written. */
  addTask: (title: string) => Promise<boolean>;
  /** Ticks a task done, or puts it back to `todo`. */
  toggleTask: (id: string, done: boolean) => Promise<void>;
  /**
   * Moves a row to `to` inside the Inbox group, writing the group's order back
   * (M02 D3). Resolves to `false` when there was nothing to move.
   */
  moveTask: (id: string, to: number) => Promise<boolean>;

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

  setBoot: (boot: BootParams) => void;
  setPanelState: (state: PanelState) => void;
}

/**
 * The panel store stays deliberately small: view state and repository data live in
 * separate fields, so a re-render driven by one never implies the other
 * (docs/ARCHITECTURE.md §7).
 *
 * It no longer holds the open task (M02 D6): the detail is a window of its own with a
 * renderer of its own, so one row, its checklist and its attachments are that window's
 * state rather than this one's. What is left here is the list and the few commands that
 * write to it.
 */
export const usePanelStore = create<PanelStore>((set, get) => ({
  boot: { mode: 'light', theme: 'minimal', locale: 'en' },
  panelState: 'hidden',
  view: 'inbox',

  tasks: [],
  tasksStatus: 'loading',
  selectedIds: [],

  refreshTasks: async () => {
    const result = await window.api.task.query(filterFor(get().view));
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

  setView: async (view) => {
    if (get().view === view) return;
    // The rows on screen belong to the other view's filter, so they are dropped
    // before the read rather than drawn against it: a list showing the old rows
    // under the new view's heading is a lie for as long as the query takes.
    set({ view, tasks: [], tasksStatus: 'loading' });
    await get().refreshTasks();
  },

  addTask: async (title) => {
    // An archive is not a place to write. The panel hides the quick-add there (D6),
    // so this is the write path refusing the one thing a "completed" list must not
    // do: store a task that is neither completed nor anywhere the user was looking.
    const view = get().view;
    if (isArchiveView(view)) return false;

    // Taken into a dated view, a task with no due date would be stored and then not
    // drawn — the view is the filter, and "add to 明天" is what the user asked for.
    // So the view supplies the due date, as a day rather than an instant (S4).
    const result = await window.api.task.create({
      title,
      dueAt: defaultDueAt(view),
      dueHasTime: false,
    });
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
    // Only the open rows are ordered. A row finished today is pinned below them by
    // the view's own sort (`active`, filterFor), and it has no grip — moving it would
    // be moving something the user cannot pick up.
    const open = current.filter((task) => task.status !== 'done');
    const from = open.findIndex((task) => task.id === id);
    if (from < 0) return false;

    const ids = open.map((task) => task.id);
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

  setBoot: (boot) => set({ boot }),
  setPanelState: (panelState) => set({ panelState }),
}));
