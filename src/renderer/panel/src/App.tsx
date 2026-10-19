import { useEffect, useState } from 'react';
import type { ReactElement, TransitionEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { BootParams } from '@shared/types/app';
import { applyBootParams } from '../../shared-ui/boot';
import { changeLocale } from '../../shared-ui/i18n';
import { QuickAdd } from './quick-add';
import { TaskList } from './task-list';
import { usePanelStore } from './store';
import { usePanelResize } from './use-panel-resize';

/**
 * The panel surface: the Inbox, with quick add on top (M02-PLAN §6). The M0
 * settings block that used to live here was scaffolding proving the theme and
 * locale token pipeline; those controls belong to M06/M07/M10, and the task data
 * has arrived, so the shell itself is what got replaced.
 */
export function App({ boot }: { boot: BootParams }): ReactElement {
  const { t } = useTranslation(['common', 'tasks']);
  const setBoot = usePanelStore((state) => state.setBoot);
  const setPanelState = usePanelStore((state) => state.setPanelState);
  const refreshTasks = usePanelStore((state) => state.refreshTasks);
  const tasks = usePanelStore((state) => state.tasks);
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
    // in step by hand (M02 D4).
    return window.api.on.taskChanged(() => {
      void refreshTasks();
    });
  }, [refreshTasks]);

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
