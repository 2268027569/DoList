import ICU from 'i18next-icu';
import i18next from 'i18next';

import { FALLBACK_LOCALE, LOCALES, NAMESPACES, resources } from '@shared/i18n/resources';

/**
 * The main process runs its own i18next instance for tray/menu/dialog strings
 * (docs/ARCHITECTURE.md §8); the marker additionally skips `react-i18next`.
 */
let activeLocale: string = FALLBACK_LOCALE;

export async function initI18n(locale: string): Promise<string> {
  const lng = (LOCALES as readonly string[]).includes(locale) ? locale : FALLBACK_LOCALE;
  activeLocale = lng;

  if (i18next.isInitialized) {
    await i18next.changeLanguage(lng);
    return lng;
  }

  await i18next.use(ICU).init({
    lng,
    fallbackLng: FALLBACK_LOCALE,
    resources,
    ns: [...NAMESPACES],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return lng;
}

export function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options);
}

export function currentLocale(): string {
  return activeLocale;
}
