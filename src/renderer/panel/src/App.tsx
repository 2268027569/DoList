import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode, TransitionEvent } from 'react';
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
  const undo = usePanelStore((state) => state.undo);
  const view = usePanelStore((state) => state.view);
  const setView = usePanelStore((state) => state.setView);
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

  // The app menu's 今日 item (M02 S8) asks for a view rather than moving the window
  // itself: the view lives here, and the tabs below set the same field. Opening
  // straight onto the list keeps the detail from sitting on top of the view the
  // user just asked for.
  useEffect(() => {
    return window.api.on.panelView(({ view: next }) => {
      closeTaskDetail();
      void setView(next);
    });
  }, [closeTaskDetail, setView]);

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

  /*
   * `Ctrl+Z` takes the newest write back (M02 D7). It is handled here rather than on
   * a field because it has to work whichever control has the caret — including a
   * text field, where the browser's own undo only ever reaches that field — and it
   * has to work while the panel is showing the list or the detail.
   *
   * Two fields keep their own undo: the quick-add and the detail's text inputs are
   * where the *user's typing* lives, and a keystroke-level undo there is what the
   * caret expects. Everywhere else — the body of the panel, a chip, a button — the
   * chord means "take back the last change to the data".
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'z' && event.key !== 'Z') return;
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey) return;
      // `Ctrl+Z` inside a text field or a textarea is the field's own business.
      if (isTextField(event.target)) return;
      event.preventDefault();
      void undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo]);

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
              {/*
                * Two views, as tabs rather than a menu: there are only two, and one
                * of them is the state the app menu's 今日 item sets (M02 S8).
                */}
              <nav
                className="flex items-baseline gap-3"
                aria-label={t('tasks:view.switch')}
                data-field="view-tabs"
                data-view={view}
              >
                <ViewTab
                  field="view-inbox"
                  active={view === 'inbox'}
                  onClick={() => void setView('inbox')}
                >
                  {t('tasks:inbox.title')}
                </ViewTab>
                <ViewTab
                  field="view-today"
                  active={view === 'today'}
                  onClick={() => void setView('today')}
                >
                  {t('tasks:view.today')}
                </ViewTab>
              </nav>
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

/** True when the event came from a control that keeps its own `Ctrl+Z`. */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // `isContentEditable` is checked as well because a future notes field may be one;
  // today every editor in the panel is an input or a textarea.
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/**
 * One view in the panel's header (M02 S8). A button, not a link: it changes what is
 * already on screen and goes nowhere. The active one carries the emphasis the old
 * heading used to, so the panel keeps a single strong line at its top.
 */
function ViewTab({
  field,
  active,
  onClick,
  children,
}: {
  field: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      data-field={field}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={
        active
          ? 'text-base font-semibold tracking-tight text-[var(--text-primary)]'
          : 'text-base font-medium tracking-tight text-[var(--text-muted)] hover:text-[var(--text-primary)]'
      }
    >
      {children}
    </button>
  );
}
