import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { dropEdge, landingIndex } from '@shared/utils/sort-order';
import { dueChip } from '@shared/utils/task-due-label';
import { progressText } from '@shared/utils/task-tree';

import { TaskRow } from './task-row';
import { usePanelStore } from './store';

/** A row's band, measured when the drag starts. */
interface RowBand {
  top: number;
  height: number;
}

/** The drag in flight: what is moving, where from, and where it would land. */
interface DragState {
  id: string;
  from: number;
  to: number;
  offsetY: number;
}

/**
 * The Inbox list (M02-PLAN §6). It renders whatever the last query returned and
 * holds no copy of its own, so `event:task-changed` → `refreshTasks` is the only
 * thing that makes it move.
 *
 * Reordering is the list's own job (M02 S5): a pointer drag on a row's grip, and
 * `Alt+↑/↓` for the keyboard. Both end in the one `moveTask`, which writes the
 * group's order back (M02 D3); neither keeps an optimistic order of its own, so
 * the drawn sequence is still whatever the main process says it is.
 *
 * The drag is pointer based rather than HTML5 draggable: the ghost image of a
 * `draggable` row is a bitmap of the whole list on a transparent window, and the
 * drop target math would still have to be written by hand. Pointer capture is the
 * approach M01 already proved here (§9.2), and it keeps the whole gesture inside
 * the renderer.
 */
export function TaskList(): ReactElement {
  const { t, i18n } = useTranslation('tasks');
  const tasks = usePanelStore((state) => state.tasks);
  const status = usePanelStore((state) => state.tasksStatus);
  const moveTask = usePanelStore((state) => state.moveTask);

  const listRef = useRef<HTMLUListElement>(null);
  /** The live gesture. A ref, not state: it must be current on the very next event. */
  const session = useRef<{
    id: string;
    from: number;
    startY: number;
    bands: RowBand[];
  } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  /**
   * Set before a keyboard move. React detaches and re-attaches a row when the order
   * changes, and a detached element loses focus with it — without this, the second
   * `Alt+↓` would go nowhere.
   */
  const pendingFocus = useRef<string | null>(null);

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
        // The subtask tally goes with the row report for the same reason the chips
        // do: it is drawn by a pure function, and one the harness cannot read here
        // cannot pass there either.
        progress: progressText(task.subtasks),
      })),
    });
  }, [tasks, status, i18n.language]);

  useEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    pendingFocus.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-field="task-title"][data-task-id="${id}"]`)
      ?.focus();
  }, [tasks]);

  // The row handlers are memoized because a drag re-renders this component on every
  // pointer move. With stable props only the row being dragged — and the one the
  // drop line is drawn on — re-render; the rest are skipped, so the list costs a
  // couple of compositor properties per frame rather than one row per task (§9.5).
  const onMove = useCallback(
    (id: string, to: number): void => {
      pendingFocus.current = id;
      void moveTask(id, to).then((moved) => {
        // Nothing moved means no re-render is coming to consume the request.
        if (!moved) pendingFocus.current = null;
      });
    },
    [moveTask],
  );

  const onGripPointerDown = useCallback(
    (id: string, index: number, event: ReactPointerEvent<HTMLElement>): void => {
      const list = listRef.current;
      if (list === null) return;
      // Keeps the gesture from also starting a text selection or a native drag.
      event.preventDefault();

      // Measured once, at the start: the row being dragged is about to be translated
      // out of its own place, so bands read later would chase it.
      const bands = [...list.children].map((row) => {
        const rect = row.getBoundingClientRect();
        return { top: rect.top, height: rect.height };
      });

      session.current = { id, from: index, startY: event.clientY, bands };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ id, from: index, to: index, offsetY: 0 });
    },
    [],
  );

  const onGripPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    const active = session.current;
    if (active === null) return;
    setDrag({
      id: active.id,
      from: active.from,
      to: landingIndex(active.bands, event.clientY),
      offsetY: event.clientY - active.startY,
    });
  }, []);

  const onGripPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const active = session.current;
      if (active === null) return;
      session.current = null;
      setDrag(null);

      const to = landingIndex(active.bands, event.clientY);
      if (to !== active.from) void moveTask(active.id, to);
    },
    [moveTask],
  );

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
    <ul ref={listRef} className="flex flex-col gap-0.5">
      {tasks.map((task, index) => (
        <TaskRow
          key={task.id}
          task={task}
          index={index}
          dragOffsetY={drag !== null && drag.id === task.id ? drag.offsetY : null}
          dropEdge={dropEdge(drag, index)}
          onGripPointerDown={onGripPointerDown}
          onGripPointerMove={onGripPointerMove}
          onGripPointerUp={onGripPointerUp}
          onMove={onMove}
        />
      ))}
    </ul>
  );
}
