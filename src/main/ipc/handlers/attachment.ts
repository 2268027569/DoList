import { dialog, shell } from 'electron';

import { IPC } from '@shared/contracts/channels';
import { fail, ok } from '@shared/contracts/result';
import {
  attachmentAddInput,
  attachmentListInput,
  attachmentOpenInput,
  attachmentRemoveInput,
} from '@shared/contracts/task';

import {
  attachFiles,
  detachAttachment,
  listAttachments,
  readAttachment,
} from '../../services/attachments';
import { getPanelWindow } from '../../windows/panel';
import type { ChannelHandler } from './task';
import { invalid } from '../validate';

/**
 * Attachment channels (M02 S7).
 *
 * The OS things — the file picker and opening a file with its own handler — live
 * here rather than in the service, which keeps the service free of Electron and
 * testable. A path ever only travels *from* the picker *to* the database: the
 * renderer names a task and gets rows back, it can never hand over a path, which is
 * what stops a page from pointing the app at an arbitrary file.
 *
 * An attachment is not part of the task changed notification: it is not a task, the
 * panel re-reads the list it is showing rather than every attachment, and the detail
 * view re-reads its own attachments when it wants them.
 */
export function attachmentChannelHandlers(): ChannelHandler[] {
  return [
    {
      channel: IPC.attachment.list,
      run: (payload) => {
        const parsed = attachmentListInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.attachment.list, parsed.error.issues);
        return ok(listAttachments(parsed.data.taskId));
      },
    },
    {
      channel: IPC.attachment.add,
      run: async (payload) => {
        const parsed = attachmentAddInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.attachment.add, parsed.error.issues);

        const panel = getPanelWindow();
        // The panel is the parent when it exists, so the picker comes up over the
        // window the user is looking at instead of behind it.
        const picked =
          panel === null
            ? await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
            : await dialog.showOpenDialog(panel, { properties: ['openFile', 'multiSelections'] });
        // Cancelling a picker is a decision, not a failure: the panel stores nothing
        // and shows nothing, so it comes back as an empty list rather than an error.
        if (picked.canceled) return ok([]);

        return ok(attachFiles(parsed.data.taskId, picked.filePaths));
      },
    },
    {
      channel: IPC.attachment.remove,
      run: (payload) => {
        const parsed = attachmentRemoveInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.attachment.remove, parsed.error.issues);
        // Removing the row never removes the file: the app does not own it, and a
        // click in a task list is no place to delete a document.
        return ok({ removed: detachAttachment(parsed.data.id) });
      },
    },
    {
      channel: IPC.attachment.open,
      run: async (payload) => {
        const parsed = attachmentOpenInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.attachment.open, parsed.error.issues);

        const row = readAttachment(parsed.data.id);
        if (row === null) return fail('NOT_FOUND', `no attachment with id ${parsed.data.id}`);

        // `shell.openPath` answers with an empty string on success and with the
        // reason on failure, so a file that has been moved or deleted since it was
        // attached is reported to the panel rather than swallowed.
        const error = await shell.openPath(row.path);
        if (error !== '') return fail('INTERNAL', error);
        return ok(null);
      },
    },
  ];
}
