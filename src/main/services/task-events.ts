import { IPC } from '@shared/contracts/channels';
import type { TaskChangedPayload } from '@shared/contracts/task';

import { pushMarkerState } from '../windows/marker';
import { getPanelWindow } from '../windows/panel';

/**
 * The single notification point for every task write (§6.2, M02 §5).
 *
 * One write produces exactly one of these, and it does two things: the marker's
 * badge and ring are derived from the counts, so a write is precisely when they
 * can change; and the panel re-fetches its open query rather than patching a
 * local mirror (M02 D4).
 *
 * Only the panel is told. The marker entry does not subscribe to task changes,
 * and sending it a message it ignores would wake a window that is meant to be
 * idle.
 */
export function notifyTasksChanged(change: TaskChangedPayload): void {
  pushMarkerState();

  const panel = getPanelWindow();
  if (panel === null || panel.isDestroyed()) return;
  panel.webContents.send(IPC.event.taskChanged, change);
}
