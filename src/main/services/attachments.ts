import { copyFileSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

import type { Attachment } from '@shared/types/task';
import { newId } from '@shared/utils/id';

import {
  addAttachment,
  attachmentsOfTask,
  getAttachment,
  removeAttachment,
} from '../db/repositories/attachments';

/**
 * Attachments are *copies* (M03 S3): the picked file is copied into the app's own
 * attachments directory and the row stores the copy's path.
 *
 * The alternative — storing a reference to wherever the file happens to live — breaks
 * the moment the user tidies the folder they picked it from, and, worse, it does not
 * survive the folder-sync export (M10), which moves the app's directory and nothing
 * else. The copy is what makes an attachment travel with the task it hangs on.
 *
 * The directory is passed in rather than read from `platform/paths.ts`, because that
 * module imports `electron`: the rules here — what counts as a name, where a copy
 * goes, which path may be deleted — stay unit-testable against a real temporary
 * database. What the OS dialog did stays in the IPC handler, for the same reason.
 */

/**
 * Copies each picked file into `dir` and stores a row for the copy.
 *
 * The copy's name is a fresh id plus the source's extension, so two files called
 * `spec.pdf` picked in one turn cannot overwrite each other and the OS still opens
 * the copy with the right handler. The `name` shown in the row is the *source's*
 * basename, which is what the user recognises; path and size are read off the copy,
 * so what the row describes is what will actually open.
 *
 * A source that could not be copied is skipped rather than recorded: a row pointing
 * at a path that was never written would be a broken attachment from the moment it
 * was made. `dir` is created if it is not there yet.
 */
export function attachFiles(
  taskId: string,
  paths: readonly string[],
  dir: string,
  now: number = Date.now(),
): Attachment[] {
  mkdirSync(dir, { recursive: true });

  const added: Attachment[] = [];
  for (const source of paths) {
    const path = copyInto(source, dir, now);
    if (path === null) continue;
    added.push(addAttachment(taskId, { path, name: displayName(source), size: sizeOf(path) }, now));
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

/**
 * Removes the row and deletes the copy it points at.
 *
 * Only a path directly inside `dir` is unlinked. The row usually records a copy this
 * app made, but a row restored from an older profile or written by hand could name
 * anything, and a click in a task list is no place to delete a document the user
 * owns. The unlink is best-effort: a copy that is already gone is not a failure.
 */
export function detachAttachment(id: string, dir: string): boolean {
  const row = getAttachment(id);
  if (row === null) return false;

  const removed = removeAttachment(id);
  if (removed && isInside(dir, row.path)) {
    try {
      unlinkSync(row.path);
    } catch {
      // Already gone, or not ours to delete any more. The row was the point.
    }
  }
  return removed;
}

/**
 * Copies one file into `dir` and answers the copy's path, or `null` when the source
 * could not be read.
 */
function copyInto(source: string, dir: string, now: number): string | null {
  const target = join(dir, `${newId(now)}${extname(source)}`);
  try {
    copyFileSync(source, target);
    return target;
  } catch {
    return null;
  }
}

/** True when `path` is a file directly inside `dir` — never a directory above it. */
function isInside(dir: string, path: string): boolean {
  return dirname(resolve(path)) === resolve(dir);
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
