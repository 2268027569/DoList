import { IPC } from '@shared/contracts/channels';
import { reminderDismissInput, reminderDoneInput } from '@shared/contracts/reminder';
import { ok } from '@shared/contracts/result';

import { answerReminder } from '../../platform/notifications';
import { notifyTasksChanged } from '../../services/task-events';
import { updateTaskFromPatch } from '../../services/tasks';
import { invalid } from '../validate';
import type { ChannelHandler } from './task';

/**
 * The reminder domain's two channels (docs/FEATURES.md M04).
 *
 * Everything else about reminders happens without the renderer: the scheduler arms
 * them and the notification layer announces them, and the popup that takes over from
 * an unanswered notification draws itself from the payload its window was opened with.
 * What is left is the two things only a renderer can report — that the user read the
 * popup, and that they answered it by ticking the task off — because the main process
 * has no way of observing either.
 */
export function reminderChannelHandlers(): ChannelHandler[] {
  return [
    {
      channel: IPC.reminder.dismiss,
      run: (payload) => {
        const parsed = reminderDismissInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.reminder.dismiss, parsed.error.issues);
        // `false` when the instance is unknown or was already answered: the toast can
        // be clicked at the same moment the popup is being put away, and a second
        // answer is a no-op rather than a failure (M04 D2).
        return ok({ dismissed: answerReminder(parsed.data.id, 'popup') });
      },
    },
    {
      channel: IPC.reminder.done,
      run: (payload) => {
        const parsed = reminderDoneInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.reminder.done, parsed.error.issues);

        // One user action, so one command: the write and the answer are reported
        // together, and the answer still happens when the task turns out to be gone —
        // the reminder was read either way, and leaving it `fired` would let the OS
        // notification for it speak a second time.
        const { task, change } = updateTaskFromPatch(parsed.data.taskId, { status: 'done' });
        if (task !== null) {
          // The panel is showing whatever view it was showing, so a task ticked from
          // the popup has to be announced for the same reason the list's own checkbox
          // is: one write, one notification (M02 §5). Ticking a repeating task mints
          // its next occurrence, which is why the notification carries the change
          // rather than this handler's own id.
          notifyTasksChanged(change);
        }
        const dismissed = answerReminder(parsed.data.id, 'popup');
        return ok({ dismissed, task });
      },
    },
  ];
}
