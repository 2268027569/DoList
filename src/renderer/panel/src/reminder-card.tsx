import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '@shared/i18n/format';
import { usePanelStore } from './store';

/**
 * The reminder card (docs/FEATURES.md M04).
 *
 * The second half of a two-step delivery: the OS notification speaks first, and this
 * takes over only when that one went unanswered for a few minutes. It sits at the top
 * of the panel, above the list or the open detail, because the panel is the app's only
 * window and the card has to be readable without the user having to find it.
 *
 * It is drawn from the payload rather than by reading the reminder back: the card is a
 * notification, not a view of the data, and the main process has already looked up the
 * two things it says. The only write it makes is the answer, which is the one thing
 * the main process cannot observe for itself.
 *
 * Two ways out, and no third: 完成 is the same write the list's checkbox makes, and
 * 知道了 puts the card away without touching the task. There is no "snooze" yet — the
 * column is in place for one (P2), and a button that says it without meaning it would
 * be worse than not having it.
 */
export function ReminderCard(): ReactElement | null {
  const { t } = useTranslation(['tasks']);
  const reminder = usePanelStore((state) => state.dueReminder);
  const locale = usePanelStore((state) => state.boot.locale);
  const answerReminder = usePanelStore((state) => state.answerReminder);

  if (reminder === null) return null;

  // A due date is a moment the user picked; saying it back in their own locale is the
  // whole point of the card, which is why the row's raw value is not what is drawn.
  // No "overdue" wording: a reminder normally fires *before* its deadline, so the card
  // is about something still ahead, and comparing to the wall clock during render is
  // not something a component should do anyway.
  const due = reminder.dueAt === null ? null : formatDateTime(reminder.dueAt, locale);

  return (
    <section
      // The name the smoke harness looks for in the DOM (§13): the card is asserted to
      // be on screen, not only to have been sent.
      data-field="reminder-card"
      data-reminder-id={reminder.id}
      data-task-id={reminder.taskId}
      className="flex shrink-0 items-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-2"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[11px] font-medium text-[var(--text-muted)]">
          {t('tasks:reminder.title')}
        </span>
        <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
          {reminder.title}
        </span>
        {due !== null && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {t('tasks:reminder.due', { time: due })}
          </span>
        )}
      </span>

      <button
        type="button"
        data-field="reminder-done"
        onClick={() => void answerReminder('done')}
        className="shrink-0 rounded-full border border-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface-muted)]"
      >
        {t('tasks:reminder.done')}
      </button>
      <button
        type="button"
        data-field="reminder-dismiss"
        onClick={() => void answerReminder('dismiss')}
        className="shrink-0 rounded-full border border-[var(--border-default)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
      >
        {t('tasks:reminder.dismiss')}
      </button>
    </section>
  );
}
