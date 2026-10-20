import { useEffect, useState } from 'react';
import type { ReactElement, TransitionEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { BootParams } from '@shared/types/app';
import { isArchiveView } from '@shared/types/app';
import { PANEL_OPACITY_RANGE } from '@shared/contracts/settings';
import { applyBootParams } from '../../shared-ui/boot';
import { changeLocale } from '../../shared-ui/i18n';
import { PanelSettings } from './panel-settings';
import { QuickAdd } from './quick-add';
import { TaskDetail } from './task-detail';
import { TaskList } from './task-list';
import { usePanelStore } from './store';
import { usePanelOpacity } from './use-panel-opacity';
import { usePanelResize } from './use-panel-resize';
import { ViewSidebar } from './view-sidebar';
import { VIEW_COPY } from './views';

/**
 * The panel surface: either the current view's list or the open task's detail, never
 * both (M02 D6 — the panel is only 320–640 DIP wide, so the detail replaces the list
 * instead of sitting beside it). Which view the list is showing is the sidebar's
 * choice alone (M03 D1); the header only names the one that is showing.
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
  // Seeded from the boot parameter, which is where the stored value arrives (§9.9):
  // the window is drawn at the right opacity rather than faded after the first paint.
  const { opacity, setOpacity } = usePanelOpacity(boot.panelOpacity ?? PANEL_OPACITY_RANGE.max);

  useEffect(() => {
    setBoot(boot);
  }, [boot, setBoot]);

  // The surface's transparency is a variable, not a colour: the card mixes it into
  // whatever `--bg-surface` the active theme provides, so the text keeps its
  // contrast and only the panel's own background fades (panel.css).
  useEffect(() => {
    document.documentElement.style.setProperty('--panel-opacity', String(opacity));
  }, [opacity]);

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
  // itself: the view lives in the store, and the sidebar sets the same field. Opening
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
        className="panel-card relative flex h-full w-full flex-col gap-3 overflow-hidden rounded-[var(--panel-radius)] border border-[var(--border-default)] px-[var(--panel-padding)] py-[var(--panel-padding)] shadow-[var(--panel-shadow)]"
        data-phase={open ? 'open' : 'closed'}
        style={{ transitionDuration: `${durationMs}ms` }}
        onTransitionEnd={handleTransitionEnd}
      >
        {openTask === null ? (
          <>
            <header className="flex items-baseline justify-between gap-2">
              {/*
               * The current view's name, spelled out: the sidebar is icon-only, so this
               * is the one place the panel says which slice of the tasks it is showing.
               * Switching is the sidebar's job, and its only control: the two tabs that
               * used to sit here wrote the same `view` field, and two entrances to one
               * state leave the user unable to tell which of them is the current one.
               */}
              <h1
                className="truncate text-lg font-semibold tracking-tight text-[var(--text-primary)]"
                data-field="view-title"
                data-view={view}
              >
                {t(VIEW_COPY[view].name)}
              </h1>
              <span className="flex shrink-0 items-baseline gap-1">
                <span className="text-xs text-[var(--text-muted)]" data-field="view-count">
                  {t('tasks:view.count', { count: tasks.length })}
                </span>
                <PanelSettings opacity={opacity} onOpacity={setOpacity} />
              </span>
            </header>

            <div className="flex min-h-0 flex-1 gap-2">
              <ViewSidebar />

              <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden">
                {/*
                 * An archive has no quick-add (M03 D6): a "to do" typed into 已完成
                 * would be a row that view is defined not to contain, and the list's
                 * empty state says where the task belongs instead.
                 */}
                {isArchiveView(view) ? null : <QuickAdd />}

                <div className="flex-1 overflow-y-auto">
                  <TaskList />
                </div>
              </div>
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
