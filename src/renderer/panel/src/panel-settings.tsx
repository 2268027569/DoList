import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PANEL_OPACITY_RANGE, SETTINGS_KEY } from '@shared/contracts/settings';
import type { AppSettings } from '@shared/contracts/settings';
import { THEME_IDS } from '@shared/types/app';
import { usePanelStore } from './store';

/** The slider works in whole percents; the setting itself is a 0–1 ratio. */
const STEP_PERCENT = 5;

/** The three appearance modes, in the order the control lists them. */
const MODES = ['light', 'dark', 'system'] as const;

/**
 * The panel's own appearance control (docs/FEATURES.md M01 "面板形态" / M07 "亮暗色 +
 * 主题"): how solid the surface is, which way it reads (light / dark / follow the
 * system), and which token set draws it.
 *
 * It sits in the header rather than behind a separate settings window, because these
 * are the knobs whose effect the user has to see while operating them — the panel
 * changing colour or fading *is* the preview. The rest of the settings centre (M10)
 * reads and writes the same rows.
 *
 * The panel's other window traits are not here on purpose. It is always on top with no
 * switch (a panel that can hide behind another window defeats the point of a
 * marker-driven app), and its size is changed by dragging the corner grip.
 */
export function PanelSettings({
  opacity,
  onOpacity,
}: {
  opacity: number;
  onOpacity: (next: number) => void;
}): ReactElement {
  const { t } = useTranslation(['tasks', 'settings']);
  const theme = usePanelStore((state) => state.boot.theme);
  const [open, setOpen] = useState(false);
  /**
   * The stored *preference*, not the resolved mode: `boot.mode` is already light or
   * dark even when the user asked to follow the system, so the answered question
   * ("which of the three did I pick?") is only in the settings row. Read once — this
   * control is the only place that writes it.
   */
  const [mode, setMode] = useState<AppSettings['themeMode'] | null>(null);
  const percent = Math.round(opacity * 100);

  useEffect(() => {
    let cancelled = false;
    void window.api.settings.get(SETTINGS_KEY.app).then((result) => {
      if (cancelled || !result.ok) return;
      const settings = result.data;
      if (typeof settings === 'object' && settings !== null) setMode(settings.themeMode);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const chooseMode = (next: AppSettings['themeMode']): void => {
    setMode(next);
    // The write is what redraws every window: the main process broadcasts the new
    // boot parameters and each entry applies them (services/broadcast.ts).
    void window.api.settings.set({ themeMode: next });
  };

  const chooseTheme = (next: AppSettings['themeId']): void => {
    void window.api.settings.set({ themeId: next });
  };

  return (
    <span className="relative inline-block">
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
        // Anchored under the button rather than pushing the list down: these are
        // settings for the surface, not another row of content.
        <div
          data-field="panel-appearance"
          className="absolute right-0 top-full z-10 mt-1 flex w-60 flex-col gap-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-muted)] px-2.5 py-2.5 shadow-[var(--panel-shadow)]"
        >
          <Group label={t('settings:mode.label')}>
            {MODES.map((id) => (
              <Pill
                key={id}
                field={`panel-mode-${id}`}
                label={t(`settings:mode.${id}`)}
                active={mode === id}
                onClick={() => chooseMode(id)}
              />
            ))}
          </Group>

          <Group label={t('settings:theme.label')}>
            {THEME_IDS.map((id) => (
              <Pill
                key={id}
                field={`panel-theme-${id}`}
                label={t(`settings:theme.${id}`)}
                active={theme === id}
                onClick={() => chooseTheme(id)}
              />
            ))}
          </Group>

          <div className="flex items-center gap-2 border-t border-[var(--border-default)] pt-2.5">
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
        </div>
      )}
    </span>
  );
}

/** A labelled row of choices: the 10px caps label above, the pills below. */
function Group({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/**
 * One choice, drawn the way this app draws a single-pick control (docs/ARCHITECTURE.md
 * §9.1.3): unselected is transparent with no visible border and the hover only
 * brightens the text; the selected one is the only pill carrying the accent edge and
 * fill, so "which one is on" is answered by the shape as well as by colour.
 */
function Pill({
  field,
  label,
  active,
  onClick,
}: {
  field: string;
  label: string;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-field={field}
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
          : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {label}
    </button>
  );
}
