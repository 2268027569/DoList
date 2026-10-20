import { IPC } from '@shared/contracts/channels';
import { reminderDismissInput } from '@shared/contracts/reminder';
import { ok } from '@shared/contracts/result';

import { answerReminder } from '../../platform/notifications';
import { invalid } from '../validate';
import type { ChannelHandler } from './task';

/**
 * The reminder domain's one channel (docs/FEATURES.md M04).
 *
 * Everything else about reminders happens without the renderer: the scheduler arms
 * them and the notification layer announces them. The single thing the panel can
 * report is that the user answered the card it is showing — the fact the main process
 * has no way of observing, which is what makes the card's dismissal worth a channel.
 */
export function reminderChannelHandlers(): ChannelHandler[] {
  return [
    {
      channel: IPC.reminder.dismiss,
      run: (payload) => {
        const parsed = reminderDismissInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.reminder.dismiss, parsed.error.issues);
        // `false` when the instance is unknown or was already answered: the toast can
        // be clicked at the same moment the card is being put away, and a second answer
        // is a no-op rather than a failure (M04 D2).
        return ok({ dismissed: answerReminder(parsed.data.id, 'card') });
      },
    },
  ];
}
