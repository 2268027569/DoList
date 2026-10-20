import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { withTempDatabase } from '../db/test-db';
import { addAttachment } from '../db/repositories/attachments';
import { createTask } from '../db/repositories/tasks';
import {
  attachFiles,
  detachAttachment,
  listAttachments,
  readAttachment,
} from './attachments';

const NOW = new Date(2026, 4, 12, 10, 0, 0).getTime();

/** Directories written for one test, removed afterwards so the run leaves nothing behind. */
const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A directory that stands in for the profile the app keeps its attachments in. */
function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function writeFile(name: string, contents: string): string {
  const path = join(scratchDir('yichen-source-'), name);
  writeFileSync(path, contents);
  return path;
}

describe('attachFiles', () => {
  it('copies the picked file into the app directory and records the copy', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const dir = scratchDir('yichen-attach-');
      const source = writeFile('spec.pdf', 'x'.repeat(2_048));

      const added = attachFiles(task.id, [source], dir, NOW);

      // The dialog hands over a path; the name shown in the row is the source's, so
      // the user recognises what they picked, while the path and size describe the
      // copy — the file the row will actually open (S3).
      expect(added).toHaveLength(1);
      expect(added[0]?.name).toBe('spec.pdf');
      expect(added[0]?.size).toBe(2_048);
      expect(added[0]?.path).not.toBe(source);
      expect(added[0]?.path.startsWith(dir)).toBe(true);
      expect(added[0]?.path.endsWith('.pdf')).toBe(true);
      expect(readdirSync(dir)).toEqual([added[0]?.path.split(/[\\/]/).pop()]);
      expect(listAttachments(task.id)).toEqual(added);
    });
  });

  it('skips a file it could not copy rather than recording a path that is not there', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const dir = scratchDir('yichen-attach-');

      // A row pointing at a copy that was never written would be a broken attachment
      // from the moment it was made, which is worse than the missing row it becomes.
      const added = attachFiles(task.id, [join(dir, 'nowhere', 'gone.txt')], dir, NOW);

      expect(added).toEqual([]);
      expect(listAttachments(task.id)).toEqual([]);
    });
  });

  it('copies several files in one call, in the order they were picked', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const dir = scratchDir('yichen-attach-');
      const first = writeFile('a.txt', 'a');
      const second = writeFile('b.txt', 'bb');

      const added = attachFiles(task.id, [first, second], dir, NOW);

      // Two files called the same thing picked in one turn cannot overwrite each
      // other: the copy is named from a fresh id.
      expect(added.map((row) => row.name)).toEqual(['a.txt', 'b.txt']);
      expect(new Set(added.map((row) => row.path)).size).toBe(2);
    });
  });

  it('names two copies of the same file apart, so neither replaces the other', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const dir = scratchDir('yichen-attach-');
      const source = writeFile('photo.png', 'bytes');

      const first = attachFiles(task.id, [source], dir, NOW);
      const second = attachFiles(task.id, [source], dir, NOW);

      expect(first[0]?.name).toBe('photo.png');
      expect(second[0]?.name).toBe('photo.png');
      expect(second[0]?.path).not.toBe(first[0]?.path);
      expect(existsSync(first[0]?.path ?? '')).toBe(true);
      expect(listAttachments(task.id)).toHaveLength(2);
    });
  });
});

describe('attachments of one task', () => {
  it('removes the row and the copy it points at, and reports whether there was one', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const dir = scratchDir('yichen-attach-');
      const [row] = attachFiles(task.id, [writeFile('keep.txt', 'contents')], dir, NOW);
      const copy = row?.path ?? '';

      expect(existsSync(copy)).toBe(true);
      expect(detachAttachment(row?.id ?? '', dir)).toBe(true);
      expect(listAttachments(task.id)).toEqual([]);
      // The copy is the app's own file, so removing the attachment removes it; the
      // source the user picked is theirs and is never touched.
      expect(existsSync(copy)).toBe(false);
      expect(detachAttachment('nope', dir)).toBe(false);
    });
  });

  it('deletes only a file inside the attachments directory', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const dir = scratchDir('yichen-attach-');
      // A row restored from an older profile, or written by hand, could name anything.
      // Nobody clicked "remove" on a document the user owns (S3).
      const outside = writeFile('keep-me.txt', 'contents');
      const row = addAttachment(task.id, { path: outside, name: 'keep-me.txt' }, NOW);

      expect(detachAttachment(row.id, dir)).toBe(true);
      expect(existsSync(outside)).toBe(true);
    });
  });

  it('reads one row by id, which is what opening a file resolves', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const dir = scratchDir('yichen-attach-');
      const [row] = attachFiles(task.id, [writeFile('a.txt', 'a')], dir, NOW);

      expect(readAttachment(row?.id ?? '')?.path).toBe(row?.path);
      expect(readAttachment('nope')).toBeNull();
    });
  });
});
