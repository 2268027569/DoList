import { StrictMode, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation, initReactI18next } from 'react-i18next';

import { DETAIL_TASK_QUERY_KEY, parseDetailTaskId } from '@shared/contracts/detail';

import { readBoot, applyBootParams } from '../../shared-ui/boot';
import { i18n, initRendererI18n } from '../../shared-ui/i18n';
import { TaskDetail } from './task-detail';
import { useDetailStore } from './store';
import './detail.css';

/**
 * The task detail window's entry (docs/FEATURES.md M02 D6).
 *
 * It is its own window and its own page, not a page of the panel: the panel is 320–640
 * DIP wide, where a form beside a readable list does not fit, and the list is where the
 * next task is picked — so the two surfaces are separate and the list is never covered.
 *
 * Like the reminder popup, which row this window opened on arrives in the query string
 * (load-renderer.ts) rather than over IPC, so the first frame is already the right task
 * instead of an empty form waiting for one. A missing or malformed id means there is
 * nothing to show — there is no default row to fall back to — so the window is left
 * empty for the main process to close.
 *
 * ICU is registered like the panel's, because the shipped strings are ICU-formatted and
 * this form interpolates several (`detail.tags.remove`, `detail.subtasks.remove`); a
 * plain i18next would hand those back with their `{name}` still in them (§8).
 */
void start();

async function start(): Promise<void> {
  const boot = readBoot();
  const taskId = parseDetailTaskId(
    new URLSearchParams(window.location.search).get(DETAIL_TASK_QUERY_KEY),
  );

  const container = document.getElementById('root');
  if (container === null) return;

  // Read before the first paint, by `readBoot` above: the surface is drawn at the stored
  // transparency so the two windows fade together rather than one arriving opaque
  // beside a translucent one (the same value the panel writes, §9.9).
  document.documentElement.style.setProperty(
    '--panel-opacity',
    String(boot.panelOpacity ?? 1),
  );

  await initRendererI18n(boot.locale, { icu: true });
  // The shared renderer instance, bound to React — the same one the panel binds.
  initReactI18next.init(i18n);

  createRoot(container).render(
    <StrictMode>
      <DetailWindow taskId={taskId} />
    </StrictMode>,
  );
}

/**
 * The window's frame: the card, its chrome, and the row load.
 *
 * The header is drawn here rather than by the form, so that it is on screen from the
 * first frame and stays on screen when there is nothing to edit — which is exactly the
 * state a failed read leaves the window in. A form that owns its own close button would
 * spend those moments as an empty box with no way out.
 *
 * The card is drawn and then brought in by the `data-phase` flip below — one frame later,
 * because a transition needs a painted state to travel from. Only opacity and transform
 * move, so the compositor does the work and the window's bounds are never touched (§7).
 */
function DetailWindow({ taskId }: { taskId: string | null }): ReactElement {
  const { t } = useTranslation('tasks');
  const open = useDetailStore((state) => state.open);
  const refresh = useDetailStore((state) => state.refresh);
  const task = useDetailStore((state) => state.task);
  const saveFailed = useDetailStore((state) => state.saveFailed);
  const [phase, setPhase] = useState<'enter' | 'open'>('enter');
  /**
   * The row this window is currently on. It starts as the one the page was opened on and
   * is re-pointed over IPC when the list picks another task — the window is reused, so
   * there is no reload and no second React mount (§9.1). The query string still carries
   * the first task, which is what makes the first frame the right one.
   */
  const [shownTaskId, setShownTaskId] = useState(taskId);

  useEffect(() => {
    // A theme change redraws this window like every other entry. It matters more here
    // than it used to: a warmed window is loaded *before* the click, so without this it
    // would keep the token set it was warmed with.
    return window.api.on.themeChanged((params) => applyBootParams(params));
  }, []);

  useEffect(() => {
    return window.api.on.detailOpen((payload) => setShownTaskId(payload.taskId));
  }, []);

  useEffect(() => {
    if (shownTaskId === null) return;
    void open(shownTaskId);
    // One write, one read, from every surface: the panel announces what changed and
    // both renderers re-read — this window re-reads the one row it is showing, which
    // is how a field saved here comes back as the stored value (M02 D4).
    return window.api.on.taskChanged(() => {
      void refresh();
    });
  }, [shownTaskId, open, refresh]);

  useEffect(() => {
    // The frame-after-frame flip the popup uses: the transition needs a painted
    // state to travel from, so the card is mounted at `enter` and raised on the
    // next frame rather than in the same commit.
    const frame = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    // Escape belongs to the window, not to the form: it has to work while the row is
    // still loading and after a read failed, the two moments there is no form to ask.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void window.api.detail.close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-full w-full p-2">
      <section
        className="detail-card flex h-full w-full flex-col overflow-hidden rounded-[var(--panel-radius)] border border-[var(--border-default)] shadow-[var(--panel-shadow)]"
        data-phase={phase}
        data-field="detail-card"
        style={{ transitionDuration: phase === 'open' ? '220ms' : '1ms' }}
      >
        {/*
         * The window's own bar: what this window is on the left, how writing behaves on
         * the right. It is the only row that never scrolls, so closing is one click away
         * however far down the form the user has read.
         */}
        <header className="flex h-11 shrink-0 items-center gap-2.5 px-3">
          <h1 className="truncate text-[12px] font-semibold text-[var(--text-secondary)]">
            {t('detail.heading')}
          </h1>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {saveFailed ? (
              <span
                className="rounded-full border border-[var(--status-overdue)] px-2 py-0.5 text-[10px] text-[var(--status-overdue)]"
                role="status"
              >
                {t('detail.saveFailed')}
              </span>
            ) : (
              // Says out loud what the form does silently (M02 D9): nothing on this
              // screen needs saving, so the absence of a save button is the design
              // rather than something to go looking for.
              <span className="text-[10px] text-[var(--text-muted)]">{t('detail.autosave')}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => void window.api.detail.close()}
            aria-label={t('detail.close')}
            data-field="detail-back"
            className="grid size-6 shrink-0 place-items-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
          >
            <CloseGlyph />
          </button>
        </header>
        <div className="h-px shrink-0 bg-[var(--border-default)]" aria-hidden="true" />

        <div className="detail-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4">
          {task === null ? (
            // Nothing to draw yet, or nothing to draw at all: the form is the whole
            // window, so there is no content of ours to keep up while it loads.
            <span className="sr-only">{t('detail.heading')}</span>
          ) : (
            // Keyed by the row so opening another task starts a fresh edit rather than
            // inheriting the last draft.
            <TaskDetail key={task.id} task={task} />
          )}
        </div>
      </section>
    </div>
  );
}

/** A 1.5px cross at 12px: a glyph rather than a character, so it centres by geometry. */
function CloseGlyph(): ReactElement {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="size-3"
    >
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
    </svg>
  );
}
