import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { TaskPriority, TaskWithTags } from '@shared/types/task';
import { type DueChipKind, dueChip } from '@shared/utils/task-due-label';

import { usePanelStore } from './store';

/** Priority 0 means "none" and draws nothing; the rest name a colour and a label. */
const PRIORITY: Partial<Record<TaskPriority, { label: string; color: string }>> = {
  1: { label: 'priority.low', color: 'var(--priority-low)' },
  2: { label: 'priority.medium', color: 'var(--priority-medium)' },
  3: { label: 'priority.high', color: 'var(--priority-high)' },
};

/** Chip colours, all semantic tokens — never literals (§7, check-tokens.mjs). */
const DUE_COLOR: Record<DueChipKind, string> = {
  overdue: 'var(--status-overdue)',
  today: 'var(--status-warning)',
  later: 'var(--text-muted)',
};

/** One line of the Inbox: a done circle, the title, and the at-a-glance chips. */
export function TaskRow({ task }: { task: TaskWithTags }): ReactElement {
  const { t, i18n } = useTranslation('tasks');
  const toggleTask = usePanelStore((state) => state.toggleTask);
  const openTaskDetail = usePanelStore((state) => state.openTaskDetail);
  const done = task.status === 'done';
  const due = dueChip(task.dueAt, task.dueHasTime, i18n.language);
  const priority = PRIORITY[task.priority];

  return (
    <li className="flex items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-[var(--bg-surface-muted)]">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={t(done ? 'row.markUndone' : 'row.markDone')}
        onClick={() => void toggleTask(task.id, !done)}
        className={`mt-0.5 size-4 shrink-0 rounded-full border transition-colors ${
          done
            ? 'border-[var(--status-done)] bg-[var(--status-done)]'
            : 'border-[var(--border-strong)] hover:border-[var(--accent)]'
        }`}
      />

      <div className="min-w-0 flex-1">
        {/*
         * The title is the way into the detail view (M02 D6). The button carries
         * the task's own text as its accessible name, so it announces what it
         * opens instead of a label that repeats "details" for every row.
         */}
        <button
          type="button"
          onClick={() => void openTaskDetail(task.id)}
          // Named for the smoke harness, which reaches this row by keyboard and
          // has to know which row it landed on before it presses Enter (§13).
          data-field="task-title"
          data-task-id={task.id}
          className={`block w-full text-left text-sm break-words ${
            done ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]'
          }`}
        >
          {task.title}
        </button>

        {(due !== null || priority !== undefined || task.tags.length > 0) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {due !== null && <Chip color={DUE_COLOR[due.kind]}>{due.text}</Chip>}
            {priority !== undefined && <Chip color={priority.color}>{t(priority.label)}</Chip>}
            {task.tags.map((tag) => (
              <Chip key={tag}>{`#${tag}`}</Chip>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function Chip({ color, children }: { color?: string; children: ReactNode }): ReactElement {
  return (
    <span
      // The colour is a token name only known at runtime, so it goes through a
      // style attribute: a class built from a template is invisible to Tailwind.
      style={color === undefined ? undefined : { color }}
      className="rounded bg-[var(--bg-surface-muted)] px-1.5 py-0.5 text-[11px] leading-4 text-[var(--text-muted)]"
    >
      {children}
    </span>
  );
}
