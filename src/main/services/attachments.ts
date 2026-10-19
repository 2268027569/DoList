import { statSync } from 'node:fs';
import { basename } from 'node:path';

import type { Attachment } from '@shared/types/task';

import {
  addAttachment,
  attachmentsOfTask,
  getAttachment,
  removeAttachment,
} from '../db/repositories/attachments';

/**
 * Attachments are *references* (M02 S7): the row stores where the file is, and the
 * file stays there. Copying it into the app's directory would duplicate files the
 * user already has and hand their bytes to folder sync (M10), which is the opposite
 * of what a link is for.
 *
 * What the OS dialog did stays in the IPC handler, so this module needs no Electron
 * import and the rules here — what counts as a name, what a missing file does — are
 * unit-testable against a real temporary database.
 */

/**
 * Stores a reference to each picked path.
 *
 * The name and size are read off the file rather than asked for: the user picked a
 * file, not a form. A file that vanished between the picker's answer and this call
 * is still recorded — the row is the note that it was attached, and the panel is
 * the place that reports it can no longer be opened.
 */
export function attachFiles(
  taskId: string,
  paths: readonly string[],
  now: number = Date.now(),
): Attachment[] {
  const added: Attachment[] = [];
  for (const path of paths) {
    added.push(addAttachment(taskId, { path, name: displayName(path), size: sizeOf(path) }, now));
  }
  return added;
}

export function listAttachments(taskId: string): Attachment[] {
  return attachmentsOfTask(taskId);
}

/** One row by id, or `null` when it is unknown — what opening a file resolves. */
export function readAttachment(id: string): Attachment | null {
  return getAttachment(id);
}

/** True when a row was removed; false means the id was already gone. */
export function detachAttachment(id: string): boolean {
  return removeAttachment(id);
}

/** The file's own name. The panel falls back to the last path segment if it is null. */
function displayName(path: string): string {
  const name = basename(path);
  return name === '' ? path : name;
}

/** The size to show, or `null` when the file cannot be measured. */
function sizeOf(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}
