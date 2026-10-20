import { delimiter } from 'node:path';

import { dialog, nativeImage, shell } from 'electron';
import type { NativeImage } from 'electron';

import { IPC } from '@shared/contracts/channels';
import { fail, ok } from '@shared/contracts/result';
import {
  attachmentAddInput,
  attachmentListInput,
  attachmentOpenInput,
  attachmentRemoveInput,
  attachmentThumbnailInput,
} from '@shared/contracts/task';
import { isImageName } from '@shared/utils/attachment';

import { attachmentsDir } from '../../platform/paths';
import { isSmokeEnabled } from '../../platform/smoke';
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
 * Attachment channels (M02 S7, M03 S3).
 *
 * The OS things — the file picker, the platform thumbnailer, opening a file with its
 * own handler — live here rather than in the service, which keeps the service free of
 * Electron and testable. A path ever only travels *from* the picker *to* the app's
 * own directory: the renderer names a task and gets rows back, it can never hand over
 * a path, which is what stops a page from pointing the app at an arbitrary file.
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

        const picked = await pickedPaths();
        // Cancelling a picker is a decision, not a failure: the panel stores nothing
        // and shows nothing, so it comes back as an empty list rather than an error.
        if (picked === null) return ok([]);

        return ok(attachFiles(parsed.data.taskId, picked, attachmentsDir()));
      },
    },
    {
      channel: IPC.attachment.remove,
      run: (payload) => {
        const parsed = attachmentRemoveInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.attachment.remove, parsed.error.issues);
        // Removing the row removes the copy this app made, and only ever that: the
        // service refuses to unlink anything outside the attachments directory, so the
        // source file the user picked is never touched (S3).
        return ok({ removed: detachAttachment(parsed.data.id, attachmentsDir()) });
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
        // reason on failure, so a copy that is missing — the row's file was deleted
        // outside the app, or the profile was moved without its directory — is
        // reported to the panel rather than swallowed.
        const error = await shell.openPath(row.path);
        if (error !== '') return fail('INTERNAL', error);
        return ok(null);
      },
    },
    {
      channel: IPC.attachment.thumbnail,
      run: async (payload) => {
        const parsed = attachmentThumbnailInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.attachment.thumbnail, parsed.error.issues);

        const row = readAttachment(parsed.data.id);
        return ok(row === null ? null : await thumbnailOf(row.path));
      },
    },
  ];
}

/** The paths the user picked, or `null` when the picker was cancelled. */
async function pickedPaths(): Promise<string[] | null> {
  const override = smokeAttachPaths();
  // A native dialog cannot be clicked from a script. What the harness has to prove is
  // that a picked file is copied into the app's directory and comes back as a row
  // with a preview — not that Electron can show a dialog (see `smoke:tasks`).
  if (override !== null) return override;

  const panel = getPanelWindow();
  // The panel is the parent when it exists, so the picker comes up over the window
  // the user is looking at instead of behind it.
  const picked =
    panel === null
      ? await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
      : await dialog.showOpenDialog(panel, { properties: ['openFile', 'multiSelections'] });
  return picked.canceled ? null : picked.filePaths;
}

/**
 * The files the harness wants attached, or `null` in a real run.
 *
 * Several, separated by the platform's path separator, because a real pick can carry
 * several and the run has to prove both drawings — an image as a card, anything else
 * as a row.
 */
function smokeAttachPaths(): string[] | null {
  if (!isSmokeEnabled()) return null;
  const raw = process.env['YICHEN_SMOKE_ATTACH'];
  if (raw === undefined) return null;
  const paths = raw.split(delimiter).filter((path) => path.trim() !== '');
  return paths.length === 0 ? null : paths;
}

/**
 * A small preview of an image attachment, as a data URL, or `null`.
 *
 * The platform's own thumbnailer comes first — Windows' shell provider, macOS' Quick
 * Look — so no image decoder travels with the app. It answers with an empty image
 * when the provider it asked declined, which is what the second path is for: the file
 * decoded by Chromium itself. Between the two, an image that IS an image is previewed
 * wherever the user's machine has it; anything else decodes to nothing and answers
 * `null`, which is how the panel knows to draw the file row instead of a card.
 *
 * Only a file that reads as an image is asked for at all: handing a large unrelated
 * file to the shell's thumbnail provider is work with no answer at the end of it.
 */
async function thumbnailOf(path: string): Promise<string | null> {
  if (!isImageName(path)) return null;
  const image = (await thumbnailFromShell(path)) ?? decodedSmall(path);
  return image === null ? null : image.toDataURL();
}

/** The platform thumbnailer, or `null` when it declined or threw. */
async function thumbnailFromShell(path: string): Promise<NativeImage | null> {
  try {
    const image = await nativeImage.createThumbnailFromPath(path, { width: 128, height: 128 });
    return image.isEmpty() ? null : image;
  } catch {
    return null;
  }
}

/**
 * The file decoded by the app itself and scaled to the same width, for an image the
 * shell would not preview. The scale is what keeps a data URL — the whole preview
 * travels to the renderer as one string — from being megabytes.
 */
function decodedSmall(path: string): NativeImage | null {
  try {
    const image = nativeImage.createFromPath(path);
    if (image.isEmpty()) return null;

    const { width, height } = image.getSize();
    if (width <= 128) return image;
    return image.resize({ width: 128, height: Math.max(1, Math.round((height * 128) / width)) });
  } catch {
    return null;
  }
}
