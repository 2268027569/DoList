import { describe, expect, it } from 'vitest';

import { dueChip } from './task-due-label';

/**
 * Local-time constructors on purpose: the rules this covers are about the local
 * day, so building the inputs in UTC would make the test depend on the runner's
 * timezone instead of on the function.
 */
const NOW = new Date(2026, 4, 20, 15, 0, 0).getTime(); // 2026-05-20 15:00 local
const at = (...parts: [number, number, number, number?, number?]): number =>
  new Date(parts[0], parts[1], parts[2], parts[3] ?? 0, parts[4] ?? 0).getTime();

describe('dueChip', () => {
  it('renders nothing when the task has no due date', () => {
    expect(dueChip(null, false, 'en', NOW)).toBeNull();
    expect(dueChip(null, true, 'en', NOW)).toBeNull();
  });

  it('calls a date-only task due today "today", not overdue at 15:00', () => {
    expect(dueChip(at(2026, 4, 20), false, 'en', NOW)).toEqual({ kind: 'today', text: 'today' });
  });

  it('calls a date-only task due tomorrow "later"', () => {
    expect(dueChip(at(2026, 4, 21), false, 'en', NOW)).toEqual({
      kind: 'later',
      text: 'tomorrow',
    });
  });

  it('counts days for a date-only task further out', () => {
    expect(dueChip(at(2026, 4, 25), false, 'en', NOW)).toEqual({
      kind: 'later',
      text: 'in 5 days',
    });
  });

  it('marks a date-only task whose day has passed overdue', () => {
    expect(dueChip(at(2026, 4, 19), false, 'en', NOW)).toEqual({
      kind: 'overdue',
      text: 'yesterday',
    });
  });

  it('judges a timed task by the instant', () => {
    expect(dueChip(at(2026, 4, 20, 13), true, 'en', NOW)).toEqual({
      kind: 'overdue',
      text: '2 hours ago',
    });
  });

  it('shows the clock time for a timed task later today', () => {
    expect(dueChip(at(2026, 4, 20, 17), true, 'en', NOW)).toEqual({
      kind: 'today',
      text: '5:00 PM',
    });
  });

  it('falls back to the day for a timed task on a later day', () => {
    expect(dueChip(at(2026, 4, 21, 9), true, 'en', NOW)).toEqual({
      kind: 'later',
      text: 'tomorrow',
    });
  });

  it('is locale-aware', () => {
    expect(dueChip(at(2026, 4, 20), false, 'zh-Hans', NOW)).toEqual({
      kind: 'today',
      text: '今天',
    });
  });
});
