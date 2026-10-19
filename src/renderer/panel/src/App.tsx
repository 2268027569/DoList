import { useEffect, useState } from 'react';
import type { ReactElement, TransitionEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { BootParams } from '@shared/types/app';
import { applyBootParams } from '../../shared-ui/boot';
import { changeLocale } from '../../shared-ui/i18n';
import { QuickAdd } from './quick-add';
import { TaskDetail } from './task-detail';
import { TaskList } from './task-list';
import { usePanelStore } from './store';
import { usePanelResize } from './use-panel-resize';

/**
 * The panel surface: either the Inbox or the open task's detail, never both
 * (M02 D6 — the panel is only 320–640 DIP wide, so the detail replaces the list
 * instead of sitting beside it).
 */
export function App({ boot }: { boot: BootParams }): ReactElement {
  const { t } = useTranslation(['common', 'tasks']);
  const setBoot = usePanelStore((state) => state.setBoot);
  const setPanelState = usePanelStore((state) => state.setPanelState);
  const refreshTasks = usePanelStore((state) => state.refreshTasks);
  const refreshOpenTask = usePanelStore((state) => state.refreshOpenTask);
  const closeTaskDetail = usePanelStore((state) => state.closeTaskDetail);
  const tasks = usePanelStore((state) => state.tasks);
  const openTask = usePanelStore((state) => state.openTask);
  const [open, setOpen] = useState(false);
  const [durationMs, setDurationMs] = useState(160);
  const resize = usePanelResize();

  useEffect(() => {
    setBoot(boot);
  }, [boot, setBoot]);

  useEffect(() => {
    void refreshTasks();
    // One write, one fetch: the main process announces what changed and this is
    // what turns that into rows, rather than keeping a second copy of the data
    // in step by hand (M02 D4). The open detail is a second read, so it re-reads
    // too — a task marked done here is the only way to see its own change.
    return window.api.on.taskChanged(() => {
      void refreshTasks();
      void refreshOpenTask();
    });
  }, [refreshTasks, refreshOpenTask]);

  useEffect(() => {
    return window.api.on.panelState(({ state, durationMs: duration }) => {
      setPanelState(state);
      setDurationMs(duration);
      setOpen(state !== 'collapsing');
    });
  }, [setPanelState]);

  useEffect(() => {
    return window.api.on.themeChanged((params) => {
      applyBootParams(params);
      setBoot(params);
    });
  }, [setBoot]);

  useEffect(() => {
    return window.api.on.localeChanged(({ locale }) => {
      void changeLocale(locale);
    });
  }, []);

  // Collapse is finished when the exit animation ended, not when the timer says
  // so: the main process waits for this acknowledgement (docs/ARCHITECTURE.md §7).
  const handleTransitionEnd = (event: TransitionEvent<HTMLElement>): void => {
    if (event.propertyName !== 'transform' || open) return;
    void window.api.window.collapseFinished();
  };

  return (
    <div className="flex h-full w-full p-2">
      <section
        className="panel-card relative flex h-full w-full flex-col gap-3 overflow-hidden rounded-[var(--panel-radius)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-[var(--panel-padding)] py-[var(--panel-padding)] shadow-[var(--panel-shadow)]"
        data-phase={open ? 'open' : 'closed'}
        style={{ transitionDuration: `${durationMs}ms` }}
        onTransitionEnd={handleTransitionEnd}
      >
        {openTask === null ? (
          <>
            <header className="flex items-baseline justify-between gap-2">
              <h1 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                {t('tasks:inbox.title')}
              </h1>
              <span className="text-xs text-[var(--text-muted)]">
                {t('tasks:summary.pending', { count: tasks.length })}
              </span>
            </header>

            <QuickAdd />

            <div className="flex-1 overflow-y-auto">
              <TaskList />
            </div>
          </>
        ) : (
          // Keyed by the row so opening another task (or the same one again after
          // a deletion) starts a fresh edit rather than inheriting the last draft.
          <TaskDetail key={openTask.id} task={openTask} onBack={closeTaskDetail} />
        )}

        {/*
         * Decorative for assistive tech on purpose: the panel is resized with a
         * mouse gesture only, so there is no keyboard equivalent to advertise yet.
         * The a11y milestone owns that question.
         */}
        <span className="panel-resize" aria-hidden="true" onPointerDown={resize.onPointerDown} />
      </section>
    </div>
  );
}
