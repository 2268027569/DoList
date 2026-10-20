import { create } from 'zustand';

import type { TaskPatchInput, TaskQueryInput } from '@shared/contracts/task';
import type { Attachment, TaskWithTags } from '@shared/types/task';
import { isImageName } from '@shared/utils/attachment';

/**
 * The detail window's store (docs/FEATURES.md M02 D6).
 *
 * It is the panel's detail slice moved into a window of its own, because a BrowserWindow
 * is a renderer of its own: there is no shared memory between the two, so each keeps
 * only the reads it draws. This one holds one row, its checklist and its attachments —
 * everything the form is made of — and nothing about the list, the view, the selection
 * or the undo stack, all of which stay where the list is.
 *
 * Saving is the same discipline as before (M02 D9): one field, one write, and the row is
 * re-read from the announcement rather than patched here (M02 D4).
 */

/**
 * The checklist under a parent. Every status, because a parent's steps are where its
 * finished ones belong too — unlike the list, which is a list of what is still to be done.
 */
const SUBTASK_FILTER: Omit<TaskQueryInput, 'parentId'> = { status: ['todo', 'doing', 'done'] };

interface DetailStore {
  taskId: string | null;
  /** The row being edited. `null` while it loads, or once it has been deleted. */
  task: TaskWithTags | null;
  subtasks: TaskWithTags[];
  attachments: Attachment[];
  /** Image previews by attachment id; a missing id is "no preview for this one". */
  thumbnails: Record<string, string>;
  /** True after a write came back rejected, so the header can say so. */
  saveFailed: boolean;

  /** Points this window at one task and reads everything the form draws. */
  open: (id: string) => Promise<void>;
  /** Re-reads the row and its checklist after a write announced itself. */
  refresh: () => Promise<void>;
  /** Reads one field's new value in, or closes when the row is gone. */
  save: (patch: TaskPatchInput) => Promise<boolean>;
  /** Soft-deletes the task and puts the window away — there is nothing left to edit. */
  remove: () => Promise<void>;

  refreshSubtasks: () => Promise<void>;
  /** Adds a subtask to this task; resolves to `false` when nothing was written. */
  addSubtask: (title: string) => Promise<boolean>;
  removeSubtask: (id: string) => Promise<void>;

  refreshAttachments: () => Promise<void>;
  /** Opens the OS file picker and copies whatever the user chose into the app. */
  pickAttachments: () => Promise<void>;
  removeAttachment: (id: string) => Promise<void>;
  openAttachment: (id: string) => Promise<void>;
}

export const useDetailStore = create<DetailStore>((set, get) => ({
  taskId: null,
  task: null,
  subtasks: [],
  attachments: [],
  thumbnails: {},
  saveFailed: false,

  open: async (id) => {
    set({ taskId: id, task: null, subtasks: [], attachments: [], thumbnails: {}, saveFailed: false });

    const result = await window.api.task.get(id);
    // Another row was picked while this read was in flight; its own read is the answer
    // now, so this one is dropped rather than allowed to land on the newer task.
    if (get().taskId !== id) return;
    if (!result.ok) {
      set({ saveFailed: true });
      return;
    }
    // The row can have been deleted from another surface — a reminder popup, the list's
    // own delete — before this window finished opening. There is nothing to edit, so
    // the window closes rather than drawing an empty form.
    if (result.data === null) {
      closeWindow();
      return;
    }
    set({ task: result.data });
    // The checklist and the attachments are below the fold and independent of each
    // other, so they are read side by side rather than one after the other: the form is
    // already drawn from the row above, and the two reads only fill in what follows.
    await Promise.all([get().refreshSubtasks(), get().refreshAttachments()]);
  },

  refresh: async () => {
    const id = get().taskId;
    if (id === null) return;

    const result = await window.api.task.get(id);
    if (!result.ok) return;
    if (result.data === null) {
      closeWindow();
      return;
    }
    set({ task: result.data });
    // The checklist is read again too: ticking a subtask from this window changes it,
    // and so does anything that happened elsewhere while it was open.
    await get().refreshSubtasks();
  },

  save: async (patch) => {
    const id = get().taskId;
    if (id === null) return false;

    const result = await window.api.task.update(id, patch);
    set({ saveFailed: !result.ok });
    // On success the row comes back through `event:task-changed` and `refresh`, so one
    // write is still one read (M02 D4).
    return result.ok;
  },

  remove: async () => {
    const id = get().taskId;
    if (id === null) return;

    const result = await window.api.task.delete([id]);
    if (!result.ok) {
      set({ saveFailed: true });
      return;
    }
    // Deletion is a soft delete, so the row still exists and the list's undo can bring
    // it back — but this window has nothing left to show, so it goes.
    set({ task: null, taskId: null, subtasks: [], attachments: [], thumbnails: {} });
    closeWindow();
  },

  refreshSubtasks: async () => {
    const id = get().taskId;
    if (id === null) return;

    const result = await window.api.task.query({ ...SUBTASK_FILTER, parentId: id });
    if (!result.ok) return;
    if (get().taskId !== id) return;
    // The query returns rows without their tags; the checklist does not draw any, and
    // asking for them would be a second read on every subtask write.
    set({ subtasks: result.data.map((task) => ({ ...task, tags: [] })) });
  },

  addSubtask: async (title) => {
    const parentId = get().taskId;
    // Empty is not a subtask, and the field keeps whatever whitespace the user typed —
    // the same rule the list's quick-add applies (M02 S3).
    if (parentId === null || title.trim() === '') return false;

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

  refreshAttachments: async () => {
    const id = get().taskId;
    if (id === null) {
      set({ attachments: [], thumbnails: {} });
      return;
    }
    const result = await window.api.attachment.list(id);
    if (!result.ok) return;
    if (get().taskId !== id) return;
    // Rows first, previews second: a non-image never needs one, and a preview is the
    // only large payload of the two, so the row list stays as cheap as it was (M03 S3).
    const rows = result.data;
    set({ attachments: rows, thumbnails: {} });
    // Drawn as soon as the rows are known; the previews arrive a moment later and are
    // one more set rather than a condition of the list appearing.
    const thumbnails = await readThumbnails(rows);
    if (get().taskId !== id) return;
    set({ thumbnails });
  },

  pickAttachments: async () => {
    const id = get().taskId;
    if (id === null) return;

    const result = await window.api.attachment.add(id);
    if (!result.ok) {
      set({ saveFailed: true });
      return;
    }
    // A cancelled picker answers with an empty list, and the re-read is what draws
    // whatever was copied, so both cases take the same path.
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
    // A file that has been moved or deleted since it was attached is reported rather
    // than opened: the row is still a true record of what was attached.
    if (!result.ok) set({ saveFailed: true });
  },
}));

/** Asks the main process to put this window away. */
function closeWindow(): void {
  void window.api.detail.close();
}

/**
 * The previews for whichever of `rows` are images (M03 S3).
 *
 * Asked for in one pass and stored as one map, so the form re-renders once rather than
 * once per image. A row whose preview does not come back — the file is gone, or the
 * platform has no thumbnail provider for it — is left out of the map, which is exactly
 * how the view learns to draw a file row for it instead of an empty card.
 */
async function readThumbnails(rows: readonly Attachment[]): Promise<Record<string, string>> {
  const images = rows.filter((row) => isImageName(row.name ?? row.path));
  const entries = await Promise.all(
    images.map(async (row): Promise<[string, string] | null> => {
      const result = await window.api.attachment.thumbnail(row.id);
      return result.ok && result.data !== null ? [row.id, result.data] : null;
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}
