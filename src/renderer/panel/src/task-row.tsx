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
 * One line of the view the panel is showing: a selection bar, a done circle, the
 * title, the at-a-glance chips, a pencil, a grip.
 *
 * The two leading controls answer two different questions, and they are drawn so that
 * they cannot be mistaken for one another: the *bar* at the very edge is the row's
 * multi-select (a mark in the margin, the way a list on paper is ticked off in bulk),
 * the *circle* is the task itself being done, and it draws a check when it is. A square
 * beside a circle asked the user to read the difference from shape alone; a bar in the
 * margin is not where a "done" mark would ever be.
 *
 * The archives draw the same line with less of it (M03 D5): no selection bar, because
 * they hold nothing to act on in bulk, and no grip, because `sort_order` is the order of
 * the work still to be done rather than of the past.
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
       * The row's multi-select (M02 S7), drawn as a bar in the margin rather than a
       * box beside the circle. It used to be a square, and a square next to a circle
       * is a difference the eye has to work out; a filled bar at the very edge of the
       * row reads as "this one is marked", which is what the bulk commands act on.
       *
       * Curious/uncertain is impossible here on purpose, so the two states say
       * different things at a glance: nothing at rest, a faint rail under the pointer,
       * a solid accent bar once it is selected — and it carries a tick, since a
       * selection is a deliberate act and deserves to be unmistakable.
       *
       * An archive drops it altogether: a selection is a command waiting to be run on
       * work that is still open, and there is none of that here (M03 D5).
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
          className={`mt-px -ml-0.5 flex h-5 w-3 shrink-0 items-center justify-center rounded-full transition-opacity ${
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
          }`}
        >
          <span
            aria-hidden="true"
            className={`block w-[3px] rounded-full transition-colors ${
              selected
                ? 'h-4 bg-[var(--accent)]'
                : 'h-2.5 bg-[var(--border-strong)] group-hover:h-4'
            }`}
          />
        </button>
      )}

      {/*
       * The done circle. 已完成 keeps it: ticking one of its rows is how a task is
       * taken back to `todo` (M03 D5). 已取消 does not — a cancelled row is not
       * reopened by a tick but by editing it, and a circle that did something other
       * than what it says would be the list's one lying control.
       *
       * A tick is drawn inside it once it is done: the fill alone reads as "switched
       * on", and the mark is what makes the row say what happened to it.
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
          className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors ${
            done
              ? 'border-[var(--status-done)] bg-[var(--status-done)] text-[var(--bg-surface)]'
              : 'border-[var(--border-strong)] hover:border-[var(--accent)]'
          }`}
        >
          {done && <CheckGlyph />}
        </button>
      )}

      <div className="min-w-0 flex-1">
        {/*
         * The title is the way into the detail view (M02 D6), as is the pencil at the
         * end of the row. The button carries the task's own text as its accessible
         * name, so it announces what it opens instead of a label that repeats
         * "details" for every row.
         */}
        <button
          type="button"
          onClick={() => void window.api.detail.open(task.id)}
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
       * The edit button: the same door as clicking the title, put where the eye goes
       * when the user is looking for a way to change the row rather than read it. It
       * sits beside the grip because both are row *actions* rather than row content,
       * and it is hover-revealed for the same reason: a list of tasks should look like
       * a list of tasks until the pointer is on one of them.
       *
       * Kept in the archives too: editing a finished task (its note, its tags, putting
       * it back) is exactly what the archive is for.
       */}
      <button
        type="button"
        aria-label={t('row.edit')}
        title={t('row.edit')}
        data-field="task-edit"
        data-task-id={task.id}
        onClick={() => void window.api.detail.open(task.id)}
        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--text-primary)] focus-visible:opacity-100"
      >
        <PencilGlyph />
      </button>

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

/** The mark inside a finished row's circle. Stroked in `currentColor`, so the theme decides. */
function CheckGlyph(): ReactElement {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-2.5"
    >
      <path d="M2.5 6.2l2.3 2.3 4.7-4.9" />
    </svg>
  );
}

/** The pencil that opens the detail window — the same door as the title. */
function PencilGlyph(): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3"
    >
      <path d="M11.2 2.4l2.4 2.4-8 8-3.2.8.8-3.2z" />
    </svg>
  );
}
