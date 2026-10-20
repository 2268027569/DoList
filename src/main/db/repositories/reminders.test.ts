import { describe, expect, it } from 'vitest';

import { withTempDatabase } from '../test-db';
import {
  clearPendingReminders,
  dismissPendingBefore,
  getReminder,
  listRemindersForTask,
  nextPendingFireAt,
  pendingRemindersDueBy,
  replacePendingReminder,
  setReminderState,
} from './reminders';
import { createTask } from './tasks';

const NOW = new Date(2026, 4, 12, 10, 0, 0).getTime();
const MINUTE = 60_000;

describe('replacePendingReminder', () => {
  it('arms one instance for a fire time in the future', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const reminder = replacePendingReminder(task.id, NOW + 30 * MINUTE, NOW);

      expect(reminder).toMatchObject({
        taskId: task.id,
        fireAt: NOW + 30 * MINUTE,
        state: 'pending',
        snoozeUntil: null,
      });
      expect(listRemindersForTask(task.id)).toEqual([reminder]);
    });
  });

  it('replaces the waiting instance instead of stacking a second one', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const first = replacePendingReminder(task.id, NOW + 30 * MINUTE, NOW);
      const second = replacePendingReminder(task.id, NOW + 60 * MINUTE, NOW);

      // The old one is not merely superseded — it is gone. A task has one reminder
      // waiting, and leaving the first armed would tell the user twice.
      expect(second?.id).not.toBe(first?.id);
      expect(listRemindersForTask(task.id)).toEqual([second]);
    });
  });

  it('clears the wait when the fire time is null', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      replacePendingReminder(task.id, NOW + 30 * MINUTE, NOW);

      expect(replacePendingReminder(task.id, null, NOW)).toBeNull();
      expect(listRemindersForTask(task.id)).toEqual([]);
    });
  });

  it('writes down a moment that has already passed rather than refusing it', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);

      // Whether a past moment is still worth saying is the grace rule's call, made by
      // the caller before it gets here. This layer only records what it is handed, and a
      // waiting instance at a past time is ordinary — the scheduler arms it with a delay
      // of zero and speaks on the next tick.
      const reminder = replacePendingReminder(task.id, NOW - MINUTE, NOW);

      expect(reminder?.fireAt).toBe(NOW - MINUTE);
      expect(reminder?.state).toBe('pending');
    });
  });

  it('keeps a moment that is exactly now waiting, to speak at once', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      expect(replacePendingReminder(task.id, NOW, NOW)?.fireAt).toBe(NOW);
    });
  });

  it('does not re-arm a moment that has already been announced', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const fired = replacePendingReminder(task.id, NOW + 30 * MINUTE, NOW)!;
      setReminderState(fired.id, 'fired');

      // The user renames the title a minute later. The reminder's moment has not moved,
      // so re-deriving it must not resurrect an announcement the user has been given —
      // and the same holds for one they answered.
      expect(replacePendingReminder(task.id, NOW + 30 * MINUTE, NOW + MINUTE)).toBeNull();
      expect(listRemindersForTask(task.id).map((row) => row.id)).toEqual([fired.id]);

      const dismissed = replacePendingReminder(task.id, NOW + 90 * MINUTE, NOW + MINUTE)!;
      setReminderState(dismissed.id, 'dismissed');
      expect(replacePendingReminder(task.id, NOW + 90 * MINUTE, NOW + 2 * MINUTE)).toBeNull();
    });
  });

  it('arms a moved moment even when an earlier one was announced', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const first = replacePendingReminder(task.id, NOW + 30 * MINUTE, NOW)!;
      setReminderState(first.id, 'dismissed');

      // A different moment is a different reminder: the user moved the deadline, so this
      // is something new to say rather than a repeat of what was already answered.
      const second = replacePendingReminder(task.id, NOW + 60 * MINUTE, NOW + MINUTE);

      expect(second?.id).not.toBe(first.id);
      expect(listRemindersForTask(task.id).map((row) => [row.fireAt, row.state])).toEqual([
        [NOW + 30 * MINUTE, 'dismissed'],
        [NOW + 60 * MINUTE, 'pending'],
      ]);
    });
  });

  it('leaves instances that already fired alone', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const fired = replacePendingReminder(task.id, NOW + 30 * MINUTE, NOW)!;
      setReminderState(fired.id, 'fired');

      const next = replacePendingReminder(task.id, NOW + 60 * MINUTE, NOW);

      // History is a record of what was said; re-deriving the task later must not
      // rewrite it. Read back rather than compared to the creation-time snapshot, which
      // was taken while the instance was still `pending`.
      expect(listRemindersForTask(task.id).map((row) => [row.id, row.state])).toEqual([
        [fired.id, 'fired'],
        [next!.id, 'pending'],
      ]);
    });
  });
});

describe('nextPendingFireAt', () => {
  it('is null with nothing waiting', () => {
    withTempDatabase(() => {
      expect(nextPendingFireAt()).toBeNull();
    });
  });

  it('is the earliest of everything waiting, across tasks', () => {
    withTempDatabase(() => {
      const a = createTask({ title: 'a' }, NOW);
      const b = createTask({ title: 'b' }, NOW);
      replacePendingReminder(a.id, NOW + 60 * MINUTE, NOW);
      replacePendingReminder(b.id, NOW + 10 * MINUTE, NOW);

      expect(nextPendingFireAt()).toBe(NOW + 10 * MINUTE);
    });
  });

  it('ignores instances that are not waiting', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const fired = replacePendingReminder(task.id, NOW + 10 * MINUTE, NOW);
      setReminderState(fired!.id, 'fired');

      // The scheduler arms one timer on this value; an instance that has already
      // spoken must not drag it back to a moment in the past.
      expect(nextPendingFireAt()).toBeNull();
    });
  });
});

describe('pendingRemindersDueBy', () => {
  it('answers only what has come due, oldest first', () => {
    withTempDatabase(() => {
      const a = createTask({ title: 'a' }, NOW);
      const b = createTask({ title: 'b' }, NOW);
      const c = createTask({ title: 'c' }, NOW);
      const later = replacePendingReminder(c.id, NOW + 60 * MINUTE, NOW);
      const sooner = replacePendingReminder(a.id, NOW + MINUTE, NOW);
      const middle = replacePendingReminder(b.id, NOW + 5 * MINUTE, NOW);

      expect(pendingRemindersDueBy(NOW + 10 * MINUTE).map((row) => row.id)).toEqual([
        sooner!.id,
        middle!.id,
      ]);
      expect(later).not.toBeNull();
    });
  });

  it('includes an instance whose moment is exactly now', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const at = NOW + MINUTE;
      const reminder = replacePendingReminder(task.id, at, NOW);

      expect(pendingRemindersDueBy(at).map((row) => row.id)).toEqual([reminder!.id]);
    });
  });
});

describe('clearPendingReminders', () => {
  it('drops the wait for every named task and answers how many', () => {
    withTempDatabase(() => {
      const a = createTask({ title: 'a' }, NOW);
      const b = createTask({ title: 'b' }, NOW);
      replacePendingReminder(a.id, NOW + MINUTE, NOW);
      replacePendingReminder(b.id, NOW + MINUTE, NOW);

      expect(clearPendingReminders([a.id, b.id])).toBe(2);
      expect(nextPendingFireAt()).toBeNull();
    });
  });

  it('does nothing, and answers zero, for an empty list', () => {
    withTempDatabase(() => {
      // The delete path calls this with whatever it tombstoned; an empty set must not
      // build a `WHERE id IN ()` that matches nothing in a way the driver dislikes.
      expect(clearPendingReminders([])).toBe(0);
    });
  });

  it('leaves instances that already fired', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const fired = replacePendingReminder(task.id, NOW + MINUTE, NOW);
      setReminderState(fired!.id, 'fired');

      expect(clearPendingReminders([task.id])).toBe(0);
      expect(getReminder(fired!.id)?.state).toBe('fired');
    });
  });
});

describe('setReminderState', () => {
  it('moves the instance and answers true', () => {
    withTempDatabase(() => {
      const task = createTask({ title: 'x' }, NOW);
      const reminder = replacePendingReminder(task.id, NOW + MINUTE, NOW);

      expect(setReminderState(reminder!.id, 'dismissed')).toBe(true);
      expect(getReminder(reminder!.id)?.state).toBe('dismissed');
    });
  });

  it('answers false for an unknown id', () => {
    withTempDatabase(() => {
      expect(setReminderState('nope', 'fired')).toBe(false);
    });
  });
});

describe('dismissPendingBefore', () => {
  it('closes out what was missed and leaves what is still coming', () => {
    withTempDatabase(() => {
      // Both were armed two days ago — that is what the `now` argument being days
      // before NOW means — and one of them came due since, the other has not.
      const armedAt = NOW - 72 * 60 * MINUTE;
      const stale = createTask({ title: 'stale' }, armedAt);
      const coming = createTask({ title: 'coming' }, armedAt);
      const missed = replacePendingReminder(stale.id, NOW - 48 * 60 * MINUTE, armedAt)!;
      const ahead = replacePendingReminder(coming.id, NOW + 60 * MINUTE, armedAt)!;

      // The cutoff is `now - grace`: one that is two days late is closed out, and one
      // that is an hour out is still waiting.
      expect(dismissPendingBefore(NOW - 6 * 60 * MINUTE)).toBe(1);
      expect(getReminder(missed.id)?.state).toBe('dismissed');
      expect(getReminder(ahead.id)?.state).toBe('pending');
    });
  });
});

describe('getReminder', () => {
  it('is null for an unknown id', () => {
    withTempDatabase(() => {
      expect(getReminder('nope')).toBeNull();
    });
  });
});
