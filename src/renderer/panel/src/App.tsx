import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode, TransitionEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppSettings } from '@shared/contracts/settings';
import type { BootParams, ThemeId } from '@shared/types/app';
import { applyBootParams } from '../../shared-ui/boot';
import { changeLocale } from '../../shared-ui/i18n';
import { usePanelStore } from './store';

const THEMES: readonly ThemeId[] = ['minimal', 'graphite'];
const MODES = ['light', 'dark', 'system'] as const;
const LOCALES = ['en', 'zh-Hans'] as const;

/**
 * M0 shell. Everything here is scaffolding around the window contract; task
 * lists arrive with M02/M03. The settings block is real, though: it is what
 * proves the theme/locale token pipeline end to end (§7, §8).
 */
export function App({ boot }: { boot: BootParams }): ReactElement {
  const { t } = useTranslation(['common', 'settings']);
  const setBoot = usePanelStore((state) => state.setBoot);
  const setPanelState = usePanelStore((state) => state.setPanelState);
  const currentBoot = usePanelStore((state) => state.boot);
  const [open, setOpen] = useState(false);
  const [durationMs, setDurationMs] = useState(160);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);

  useEffect(() => {
    setBoot(boot);
  }, [boot, setBoot]);

  useEffect(() => {
    void window.api.settings.get('app.settings').then((value) => {
      if (isAppSettings(value)) setAlwaysOnTop(value.panelAlwaysOnTop);
    });
  }, []);

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
        className="panel-card flex h-full w-full flex-col gap-4 overflow-hidden rounded-[var(--panel-radius)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-[var(--panel-padding)] py-[var(--panel-padding)] shadow-[var(--panel-shadow)]"
        data-phase={open ? 'open' : 'closed'}
        style={{ transitionDuration: `${durationMs}ms` }}
        onTransitionEnd={handleTransitionEnd}
      >
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            {t('app.name')}
          </h1>
          <span className="text-xs text-[var(--text-muted)]">
            {t('settings:about.version', { version: '0.1.0' })}
          </span>
        </header>

        <p className="rounded-lg bg-[var(--bg-surface-muted)] px-3 py-2 text-sm text-[var(--text-secondary)]">
          {t('panel.demo.notice')}
        </p>

        <div className="flex flex-1 flex-col gap-3 overflow-hidden">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">{t('settings:title')}</h2>

          <Row label={t('settings:language.label')}>
            {LOCALES.map((locale) => (
              <Chip
                key={locale}
                active={currentBoot.locale === locale}
                onClick={() => {
                  void window.api.i18n.setLocale(locale);
                  void changeLocale(locale);
                }}
              >
                {locale}
              </Chip>
            ))}
          </Row>

          <Row label={t('settings:theme.label')}>
            {THEMES.map((theme) => (
              <Chip
                key={theme}
                active={currentBoot.theme === theme}
                onClick={() => void window.api.settings.set({ themeId: theme })}
              >
                {t(`settings:theme.${theme}`)}
              </Chip>
            ))}
          </Row>

          <Row label={t('settings:mode.label')}>
            {MODES.map((mode) => (
              <Chip
                key={mode}
                active={currentBoot.mode === mode}
                onClick={() => void window.api.settings.set({ themeMode: mode })}
              >
                {t(`settings:mode.${mode}`)}
              </Chip>
            ))}
          </Row>

          <Row label={t('settings:alwaysOnTop.label')}>
            <Chip
              active={alwaysOnTop}
              onClick={() => {
                const next = !alwaysOnTop;
                setAlwaysOnTop(next);
                void window.api.settings.set({ panelAlwaysOnTop: next });
                void window.api.window.setAlwaysOnTop(next);
              }}
            >
              {t(alwaysOnTop ? 'settings:alwaysOnTop.on' : 'settings:alwaysOnTop.off')}
            </Chip>
          </Row>
        </div>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <div className="flex flex-wrap items-center justify-end gap-1">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
          : 'border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
      }`}
    >
      {children}
    </button>
  );
}

function isAppSettings(value: unknown): value is AppSettings {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { panelAlwaysOnTop?: unknown };
  return typeof candidate.panelAlwaysOnTop === 'boolean';
}
