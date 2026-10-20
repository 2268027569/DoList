import type { Reminder } from '@shared/types/reminder';
import type { TaskWithTags } from '@shared/types/task';

import {
  dismissPendingBefore,
  nextPendingFireAt,
  pendingRemindersDueBy,
  setReminderState,
} from '../db/repositories/reminders';
import { readTask } from './tasks';

/**
 * The reminder scheduler (docs/ARCHITECTURE.md §5.3).
 *
 * **One timer, not a tick.** The scheduler reads the earliest waiting `fire_at` and
 * arms a single `setTimeout` for it; when that fires the instances that came due are
 * handed over and the timer is re-armed for whatever is next. Nothing here polls, so
 * an app that is sitting idle with a reminder three days out is genuinely idle —
 * which is the whole reason the marker window can be a 23 kB DOM page.
 *
 * **It owns no OS behaviour.** Delivering a reminder means an OS notification and,
 * when that goes unanswered, an in-app card — but this module only knows the
 * *instance* and the task it is about; the host handed in at start-up is what speaks
 * to the operating system. That is what keeps the timing rules unit-tested against a
 * real database with a hand-driven clock and no Electron anywhere near them.
 *
 * **The database is the memory.** A delivered instance is moved to `fired` and stays
 * there, so a restart does not re-announce it; a missed one is marked `dismissed`
 * rather than delivered late. A rule about "never twice" therefore does not need to
 * be remembered in this module — it is already a row.
 */

/**
 * How late a missed instance is still worth announcing at start-up.
 *
 * The app is not a daemon: a reminder may have come due while it was closed. A few
 * hours late is still the right thing to say. Much later is not — the task is already
 * drawn as overdue in its list, and a burst of notifications about a week the user has
 * long since finished would train them to ignore all of them.
 */
const MISSED_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * Longest delay one timer can carry. `setTimeout` takes a signed 32-bit millisecond
 * count, so anything past ~24.8 days would overflow and fire immediately; the wait is
 * split instead, and the re-arm at the end of each slice is the same code path as any
 * other firing.
 */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** What the scheduler needs from the process it runs in. */
export interface SchedulerDeps {
  /** Delivers one due instance. Called once per instance, never twice for it. */
  deliver: (reminder: Reminder, task: TaskWithTags | null) => void;
  /** The clock. Injected so a test drives it by hand; defaults to the wall clock. */
  now?: () => number;
  /** Arms a timer and answers the function that cancels it. Injected for the tests. */
  arm?: (delayMs: number, fire: () => void) => () => void;
}

export interface Scheduler {
  /** The start-up pass, then the first timer. */
  start: () => void;
  /** Drops the timer. Anything already delivered stays delivered. */
  stop: () => void;
  /**
   * Re-arms for the new earliest instance. Called after every task write: a write can
   * both arm a reminder and drop one, and a single `MIN(fire_at)` covers both.
   */
  reschedule: () => void;
  /**
   * Hands over everything due right now, and answers how many. This is also what the
   * timer does — exposed so the harness can ask for the moment instead of waiting.
   */
  fireDue: () => number;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const now = deps.now ?? Date.now;
  const arm = deps.arm ?? defaultArm;
  let cancel: (() => void) | null = null;

  function clearTimer(): void {
    cancel?.();
    cancel = null;
  }

  function fireDue(): number {
    const due = pendingRemindersDueBy(now());
    for (const reminder of due) {
      // Marked before it is delivered, not after: delivery can raise a window and
      // re-enter this process, and an instance that is announced while still reading
      // as `pending` would be announced a second time by the next plan.
      setReminderState(reminder.id, 'fired');
      deps.deliver(reminder, readTask(reminder.taskId));
    }
    return due.length;
  }

  function plan(): void {
    clearTimer();
    const at = nextPendingFireAt();
    if (at === null) return;

    const delay = Math.max(0, at - now());
    cancel = arm(Math.min(delay, MAX_TIMER_MS), () => {
      cancel = null;
      fireDue();
      // Whatever was delivered is no longer waiting, so this re-arms on the next one.
      plan();
    });
  }

  return {
    start(): void {
      // Old business first: an instance missed by more than the grace never gets
      // delivered, so it must not be picked up by the pass below.
      const at = now();
      dismissPendingBefore(at - MISSED_GRACE_MS);
      fireDue();
      plan();
    },
    stop: clearTimer,
    reschedule: plan,
    fireDue,
  };
}

/**
 * The live scheduler. It is a module singleton like the settings store, because the
 * timer has to outlive the call that started it; the tests build their own through
 * `createScheduler` rather than touching this one.
 */
let active: Scheduler | null = null;

/** Starts the scheduler, replacing any previous one (a launch has exactly one). */
export function startReminderScheduler(deps: SchedulerDeps): Scheduler {
  active?.stop();
  active = createScheduler(deps);
  active.start();
  return active;
}

export function stopReminderScheduler(): void {
  active?.stop();
  active = null;
}

/**
 * Re-arms after a write. A no-op before start-up: the first `start` reads the same
 * table, so an early write needs no timer of its own.
 */
export function rescheduleReminders(): void {
  active?.reschedule();
}

/** The live scheduler, or `null` before start-up. For the reminder IPC handler. */
export function activeScheduler(): Scheduler | null {
  return active;
}

function defaultArm(delayMs: number, fire: () => void): () => void {
  const timer = setTimeout(fire, delayMs);
  // A pending reminder must not be the reason a quitting app stays alive.
  timer.unref();
  return () => clearTimeout(timer);
}
