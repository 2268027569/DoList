import i18next from 'i18next';

import { FALLBACK_LOCALE, LOCALES, NAMESPACES, resources } from '@shared/i18n/resources';

/**
 * Renderer-side i18n. The marker uses this instance directly (no React), the
 * panel additionally binds `react-i18next` to it in its own entry.
 *
 * ICU is loaded lazily and only for the panel: it is the heaviest part of the
 * i18n stack and the marker, which has no plural or ordinal strings, never
 * pulls the chunk (docs/ARCHITECTURE.md §2, §8).
 */
export const i18n = i18next;

let icuRegistered = false;

export interface I18nInitOptions {
  /** Register the ICU formatter before initialising. */
  icu?: boolean;
}

export async function initRendererI18n(
  locale: string,
  options: I18nInitOptions = {},
): Promise<void> {
  if (options.icu === true && !icuRegistered) {
    const { default: ICU } = await import('i18next-icu');
    i18n.use(ICU);
    icuRegistered = true;
  }

  if (i18n.isInitialized) {
    await i18n.changeLanguage(shipped(locale));
    return;
  }

  await i18n.init({
    lng: shipped(locale),
    fallbackLng: FALLBACK_LOCALE,
    resources,
    ns: [...NAMESPACES],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export async function changeLocale(locale: string): Promise<void> {
  await i18n.changeLanguage(shipped(locale));
}

export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

function shipped(locale: string): string {
  return (LOCALES as readonly string[]).includes(locale) ? locale : FALLBACK_LOCALE;
}
