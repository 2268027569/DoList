import { describe, expect, it } from 'vitest';

import { withTempDatabase } from '../test-db';
import { createTask } from './tasks';
import { findOrCreateTag, normaliseTagName, setTaskTags, tagsOfTasks } from './tags';

const NOW = new Date(2026, 4, 12, 10, 0, 0).getTime();

describe('normaliseTagName', () => {
  it('trims the padding off', () => {
    expect(normaliseTagName('  work  ')).toBe('work');
  });
});

describe('findOrCreateTag', () => {
  it('reuses the row when the name already exists', () => {
    withTempDatabase((db) => {
      const first = findOrCreateTag('work', NOW);
      const second = findOrCreateTag(' work ', NOW + 5);
      const count = db.prepare('SELECT COUNT(*) AS count FROM tags').get() as { count: number };

      expect(second.id).toBe(first.id);
      expect(count.count).toBe(1);
    });
  });

  it('rejects a blank name', () => {
    withTempDatabase(() => {
      expect(() => findOrCreateTag('   ', NOW)).toThrow(/blank/);
    });
  });
});

describe('setTaskTags', () => {
  it('replaces the whole set and drops the blanks', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);

      setTaskTags(task.id, ['b', '', '  ', 'a'], NOW);
      expect(tagsOfTasks([task.id]).get(task.id)).toEqual(['a', 'b']);

      setTaskTags(task.id, ['a'], NOW);
      expect(tagsOfTasks([task.id]).get(task.id)).toEqual(['a']);

      setTaskTags(task.id, [], NOW);
      expect(tagsOfTasks([task.id]).get(task.id)).toBeUndefined();
    });
  });
});

describe('tagsOfTasks', () => {
  it('returns an empty map when asked about nothing', () => {
    withTempDatabase(() => {
      expect(tagsOfTasks([]).size).toBe(0);
    });
  });

  it('groups the names per task in one round trip', () => {
    withTempDatabase(() => {
      const first = createTask({ title: 'a', tags: ['zeta', 'alpha'] }, NOW);
      const second = createTask({ title: 'b', tags: ['beta'] }, NOW);
      const untagged = createTask({ title: 'c' }, NOW);

      const grouped = tagsOfTasks([first.id, second.id, untagged.id]);

      expect(grouped.get(first.id)).toEqual(['alpha', 'zeta']); // name order, not insertion
      expect(grouped.get(second.id)).toEqual(['beta']);
      expect(grouped.has(untagged.id)).toBe(false);
    });
  });
});
