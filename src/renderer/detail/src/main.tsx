import { StrictMode, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation, initReactI18next } from 'react-i18next';

import { DETAIL_TASK_QUERY_KEY, parseDetailTaskId } from '@shared/contracts/detail';

import { readBoot } from '../../shared-ui/boot';
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
 * The window's frame: the card, its ease-in, and the row load.
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
  const [phase, setPhase] = useState<'enter' | 'open'>('enter');

  useEffect(() => {
    if (taskId === null) return;
    void open(taskId);
    // One write, one read, from every surface: the panel announces what changed and
    // both renderers re-read — this window re-reads the one row it is showing, which
    // is how a field saved here comes back as the stored value (M02 D4).
    return window.api.on.taskChanged(() => {
      void refresh();
    });
  }, [taskId, open, refresh]);

  useEffect(() => {
    // The frame-after-frame flip the popup uses: the transition needs a painted
    // state to travel from, so the card is mounted at `enter` and raised on the
    // next frame rather than in the same commit.
    const frame = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="flex h-full w-full p-2">
      <section
        className="detail-card relative flex h-full w-full flex-col overflow-hidden rounded-[var(--panel-radius)] border border-[var(--border-default)] px-[var(--panel-padding)] py-[var(--panel-padding)] shadow-[var(--panel-shadow)]"
        data-phase={phase}
        data-field="detail-card"
        style={{ transitionDuration: phase === 'open' ? '220ms' : '1ms' }}
      >
        {task === null ? (
          // Nothing to draw yet, or nothing to draw at all: the form is the whole
          // window, so there is no chrome of ours to keep up while it loads.
          <span className="sr-only">{t('detail.heading')}</span>
        ) : (
          // Keyed by the row so opening another task starts a fresh edit rather than
          // inheriting the last draft.
          <TaskDetail key={task.id} task={task} />
        )}
      </section>
    </div>
  );
}
