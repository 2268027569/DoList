import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReminderDuePayload } from '@shared/contracts/reminder';
import { formatDateTime } from '@shared/i18n/format';

import { report } from '../../shared-ui/smoke';
import { burst } from './particles';

/**
 * The reminder popup (docs/FEATURES.md M04).
 *
 * The second half of a two-step delivery: the OS notification speaks first, and this
 * takes over only when that one went unanswered for a few minutes. It is a window of
 * its own, *not* the panel unfolding — the point of the second announcement is that the
 * user may be doing something else, and the panel would take the screen (and the caret)
 * out from under them. It opens beside the marker, never takes focus, and stays until it
 * is answered.
 *
 * It is drawn from the payload handed to its window rather than by reading the reminder
 * back: the popup is a notification, not a view of the data.
 *
 * Two ways out, and no third: 完成 is the same write the list's own checkbox makes, and
 * 知道了 puts the popup away without touching the task. 完成 is the one that also shows
 * the effect — it is the answer that changes something, and the burst is how the popup
 * says so before it goes.
 */

/** Length of the ease-in, and of the short fade on the way out (ms). */
const ENTER_MS = 300;
const EXIT_MS = 180;

type Phase = 'entering' | 'open' | 'leaving';

interface ReminderPopupProps {
  payload: ReminderDuePayload;
  locale: string;
  /** The smoke harness is running: report the burst so a run can assert the effect. */
  smoke: boolean;
}

export function ReminderPopup({ payload, locale, smoke }: ReminderPopupProps): ReactElement {
  const { t } = useTranslation(['tasks']);
  const [phase, setPhase] = useState<Phase>('entering');
  // A ref rather than the state above: two clicks can land before React re-renders, and
  // the second one must not write the task twice or send a second answer.
  const answering = useRef(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  /*
   * The ease-in. The card mounts at the "entering" phase — opacity 0, slightly raised —
   * and is flipped to its resting phase on the next frame, which is what gives the
   * transition something to run *from*. Nothing here touches the window's bounds: the
   * window is created at its final size and place, and only transform and opacity move
   * (docs/ARCHITECTURE.md §7, §9.1 — the same rule the panel animates under).
   */
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(frame);
  }, []);

  // A due date is a moment the user picked; saying it back in their own locale is the
  // whole point of the popup. No "overdue" wording: a reminder normally fires *before*
  // its deadline, and comparing to the wall clock during render is not a component's job.
  const due = payload.dueAt === null ? null : formatDateTime(payload.dueAt, locale);

  const answer = async (by: 'done' | 'dismiss'): Promise<void> => {
    if (answering.current) return;
    answering.current = true;

    if (by === 'done') {
      // The effect first, and awaited: the answer is sent after it, so the write never
      // races the animation — the main process closes the window the moment it lands.
      await burst(canvas.current);
      report(smoke, 'reminder-popup-burst', { id: payload.id, taskId: payload.taskId });
    }
    setPhase('leaving');
    await new Promise((resolve) => setTimeout(resolve, EXIT_MS));

    if (by === 'done') await window.api.reminder.done(payload.id, payload.taskId);
    else await window.api.reminder.dismiss(payload.id);
  };

  return (
    <div className="window-frame flex h-full w-full p-2">
      <section
        // The names the smoke harness looks for in the DOM (§13): the popup is asserted
        // to have been drawn, not only to have been announced.
        data-field="reminder-card"
        data-reminder-id={payload.id}
        data-task-id={payload.taskId}
        data-phase={phase}
        style={{ transitionDuration: `${phase === 'leaving' ? EXIT_MS : ENTER_MS}ms` }}
        className="reminder-popup relative flex h-full w-full flex-col justify-between gap-1.5 overflow-hidden rounded-[var(--panel-radius)] border border-[var(--accent)] px-3 py-2.5 shadow-[var(--panel-shadow)]"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] font-medium text-[var(--accent-text)]">
            {t('tasks:reminder.title')}
          </span>
          <span
            className="truncate text-[13px] font-semibold text-[var(--text-primary)]"
            data-field="reminder-title"
          >
            {payload.title}
          </span>
          {due !== null && (
            <span className="truncate text-[11px] text-[var(--text-muted)]">
              {t('tasks:reminder.due', { time: due })}
            </span>
          )}
        </span>

        <span className="flex shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            data-field="reminder-dismiss"
            onClick={() => void answer('dismiss')}
            className="shrink-0 rounded-full border border-[var(--border-default)] px-3 py-1 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            {t('tasks:reminder.dismiss')}
          </button>
          <button
            type="button"
            data-field="reminder-done"
            onClick={() => void answer('done')}
            className="shrink-0 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 text-[12px] font-semibold text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-surface-muted)]"
          >
            {t('tasks:reminder.done')}
          </button>
        </span>

        {/*
         * The burst's surface. It covers the card so the spray can cross it, and is
         * inert — the buttons under it stay the only things a click can reach.
         */}
        <canvas
          ref={canvas}
          data-field="reminder-burst"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      </section>
    </div>
  );
}
