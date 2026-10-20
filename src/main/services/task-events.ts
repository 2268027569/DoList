import { IPC } from '@shared/contracts/channels';
import type { TaskChangedPayload } from '@shared/contracts/task';

import { isSmokeEnabled, smokeRecord } from '../platform/smoke';
import { pushMarkerState } from '../windows/marker';
import { getDetailWindow } from '../windows/detail';
import { getPanelWindow } from '../windows/panel';
import { currentMarkerState } from './marker-state';
import { rescheduleReminders } from './scheduler';

/**
 * The single notification point for every task write (§6.2, M02 §5).
 *
 * One write produces exactly one of these, and it does two things: the marker's
 * badge and ring are derived from the counts, so a write is precisely when they
 * can change; and the panel re-fetches its open query rather than patching a
 * local mirror (M02 D4).
 *
 * Two surfaces are told: the panel and the detail window. The detail is a renderer of
 * its own with its own copy of the row, and it re-reads that row on this event — so a
 * chip pressed in the form is drawn as the stored value by the same write. Sending it
 * to the panel alone left the form showing whatever it had when it was opened: the
 * chosen mark never moved, which is what "the style does not switch" looked like.
 *
 * The marker entry does not subscribe to task changes, and sending it a message it
 * ignores would wake a window that is meant to be idle.
 */
export function notifyTasksChanged(change: TaskChangedPayload): void {
  pushMarkerState();

  // A write is also the only thing that can move a reminder: it arms one when the due
  // date or its lead lands in the future, and drops one when the task is finished, binned
  // or rolled onto its next occurrence. Re-arming here — at the one place every write
  // passes through — is what keeps the scheduler's single timer honest without the task
  // service having to know that a scheduler exists (§5.3).
  rescheduleReminders();

  // The state sent under the harness is a fixed stub — the marker's drawing path
  // has to be observable on an empty database — so the badge this write actually
  // recomputed is published beside it. That is what lets a smoke run assert the
  // count moved, rather than asserting the stub it was handed.
  if (isSmokeEnabled()) {
    smokeRecord('task-changed', { ...change, badge: currentMarkerState().badge });
  }

  const panel = getPanelWindow();
  if (panel !== null && !panel.isDestroyed()) {
    panel.webContents.send(IPC.event.taskChanged, change);
  }
  // The detail holds one row, and it is the row this write changed — whether the write
  // came from the form itself or from the list beside it.
  const detail = getDetailWindow();
  if (detail !== null) detail.webContents.send(IPC.event.taskChanged, change);
}
