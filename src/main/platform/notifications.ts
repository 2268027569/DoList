import { Notification } from 'electron';

import type { Reminder } from '@shared/types/reminder';
import type { TaskWithTags } from '@shared/types/task';
import { formatDateTime } from '@shared/i18n/format';

import { currentLocale, t } from '../i18n';
import { createLogger } from '../logger';
import { setReminderState } from '../db/repositories/reminders';
import { readTask } from '../services/tasks';
import { isSmokeEnabled, smokeRecord } from './smoke';
import { expandPanelForTask } from '../windows/panel';
import { closeAllReminderWindows, closeReminderWindow, showReminderWindow } from '../windows/reminder';

const log = createLogger('platform/notifications');

/**
 * Reminder delivery (docs/FEATURES.md M04).
 *
 * A due reminder is announced twice over, in two steps, and the second step is what
 * the first one's silence buys:
 *
 *   1. the OS notification — a Windows toast or a macOS notification-centre banner,
 *      which reaches the user wherever they are and survives this app being in the
 *      background; then
 *   2. several minutes later, if that one is still unanswered, the app's own
 *      always-on-top popup window (windows/reminder.ts), which the OS cannot take
 *      away and which does **not** unfold the panel over what the user is doing.
 *
 * **The two never both speak.** A reminder is one instance with one row, and that row
 * is the whole coordination: answering the toast marks the instance `dismissed`, and
 * the popup's timer reads that before it opens anything. Answering the popup shuts the
 * toast down — on the desktop it is still sitting there — so there is no half-answered
 * pair to clean up (M04 D2).
 *
 * This is the layer that owns every OS call — `Notification`, the reminder window — which
 * is why the scheduler above it takes a `deliver` callback instead of importing any of
 * this. The timing rules stay unit-tested; this stays the part that needs a desktop.
 */

/**
 * How long the toast is given before the popup takes over. Long enough for "I saw it
 * and dealt with it" and short enough that a user who did not see it is not left
 * alone with a task they are about to miss.
 */
const CARD_DELAY_MS = 3 * 60 * 1000;

/**
 * The same window under the harness, where the run cannot wait three minutes to find
 * out whether the fallback works. The fake is the duration, not the path: the same
 * timer, on the same arm, reading the same row.
 */
const SMOKE_CARD_DELAY_MS = 1500;

/** What one delivered reminder still has open on the desktop. */
interface OpenReminder {
  reminder: Reminder;
  /** The toast, while it is still up; `null` when the platform had none to offer. */
  toast: Notification | null;
  /** The fallback popup's timer. Cleared the moment the reminder is answered. */
  cardTimer: NodeJS.Timeout | null;
}

/**
 * The reminders this process has delivered and not yet had answered. In memory only,
 * unlike the row it stands for: what survives a restart is the instance being `fired`,
 * which is enough to know it has already spoken (§5.3). The map exists for the parts
 * a restart does not need to remember — the OS object to close, and a timer to cancel.
 */
const open = new Map<string, OpenReminder>();

/**
 * Announces one instance, and arms its fallback.
 *
 * Called by the scheduler for instances that came due — never for the same one twice,
 * because the scheduler marks the row `fired` before it calls.
 */
export function deliverReminder(reminder: Reminder, task: TaskWithTags | null): void {
  // The task may be gone by the time this arrived (deleted on another surface): an
  // announcement with nothing to name is worse than none, so the instance is closed
  // out here instead.
  if (task === null) {
    setReminderState(reminder.id, 'dismissed');
    return;
  }

  const toast = showToast(reminder, task);
  const cardTimer = setTimeout(() => {
    openCard(reminder.id);
  }, isSmokeEnabled() ? SMOKE_CARD_DELAY_MS : CARD_DELAY_MS);
  cardTimer.unref();

  open.set(reminder.id, { reminder, toast, cardTimer });
  smokeRecord('reminder-notified', { id: reminder.id, taskId: reminder.taskId });
  log('reminder delivered', { id: reminder.id, toast: toast !== null });
}

/**
 * The user answered a reminder — by clicking the OS notification, or from the popup.
 *
 * This is the one answer both paths funnel into, and it is what the dedup is written
 * on: the instance moves to `dismissed` and everything still open for it is taken
 * down. Answering twice (a click that lands as the popup opens) finds nothing left
 * to do and is not an error.
 *
 * The popup is closed unconditionally, even when the instance had already moved: it is
 * the same instance either way, and a window left standing for a reminder that has been
 * dealt with is a stale announcement.
 */
export function answerReminder(id: string, by: 'popup' | 'toast'): boolean {
  const entry = open.get(id);
  if (entry !== undefined) {
    if (entry.cardTimer !== null) clearTimeout(entry.cardTimer);
    // Closing the toast as well is not politeness: on Windows the banner stays up
    // until it is dismissed, so leaving it would be a second, stale announcement of a
    // reminder the user has just dealt with.
    entry.toast?.close();
    open.delete(id);
  }
  closeReminderWindow(id);

  const moved = setReminderState(id, 'dismissed');
  if (moved) smokeRecord('reminder-answered', { id, by });
  return moved;
}

/** Drops everything open, so a quitting process leaves no timers or windows behind. */
export function closeAllReminderSurfaces(): void {
  for (const entry of open.values()) {
    if (entry.cardTimer !== null) clearTimeout(entry.cardTimer);
    entry.toast?.close();
  }
  open.clear();
  closeAllReminderWindows();
}

/**
 * The toast, when the platform can draw one. `Notification.isSupported()` is false on
 * a Windows build with notifications turned off and on a macOS session with no
 * notification centre — the popup is then the only surface there is, and it arrives on
 * the same timer as usual rather than being skipped.
 */
function showToast(reminder: Reminder, task: TaskWithTags): Notification | null {
  if (!Notification.isSupported()) {
    log('platform has no notifications; the popup is the only surface');
    return null;
  }

  const toast = new Notification({
    title: t('notify.reminderTitle'),
    body: notificationBody(task),
    silent: false,
  });
  // Clicking it is an answer: the user has been reached, so the popup must not follow.
  toast.on('click', () => {
    if (!answerReminder(reminder.id, 'toast')) return;
    // And it opens the task, which is why the click is worth having at all — the
    // toast says "this one is due", the panel is where it can be dealt with.
    expandPanelForTask(reminder.taskId);
  });
  toast.show();
  return toast;
}

/** The task's name, and when it is due — the two things the toast has room for. */
function notificationBody(task: TaskWithTags): string {
  if (task.dueAt === null) return task.title;
  return `${task.title}\n${formatDateTime(task.dueAt, currentLocale())}`;
}

/**
 * The fallback: the popup window, several minutes after a toast nobody answered.
 *
 * It is a window of its own rather than a card inside the panel, because the panel is
 * where the user works and this announcement exists precisely for the case where they
 * are working on something else (M04).
 *
 * Reading the entry again before opening anything is the dedup — the toast may have been
 * clicked while this timer was in flight, which deletes the entry and cancels this timer,
 * so an announcement that has already been answered has nothing left to open.
 */
function openCard(id: string): void {
  const entry = open.get(id);
  if (entry === undefined) return;

  // The toast has had its chance; whatever is left of it comes down.
  entry.toast?.close();
  entry.cardTimer = null;

  const task = readTask(entry.reminder.taskId);
  if (task === null) {
    answerReminder(id, 'popup');
    return;
  }

  showReminderWindow({
    id,
    taskId: entry.reminder.taskId,
    title: task.title,
    dueAt: task.dueAt,
  });
  smokeRecord('reminder-card', { id, taskId: entry.reminder.taskId });
  log('reminder popup shown', { id });
}
