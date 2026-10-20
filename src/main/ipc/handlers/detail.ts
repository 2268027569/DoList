import { IPC } from '@shared/contracts/channels';
import { detailTaskInput } from '@shared/contracts/detail';
import { ok } from '@shared/contracts/result';

import { closeDetailWindow, showDetailWindow } from '../../windows/detail';
import { invalid } from '../validate';
import type { ChannelHandler } from './task';

/**
 * The detail window's two channels (docs/FEATURES.md M02 D6).
 *
 * The window itself is main-process business — only it may create, place and destroy
 * one — so the renderer's whole say is "open this task" and "put it away". Nothing is
 * returned beyond the acknowledgement: which row is on screen is decided by the window,
 * and the panel re-reads its list from the task events it already subscribes to.
 */
export function detailChannelHandlers(): ChannelHandler[] {
  return [
    {
      channel: IPC.detail.open,
      run: (payload) => {
        const parsed = detailTaskInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.detail.open, parsed.error.issues);
        showDetailWindow(parsed.data.taskId);
        return ok(null);
      },
    },
    {
      channel: IPC.detail.close,
      run: () => {
        closeDetailWindow();
        return ok(null);
      },
    },
  ];
}
