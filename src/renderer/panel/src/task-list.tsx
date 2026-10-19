import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { TaskRow } from './task-row';
import { usePanelStore } from './store';

/**
 * The Inbox list (M02-PLAN §6). It renders whatever the last query returned and
 * holds no copy of its own, so `event:task-changed` → `refreshTasks` is the only
 * thing that makes it move.
 */
export function TaskList(): ReactElement {
  const { t } = useTranslation('tasks');
  const tasks = usePanelStore((state) => state.tasks);
  const status = usePanelStore((state) => state.tasksStatus);

  // What rendered is published so the smoke harness can assert that the panel
  // re-fetched and drew the new row, instead of only trusting the database (§13).
  useEffect(() => {
    void window.api.smoke.report('tasks-rendered', {
      count: tasks.length,
      titles: tasks.map((task) => task.title),
    });
  }, [tasks]);

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
