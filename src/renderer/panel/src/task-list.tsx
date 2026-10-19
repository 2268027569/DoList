import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { dueChip } from '@shared/utils/task-due-label';

import { TaskRow } from './task-row';
import { usePanelStore } from './store';

/**
 * The Inbox list (M02-PLAN §6). It renders whatever the last query returned and
 * holds no copy of its own, so `event:task-changed` → `refreshTasks` is the only
 * thing that makes it move.
 */
export function TaskList(): ReactElement {
  const { t, i18n } = useTranslation('tasks');
  const tasks = usePanelStore((state) => state.tasks);
  const status = usePanelStore((state) => state.tasksStatus);

  // What rendered is published so the smoke harness can assert that the panel
  // re-fetched and drew the new row, instead of only trusting the database (§13).
  // The chips go with it, drawn by the same pure function the row uses, so a chip
  // the harness cannot see there cannot pass here either (M02 S4).
  //
  // Reported only once a query result is in hand: the panel mounts with an empty
  // store and draws an empty list for the frame or two before the first query
  // lands, and a harness reading that frame would be reading nothing at all.
  useEffect(() => {
    if (status !== 'ready') return;
    void window.api.smoke.report('tasks-rendered', {
      count: tasks.length,
      titles: tasks.map((task) => task.title),
      rows: tasks.map((task) => ({
        title: task.title,
        priority: task.priority,
        due: dueChip(task.dueAt, task.dueHasTime, i18n.language)?.text ?? null,
      })),
    });
  }, [tasks, status, i18n.language]);

  if (status === 'error') {
    return (
      <p className="rounded-lg bg-[var(--bg-surface-muted)] px-3 py-2 text-sm text-[var(--status-overdue)]">
        {t('list.loadFailed')}
      </p>
    );
  }

  if (tasks.length === 0) {
    return (
      <p className="rounded-lg bg-[var(--bg-surface-muted)] px-3 py-2 text-sm text-[var(--text-muted)]">
        {t('inbox.empty')}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </ul>
  );
}
