import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import { IPC } from '@shared/contracts/channels';
import type {
  MarkerAnchorPayload,
  MarkerStatePayload,
  PanelStatePayload,
  PanelViewPayload,
} from '@shared/contracts/channels';
import type {
  TaskBulkInput,
  TaskCreateInput,
  TaskChangedPayload,
  TaskPatchInput,
  TaskQueryInput,
  TaskUndoResult,
} from '@shared/contracts/task';
import type { ReminderDuePayload, TaskFocusPayload } from '@shared/contracts/reminder';
import type { AppSettings } from '@shared/contracts/settings';
import type { BootParams, MarkerAnchor } from '@shared/types/app';
import type { Attachment, ReorderScope, TaskListItem, TaskWithTags } from '@shared/types/task';
import type { IpcResult } from '@shared/types/ipc';

/**
 * The renderer surface is an explicit allow-list (docs/ARCHITECTURE.md §6.5):
 * no `ipcRenderer` object, no channel strings, no listeners for channels the
 * renderer has no business reading.
 */
function invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<T>>;
}

const api = {
  window: {
    expand: () => invoke<unknown>(IPC.window.expand),
    collapse: () => invoke<unknown>(IPC.window.collapse),
    collapseFinished: () => invoke<null>(IPC.window.collapseFinished),
    resize: (size: { width: number; height: number }) =>
      invoke<{ width: number; height: number }>(IPC.window.resize, size),
  },
  marker: {
    dragStart: (grab: { grabX: number; grabY: number }) =>
      invoke<null>(IPC.marker.dragStart, grab),
    dragTick: () => invoke<null>(IPC.marker.dragTick),
    dragEnd: () => invoke<MarkerAnchor | null>(IPC.marker.dragEnd),
    setAnchor: (anchor: MarkerAnchor) => invoke<MarkerAnchor>(IPC.marker.setAnchor, anchor),
    /**
     * Opens the app menu on the main side (right-click). The renderer sends the
     * request and nothing else: the menu's labels and its actions both live in the
     * main process (§6.5, M02 S8).
     */
    contextMenu: () => invoke<null>(IPC.marker.contextMenu),
  },
  settings: {
    get: (key: string) => invoke<AppSettings | string | number | null>(IPC.settings.get, { key }),
    set: (patch: Partial<AppSettings>) => invoke<AppSettings>(IPC.settings.set, patch),
  },
  task: {
    /**
     * Filter fields mirror `TaskFilter`; the main process clamps the row window.
     * Each row comes back with its tags and its subtask tally, both of which the
     * list draws (M02 S6), so a render is one round trip.
     */
    query: (filter: TaskQueryInput = {}) => invoke<TaskListItem[]>(IPC.task.query, filter),
    /** One row by id: the open detail view's own read (M02 S4). */
    get: (id: string) => invoke<TaskWithTags | null>(IPC.task.get, { id }),
    create: (input: TaskCreateInput) => invoke<TaskWithTags>(IPC.task.create, input),
    update: (id: string, patch: TaskPatchInput) =>
      invoke<TaskWithTags>(IPC.task.update, { id, patch }),
    /** Soft delete — the rows go to the recycle bin and `restore` brings them back. */
    delete: (ids: string[]) => invoke<{ affected: number }>(IPC.task.delete, { ids }),
    restore: (ids: string[]) => invoke<{ affected: number }>(IPC.task.restore, { ids }),
    reorder: (scope: ReorderScope, ids: string[]) =>
      invoke<{ affected: number }>(IPC.task.reorder, { scope, ids }),
    /** One command, many rows — one write, one notification, one undo entry (S7). */
    bulk: (ids: string[], op: TaskBulkInput['op']) =>
      invoke<{ affected: number }>(IPC.task.bulk, { ids, op }),
    /**
     * Take the newest write back. `null` means the stack was empty, which the panel
     * shows nothing for: pressing the shortcut one time too many is not an error.
     */
    undo: () => invoke<TaskUndoResult | null>(IPC.task.undo),
  },
  attachment: {
    /** The copies hung on one task, in the order they were added. */
    list: (taskId: string) => invoke<Attachment[]>(IPC.attachment.list, { taskId }),
    /**
     * Opens the OS file picker on the main side and copies what it returned into the
     * app's own directory. The renderer never sends a path: it asks for a pick, and
     * gets rows back (S7).
     */
    add: (taskId: string) => invoke<Attachment[]>(IPC.attachment.add, { taskId }),
    /** Removing the row deletes the copy the app made, and only ever that one. */
    remove: (id: string) => invoke<{ removed: boolean }>(IPC.attachment.remove, { id }),
    open: (id: string) => invoke<null>(IPC.attachment.open, { id }),
    /** An image's preview as a data URL, or `null` when it has none (M03 S3). */
    thumbnail: (id: string) => invoke<string | null>(IPC.attachment.thumbnail, { id }),
  },
  reminder: {
    /**
     * The user answered a reminder card (M04). The instance's state is the main
     * process's to keep, and whether the card was put away is the one fact about it the
     * renderer knows and the main process cannot see for itself.
     */
    dismiss: (id: string) => invoke<{ dismissed: boolean }>(IPC.reminder.dismiss, { id }),
  },
  i18n: {
    setLocale: (locale: string) => invoke<string>(IPC.i18n.setLocale, { locale }),
  },
  app: {
    quit: () => invoke<null>(IPC.app.quit),
  },
  smoke: {
    report: (type: string, detail?: Record<string, unknown>) =>
      invoke<null>(IPC.smoke.report, { type, detail }),
  },
  on: {
    panelState: (listener: (payload: PanelStatePayload) => void) =>
      subscribe(IPC.event.panelState, listener),
    themeChanged: (listener: (payload: BootParams) => void) =>
      subscribe(IPC.event.themeChanged, listener),
    localeChanged: (listener: (payload: { locale: string }) => void) =>
      subscribe(IPC.event.localeChanged, listener),
    markerAnchorChanged: (listener: (payload: MarkerAnchorPayload) => void) =>
      subscribe(IPC.event.markerAnchorChanged, listener),
    markerState: (listener: (payload: MarkerStatePayload) => void) =>
      subscribe(IPC.event.markerState, listener),
    /**
     * A task write happened; the payload says what and which ids, never the rows
     * (M02 D4). The panel re-fetches whatever query it has open.
     */
    taskChanged: (listener: (payload: TaskChangedPayload) => void) =>
      subscribe(IPC.event.taskChanged, listener),
    /** The quick-add shortcut opened the panel: take the caret in its field. */
    quickAddFocus: (listener: () => void) => subscribe(IPC.event.quickAddFocus, listener),
    /** The app menu asked for a view; the panel owns that state (M02 S8). */
    panelView: (listener: (payload: PanelViewPayload) => void) =>
      subscribe(IPC.event.panelView, listener),
    /**
     * A reminder's card is due: the OS notification for the same instance went
     * unanswered, and this is the surface that takes over (M04). The payload carries
     * what the card draws, so the panel does not have to read the reminder back.
     */
    reminderDue: (listener: (payload: ReminderDuePayload) => void) =>
      subscribe(IPC.event.reminderDue, listener),
    /** Open this task — sent when a reminder toast was clicked (M04). */
    taskFocus: (listener: (payload: TaskFocusPayload) => void) =>
      subscribe(IPC.event.taskFocus, listener),
  },
} as const;

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

export type RendererApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
