import { describe, expect, it } from 'vitest';

import { allSubtasksDone, progressText } from './task-tree';

describe('progressText', () => {
  it('reads as done over total', () => {
    expect(progressText({ total: 3, done: 1 })).toBe('1/3');
    expect(progressText({ total: 1, done: 1 })).toBe('1/1');
    expect(progressText({ total: 12, done: 0 })).toBe('0/12');
  });

  it('shows nothing for a task that has no subtasks', () => {
    // `0/0` on every row without subtasks would be noise on most of the list.
    expect(progressText({ total: 0, done: 0 })).toBeNull();
  });
});

describe('allSubtasksDone', () => {
  it('is true only when there is something to finish and it is finished', () => {
    expect(allSubtasksDone({ total: 2, done: 2 })).toBe(true);
    expect(allSubtasksDone({ total: 2, done: 1 })).toBe(false);
    expect(allSubtasksDone({ total: 1, done: 0 })).toBe(false);
  });

  it('is false for a parent with no subtasks', () => {
    expect(allSubtasksDone({ total: 0, done: 0 })).toBe(false);
  });
});
