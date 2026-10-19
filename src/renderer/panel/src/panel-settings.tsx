import { useState } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { PANEL_OPACITY_RANGE } from '@shared/contracts/settings';

/** The slider works in whole percents; the setting itself is a 0–1 ratio. */
const STEP_PERCENT = 5;

/**
 * The panel's own appearance control (docs/FEATURES.md M01 "面板形态"): one
 * slider for how solid the surface is. It sits in the header rather than behind a
 * separate settings window, because it is the one knob whose effect the user has
 * to see while dragging it — the panel fading is the preview.
 *
 * The panel's other window traits are not here on purpose. It is always on top
 * with no switch (a panel that can hide behind another window defeats the point of
 * a marker-driven app), and its size is changed by dragging the corner grip.
 * Everything else belongs to the settings window (M10), which will read and write
 * the same `panelOpacity` field.
 */
export function PanelSettings({
  opacity,
  onOpacity,
}: {
  opacity: number;
  onOpacity: (next: number) => void;
}): ReactElement {
  const { t } = useTranslation(['tasks', 'settings']);
  const [open, setOpen] = useState(false);
  const percent = Math.round(opacity * 100);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('tasks:appearance.open')}
        aria-expanded={open}
        data-field="panel-settings"
        onClick={() => setOpen((current) => !current)}
        className="rounded-md px-1.5 py-0.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
      >
        ◐
      </button>

      {open && (
        // Anchored under the button rather than pushing the list down: it is a
        // setting for the surface, not another row of content. The card does not
        // clip it — the row stays inside the card's own box.
        <div
          data-field="panel-appearance"
          className="absolute right-0 top-full z-10 mt-1 flex w-56 items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-muted)] px-2.5 py-2 shadow-[var(--panel-shadow)]"
        >
          <label
            htmlFor="panel-opacity"
            className="shrink-0 text-xs text-[var(--text-secondary)]"
          >
            {t('settings:opacity.label')}
          </label>
          <input
            id="panel-opacity"
            type="range"
            data-field="panel-opacity"
            min={Math.round(PANEL_OPACITY_RANGE.min * 100)}
            max={Math.round(PANEL_OPACITY_RANGE.max * 100)}
            step={STEP_PERCENT}
            value={percent}
            onChange={(event) => onOpacity(Number(event.target.value) / 100)}
            className="h-1 min-w-0 flex-1 accent-[var(--accent)]"
          />
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-[var(--text-secondary)]">
            {percent}%
          </span>
        </div>
      )}
    </div>
  );
}
