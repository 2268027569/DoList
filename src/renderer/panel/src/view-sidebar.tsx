import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { usePanelStore } from './store';
import { ViewIcon } from './view-icon';
import { VIEW_COPY, VIEW_ORDER } from './views';

/**
 * The panel's view switcher: a 48 DIP strip of icons down the list's side
 * (docs/M03-PLAN.md D1).
 *
 * A narrow strip rather than a wide sidebar or a slide-out drawer. The panel is
 * 320–640 DIP wide, and a second column of text would leave neither column readable —
 * the wall M02 D6 met when it made the detail a full-screen replacement instead of a
 * pane. 48 DIP is the smallest width that still holds a 32 DIP target, and it is
 * always visible, so switching views costs no extra click and hides nothing.
 *
 * The icons carry no counts: six of them would mean six queries every time the panel
 * opens, to say what the header already says for the one view being read.
 */
export function ViewSidebar(): ReactElement {
  const { t } = useTranslation('tasks');
  const view = usePanelStore((state) => state.view);
  const setView = usePanelStore((state) => state.setView);

  return (
    <nav
      className="flex w-12 shrink-0 flex-col items-center gap-1"
      aria-label={t('view.switch')}
      data-field="view-sidebar"
    >
      {VIEW_ORDER.map((id) => {
        const active = id === view;
        const name = t(VIEW_COPY[id].name);
        return (
          <button
            key={id}
            type="button"
            data-field={`view-${id}`}
            data-view={id}
            // The strip is icon-only, so the name has to come from somewhere: the
            // tooltip and the accessible name are the same sentence, and the drawing
            // itself is `aria-hidden`.
            title={name}
            aria-label={name}
            // Which view is showing — a highlighted icon is a colour, and a colour is
            // not information. It is also the cheapest thing for the smoke harness to
            // read the current view off (§13).
            aria-current={active ? 'page' : undefined}
            onClick={() => void setView(id)}
            className={`flex size-8 shrink-0 items-center justify-center rounded-md transition-colors ${
              active
                ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <ViewIcon view={id} />
          </button>
        );
      })}
    </nav>
  );
}
