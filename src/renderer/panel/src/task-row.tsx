import { memo } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { TaskListItem, TaskPriority } from '@shared/types/task';
import { isArchiveView } from '@shared/types/app';
import type { DropEdge } from '@shared/utils/sort-order';
import { type DueChipKind, dueChip } from '@shared/utils/task-due-label';
import { allSubtasksDone, progressText } from '@shared/utils/task-tree';

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

/** The drop line, drawn as an inset shadow so nothing new enters the 500-row list. */
const DROP_EDGE_CLASS: Record<DropEdge, string> = {
  top: 'shadow-[inset_0_2px_0_var(--accent)]',
  bottom: 'shadow-[inset_0_-2px_0_var(--accent)]',
};

export interface TaskRowProps {
  task: TaskListItem;
  /** Position inside the group, which is what a move is measured from. */
  index: number;
  /** Whether this row is part of the list's multi-selection (M02 S7). */
  selected: boolean;
  /** How far this row is following the pointer while it is the one being dragged. */
  dragOffsetY: number | null;
  /** Which edge of this row a drop would land on, when this row is the target. */
  dropEdge: DropEdge | null;
  onSelect: (id: string) => void;
  onGripPointerDown: (id: string, index: number, event: ReactPointerEvent<HTMLElement>) => void;
  onGripPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onGripPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Asks for a move of `id` to `to`, clamped by the store. */
  onMove: (id: string, to: number) => void;
}

/**
 * One line of the view the panel is showing: a selection box, a done circle, the
 * title, the at-a-glance chips, a grip.
 *
 * The two archives draw the same line with less of it (M03 D5): no selection box,
 * because they hold nothing to act on in bulk, and no grip, because `sort_order` is
 * the order of the work still to be done rather than of the past.
 *
 * Memoized: its props are the task, its position, whether it is selected and the two
 * drag-related fields, all of which stay the same for a row that is neither being
 * dragged nor pointed at by the drop line. During a drag that is every row but two,
 * and a drag re-renders the list on every pointer move (TaskList).
 */
export const TaskRow = memo(function TaskRow({
  task,
  index,
  selected,
  dragOffsetY,
  dropEdge,
  onSelect,
  onGripPointerDown,
  onGripPointerMove,
  onGripPointerUp,
  onMove,
}: TaskRowProps): ReactElement {
  const { t, i18n } = useTranslation('tasks');
  const toggleTask = usePanelStore((state) => state.toggleTask);
  const openTaskDetail = usePanelStore((state) => state.openTaskDetail);
  const view = usePanelStore((state) => state.view);
  const done = task.status === 'done';
  // A cancelled row is drawn exactly like a done one — struck through and greyed —
  // because in the list's terms both mean "not to be done any more" (M03 D5).
  const finished = done || task.status === 'cancelled';
  // And in the archives the row drops the controls that are about work in progress.
  const archived = isArchiveView(view);
  const due = dueChip(task.dueAt, task.dueHasTime, i18n.language);
  const priority = PRIORITY[task.priority];
  // A parent's checklist reads as `2/3`, and turns green once it is complete — the
  // only cue in the list that a task has been broken down, without opening it.
  const progress = progressText(task.subtasks);
  const subtasksDone = allSubtasksDone(task.subtasks);

  return (
    <li
      // Alt+↑/↓ is the move without a pointer: it also works from the keyboard and
      // gives the harness a path it can take without synthesizing a drag. The
      // handler sits on the row so it answers whichever of the row's controls holds
      // the focus. `aria-keyshortcuts` announces it without drawing anything.
      onKeyDown={(event) => {
        // An archive holds no work to arrange: there is no order for a move to change.
        if (archived) return;
        if (!event.altKey) return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        onMove(task.id, index + (event.key === 'ArrowUp' ? -1 : 1));
      }}
      // The row itself answers to the task id so a caller can measure it: the
      // smoke harness aims at one row's box to drag another onto it (§13).
      data-task-id={task.id}
      aria-selected={selected}
      className={`group flex items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-[var(--bg-surface-muted)] ${
        selected ? 'bg-[var(--bg-surface-muted)]' : ''
      } ${dropEdge === null ? '' : DROP_EDGE_CLASS[dropEdge]} ${
        dragOffsetY === null ? '' : 'relative z-10 opacity-90'
      }`}
      // Only the dragged row moves, and only by transform: the rest of the list is
      // left alone so a long list costs one compositor property per frame (§9.5).
      style={dragOffsetY === null ? undefined : { transform: `translateY(${dragOffsetY}px)` }}
    >
      {/*
       * The multi-select box (M02 S7). Hidden until the row is under the pointer —
       * the list is meant to look like a list of tasks — but never hidden while it
       * is checked or focused: a control that cannot be seen cannot be used.
       *
       * An archive drops it altogether: a selection is a command waiting to be run
       * on work that is still open, and there is none of that here (M03 D5).
       */}
      {archived ? null : (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={t(selected ? 'row.deselect' : 'row.select')}
          data-field="row-select"
          data-task-id={task.id}
          onClick={() => onSelect(task.id)}
          className={`mt-0.5 size-4 shrink-0 rounded border transition-opacity ${
            selected
              ? 'border-[var(--accent)] bg-[var(--accent)] opacity-100'
              : 'border-[var(--border-strong)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
          }`}
        />
      )}

      {/*
       * The done circle. 已完成 keeps it: ticking one of its rows is how a task is
       * taken back to `todo` (M03 D5). 已取消 does not — a cancelled row is not
       * reopened by a tick but by editing it, and a circle that did something other
       * than what it says would be the list's one lying control.
       */}
      {view === 'cancelled' ? null : (
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={t(done ? 'row.markUndone' : 'row.markDone')}
          // Named for the harness, which ticks a row in 已完成 and then asserts the
          // row left the list (§13).
          data-field="row-toggle"
          data-task-id={task.id}
          onClick={() => void toggleTask(task.id, !done)}
          className={`mt-0.5 size-4 shrink-0 rounded-full border transition-colors ${
            done
              ? 'border-[var(--status-done)] bg-[var(--status-done)]'
              : 'border-[var(--border-strong)] hover:border-[var(--accent)]'
          }`}
        />
      )}

      <div className="min-w-0 flex-1">
        {/*
         * The title is the way into the detail view (M02 D6). The button carries
         * the task's own text as its accessible name, so it announces what it
         * opens instead of a label that repeats "details" for every row.
         */}
        <button
          type="button"
          onClick={() => void openTaskDetail(task.id)}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          // Named for the smoke harness, which reaches this row by name and has to
          // know which row it landed on before it presses Enter (§13).
          data-field="task-title"
          data-task-id={task.id}
          className={`block w-full text-left text-sm break-words ${
            finished ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]'
          }`}
        >
          {task.title}
        </button>

        {(due !== null || priority !== undefined || progress !== null || task.tags.length > 0) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {due !== null && <Chip color={DUE_COLOR[due.kind]}>{due.text}</Chip>}
            {priority !== undefined && <Chip color={priority.color}>{t(priority.label)}</Chip>}
            {progress !== null && (
              <Chip
                color={subtasksDone ? 'var(--status-done)' : undefined}
                // Named for the harness, which asserts the tally rather than
                // screenshotting it (§13).
                field="row-progress"
                taskId={task.id}
              >
                {progress}
              </Chip>
            )}
            {task.tags.map((tag) => (
              <Chip key={tag}>{`#${tag}`}</Chip>
            ))}
          </div>
        )}
      </div>

      {/*
       * A dedicated handle rather than "drag anywhere on the row": the title is a
       * button and the circle is a switch, and making the row itself draggable would
       * have to swallow the clicks those two need (the same trade M01 met, §9.2).
       * Hidden until the row is under the pointer, but never hidden from the
       * keyboard — a control that cannot be seen when focused is a control that
       * cannot be used.
       *
       * Gone altogether in an archive: the order a reorder writes is the manual order
       * of the work still to be done, and the archives are ordered by when rows were
       * finished (M03 D4) — a drag there would rearrange something no one will read.
       */}
      {archived ? null : (
        <button
          type="button"
          aria-label={t('row.dragHandle')}
          data-field="task-grip"
          data-task-id={task.id}
          onPointerDown={(event) => onGripPointerDown(task.id, index, event)}
          onPointerMove={onGripPointerMove}
          onPointerUp={onGripPointerUp}
          onPointerCancel={onGripPointerUp}
          className="mt-0.5 shrink-0 cursor-grab touch-none select-none rounded px-1 text-xs leading-4 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
        >
          ⋮⋮
        </button>
      )}
    </li>
  );
});

function Chip({
  color,
  field,
  taskId,
  children,
}: {
  color?: string;
  /** A `data-field` name, when the harness needs to find this chip (§13). */
  field?: string;
  /** Which row the chip belongs to, so a named chip is found on the right row. */
  taskId?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <span
      // The colour is a token name only known at runtime, so it goes through a
      // style attribute: a class built from a template is invisible to Tailwind.
      style={color === undefined ? undefined : { color }}
      data-field={field}
      data-task-id={taskId}
      className="rounded bg-[var(--bg-surface-muted)] px-1.5 py-0.5 text-[11px] leading-4 text-[var(--text-muted)]"
    >
      {children}
    </span>
  );
}
