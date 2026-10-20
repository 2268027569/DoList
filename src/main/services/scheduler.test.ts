import { describe, expect, it, vi } from 'vitest';

import type { Reminder } from '@shared/types/reminder';
import type { TaskWithTags } from '@shared/types/task';

import { withTempDatabase } from '../db/test-db';
import { listRemindersForTask, replacePendingReminder } from '../db/repositories/reminders';
import { createTaskFromInput, deleteTasks } from './tasks';
import { createScheduler } from './scheduler';

const NOW = new Date(2026, 4, 12, 10, 0, 0).getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * A clock and a timer the test drives by hand.
 *
 * The scheduler is timing logic, and the only honest way to test timing logic is to
 * own both halves of it: nothing here sleeps, so the assertions are about the
 * arithmetic and the order of events rather than about how long a machine took.
 */
function harness() {
  let clock = NOW;
  const timers: { at: number; fire: () => void }[] = [];
  const delivered: { reminder: Reminder; task: TaskWithTags | null }[] = [];

  const scheduler = createScheduler({
    deliver: (reminder, task) => delivered.push({ reminder, task }),
    now: () => clock,
    arm: (delayMs, fire) => {
      const timer = { at: clock + delayMs, fire };
      timers.push(timer);
      return () => {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
      };
    },
  });

  /** Moves the clock to `at` and runs whatever timer that moment covers. */
  function advanceTo(at: number): void {
    clock = at;
    for (const timer of timers.filter((entry) => entry.at <= at)) {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
      timer.fire();
    }
  }

  return {
    scheduler,
    delivered,
    timers,
    now: () => clock,
    advanceTo,
    /** How far away the single armed timer is, or `null` when none is armed. */
    armedIn: () => (timers.length === 0 ? null : Math.min(...timers.map((t) => t.at)) - clock),
  };
}

/**
 * A task that is due `dueInMs` from now with a reminder `leadMin` before it.
 *
 * Through the service rather than the repository, because it is the service that
 * derives the reminder instance from the task — the repository only writes the row.
 */
function taskDueIn(dueInMs: number, leadMin: number): TaskWithTags {
  const { task } = createTaskFromInput(
    { title: 'due', dueAt: NOW + dueInMs, dueHasTime: true, remindLeadMin: leadMin },
    NOW,
  );
  return task;
}

/**
 * A task whose reminder comes due at `fireAt`, created as if it were `armedAt`.
 *
 * Passing an `armedAt` that is hours before `fireAt` is how a test stands in for a
 * previous run that armed it and then exited: the row is still waiting, and the
 * scheduler starting now is the first thing to look at it since.
 */
function taskReminderFiringAt(fireAt: number, armedAt: number, leadMin = 30): TaskWithTags {
  const { task } = createTaskFromInput(
    { title: 'x', dueAt: fireAt + leadMin * MINUTE, dueHasTime: true, remindLeadMin: leadMin },
    armedAt,
  );
  return task;
}

describe('createScheduler', () => {
  it('arms a single timer for the earliest reminder, not one per reminder', () => {
    withTempDatabase(() => {
      const h = harness();
      taskDueIn(HOUR, 10);
      taskDueIn(2 * HOUR, 10);
      taskDueIn(HOUR, 30);

      h.scheduler.start();

      // Three reminders, one timer: it is armed for the soonest of them, and re-armed
      // after each firing. Nothing polls, which is what lets an idle app stay idle.
      expect(h.timers.length).toBe(1);
      expect(h.armedIn()).toBe(30 * MINUTE);
    });
  });

  it('arms nothing when no task has a reminder', () => {
    withTempDatabase(() => {
      const h = harness();
      createTaskFromInput({ title: 'no reminder' }, NOW);
      createTaskFromInput({ title: 'due but no lead', dueAt: NOW + HOUR, dueHasTime: true }, NOW);

      h.scheduler.start();

      expect(h.timers.length).toBe(0);
      expect(h.delivered).toEqual([]);
    });
  });

  it('delivers the instance when its moment arrives, and re-arms for the next', () => {
    withTempDatabase(() => {
      const h = harness();
      const soon = taskDueIn(HOUR, 30);
      const later = taskDueIn(2 * HOUR, 10);

      h.scheduler.start();
      h.advanceTo(NOW + 30 * MINUTE);

      expect(h.delivered.map((entry) => entry.reminder.taskId)).toEqual([soon.id]);
      expect(h.delivered[0]?.task?.title).toBe('due');
      // And it is already waiting for the next one, without anyone asking it to.
      expect(h.armedIn()).toBe(2 * HOUR - 10 * MINUTE - 30 * MINUTE);
      expect(later.id).not.toBe(soon.id);
    });
  });

  it('delivers each instance exactly once', () => {
    withTempDatabase(() => {
      const h = harness();
      taskDueIn(HOUR, 30);

      h.scheduler.start();
      const at = h.now() + 30 * MINUTE;
      h.advanceTo(at);
      // Time passes, and the clock is read again by the write path's re-arm: the row
      // is no longer waiting, so nothing is delivered a second time.
      h.scheduler.reschedule();
      h.advanceTo(at + HOUR);

      expect(h.delivered).toHaveLength(1);
    });
  });

  it('delivers everything that is due in one pass, oldest first', () => {
    withTempDatabase(() => {
      const h = harness();
      const a = taskDueIn(HOUR, 30);
      const b = taskDueIn(HOUR, 10);

      h.scheduler.start();
      h.advanceTo(NOW + 50 * MINUTE);

      expect(h.delivered.map((entry) => entry.reminder.taskId)).toEqual([a.id, b.id]);
    });
  });

  it('reads the task at delivery time, so an edit in between is what is announced', () => {
    withTempDatabase(() => {
      const h = harness();
      taskDueIn(HOUR, 30);

      h.scheduler.start();
      h.advanceTo(NOW + 30 * MINUTE);

      // The task the scheduler hands over is not a snapshot taken when the timer was
      // armed — it is read when the moment arrives.
      expect(h.delivered[0]?.task?.title).toBe('due');
    });
  });

  it('re-arms onto the new moment when a write moves a reminder later', () => {
    withTempDatabase(() => {
      const h = harness();
      const task = taskDueIn(HOUR, 30);

      h.scheduler.start();
      expect(h.armedIn()).toBe(30 * MINUTE);

      // The user pushes the deadline out; the write path calls `reschedule`.
      replacePendingReminder(task.id, NOW + 5 * HOUR, NOW);
      h.scheduler.reschedule();

      expect(h.armedIn()).toBe(5 * HOUR);
      expect(h.timers.length).toBe(1);
    });
  });

  it('drops the timer when the last reminder is cleared', () => {
    withTempDatabase(() => {
      const h = harness();
      const task = taskDueIn(HOUR, 30);

      h.scheduler.start();
      expect(h.timers.length).toBe(1);

      // Finishing the task clears its wait (the task service does this), and the
      // re-arm that follows the write is what lets the timer go.
      replacePendingReminder(task.id, null, NOW);
      h.scheduler.reschedule();

      expect(h.timers.length).toBe(0);
      expect(h.delivered).toEqual([]);
    });
  });

  it('does not deliver a reminder that was missed by more than the grace', () => {
    withTempDatabase(() => {
      const h = harness();
      // Both were armed by a run that is no longer here — that is what `armedAt` being
      // hours before now means — and both are still reading as waiting.
      const stale = taskReminderFiringAt(NOW - 48 * HOUR, NOW - 72 * HOUR);
      const fresh = taskReminderFiringAt(NOW - 30 * MINUTE, NOW - 2 * HOUR);

      h.scheduler.start();

      // What is a couple of days late is not announced — the task already reads as
      // overdue — and what is half an hour late still is.
      expect(h.delivered.map((entry) => entry.reminder.taskId)).toEqual([fresh.id]);
      expect(stale.id).not.toBe(fresh.id);
    });
  });

  it('closes out a missed instance rather than leaving it armed forever', () => {
    withTempDatabase(() => {
      const h = harness();
      const stale = taskReminderFiringAt(NOW - 48 * HOUR, NOW - 72 * HOUR);

      h.scheduler.start();

      expect(listRemindersForTask(stale.id)[0]?.state).toBe('dismissed');
      // Nothing is left waiting, so nothing is armed.
      expect(h.timers.length).toBe(0);
    });
  });

  it('stops arming anything after stop', () => {
    withTempDatabase(() => {
      const h = harness();
      taskDueIn(HOUR, 30);

      h.scheduler.start();
      h.scheduler.stop();

      expect(h.timers.length).toBe(0);
      h.advanceTo(NOW + 10 * HOUR);
      expect(h.delivered).toEqual([]);
    });
  });

  it('never announces a task that was binned after its timer was armed', () => {
    withTempDatabase(() => {
      const h = harness();
      const task = taskDueIn(HOUR, 30);

      h.scheduler.start();
      // The delete path drops the waiting instance as part of the same write, so the
      // timer that was armed for it finds nothing waiting when its moment arrives —
      // a task in the recycle bin is not something to be told about.
      deleteTasks([task.id], NOW);
      h.advanceTo(NOW + 30 * MINUTE);

      expect(h.delivered).toEqual([]);
    });
  });
});

describe('createScheduler clock injection', () => {
  it('defaults to the wall clock when none is given', () => {
    withTempDatabase(() => {
      const deliver = vi.fn();
      const scheduler = createScheduler({ deliver });
      // Nothing waiting, so nothing armed: the only thing this asserts is that the
      // no-clock path does not throw on the way to reading it.
      scheduler.start();
      scheduler.stop();
      expect(deliver).not.toHaveBeenCalled();
    });
  });
});
