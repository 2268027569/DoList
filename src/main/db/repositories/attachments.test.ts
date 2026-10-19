import { describe, expect, it } from 'vitest';

import { withTempDatabase } from '../test-db';
import { addAttachment, attachmentsOfTask, removeAttachment } from './attachments';
import { createTask } from './tasks';

const NOW = new Date(2026, 4, 12, 10, 0, 0).getTime();

describe('addAttachment', () => {
  it('stores a reference to the file, not a copy of it', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const attachment = addAttachment(
        task.id,
        { path: 'C:\\docs\\spec.pdf', name: 'spec.pdf', size: 4_096 },
        NOW,
      );

      expect(attachment).toMatchObject({
        taskId: task.id,
        path: 'C:\\docs\\spec.pdf',
        name: 'spec.pdf',
        size: 4_096,
        createdAt: NOW,
      });
      expect(attachmentsOfTask(task.id)).toEqual([attachment]);
    });
  });

  it('leaves name and size null when the caller omits them', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const attachment = addAttachment(task.id, { path: 'notes.txt' }, NOW);

      expect(attachment.name).toBeNull();
      expect(attachment.size).toBeNull();
    });
  });
});

describe('attachmentsOfTask', () => {
  it('keeps the rows in the order they were attached', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      addAttachment(task.id, { path: 'first.txt' }, NOW);
      addAttachment(task.id, { path: 'second.txt' }, NOW + 1);

      expect(attachmentsOfTask(task.id).map((row) => row.path)).toEqual([
        'first.txt',
        'second.txt',
      ]);
    });
  });
});

describe('removeAttachment', () => {
  it('reports whether there was a row to remove', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const attachment = addAttachment(task.id, { path: 'a.txt' }, NOW);

      expect(removeAttachment(attachment.id)).toBe(true);
      expect(removeAttachment(attachment.id)).toBe(false);
      expect(attachmentsOfTask(task.id)).toEqual([]);
    });
  });

  it('goes with the task when the row is deleted for good', () => {
    withTempDatabase((db) => {
      const task = createTask({ title: 'x' }, NOW);
      addAttachment(task.id, { path: 'a.txt' }, NOW);

      db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);

      const count = db.prepare('SELECT COUNT(*) AS count FROM attachments').get() as {
        count: number;
      };
      expect(count.count).toBe(0); // ON DELETE CASCADE (§5.2)
    });
  });
});
