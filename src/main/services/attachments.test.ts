import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { withTempDatabase } from '../db/test-db';
import { createTask } from '../db/repositories/tasks';
import {
  attachFiles,
  detachAttachment,
  listAttachments,
  readAttachment,
} from './attachments';

const NOW = new Date(2026, 4, 12, 10, 0, 0).getTime();

/** Files written for one test, removed afterwards so the run leaves nothing behind. */
const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'yichen-attach-'));
  scratch.push(dir);
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe('attachFiles', () => {
  it('reads the name and the size off the file the user picked', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const path = writeFile('spec.pdf', 'x'.repeat(2_048));

      const added = attachFiles(task.id, [path], NOW);

      // The dialog hands over a path; the name and the size shown in the row are
      // measured here rather than asked of the user, who picked a file, not a form.
      expect(added).toHaveLength(1);
      expect(added[0]?.name).toBe('spec.pdf');
      expect(added[0]?.size).toBe(2_048);
      expect(added[0]?.path).toBe(path);
      expect(listAttachments(task.id)).toEqual(added);
    });
  });

  it('still records a file that vanished before it could be measured', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);

      // The row is the note that the file *was* attached; a size of `null` is how
      // the panel learns it cannot say anything about it.
      const added = attachFiles(task.id, ['C:\\gone\\nowhere.txt'], NOW);

      expect(added[0]?.name).toBe('nowhere.txt');
      expect(added[0]?.size).toBeNull();
    });
  });

  it('attaches several files in one call, in the order they were picked', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const first = writeFile('a.txt', 'a');
      const second = writeFile('b.txt', 'bb');

      const added = attachFiles(task.id, [first, second], NOW);

      expect(added.map((row) => row.name)).toEqual(['a.txt', 'b.txt']);
    });
  });
});

describe('attachments of one task', () => {
  it('removes the row without touching the file, and reports whether there was one', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const path = writeFile('keep.txt', 'contents');
      const [row] = attachFiles(task.id, [path], NOW);

      expect(detachAttachment(row?.id ?? '')).toBe(true);
      expect(listAttachments(task.id)).toEqual([]);
      // The file is still where it was: the app never owns it, and a click in a task
      // list is no place to delete a document.
      expect(existsSync(path)).toBe(true);
      expect(detachAttachment('nope')).toBe(false);
    });
  });

  it('reads one row by id, which is what opening a file resolves', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const [row] = attachFiles(task.id, [writeFile('a.txt', 'a')], NOW);

      expect(readAttachment(row?.id ?? '')?.path).toBe(row?.path);
      expect(readAttachment('nope')).toBeNull();
    });
  });
});
