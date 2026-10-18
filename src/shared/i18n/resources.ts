import enCommon from '@locales/en/common.json';
import enErrors from '@locales/en/errors.json';
import enSettings from '@locales/en/settings.json';
import enTasks from '@locales/en/tasks.json';
import zhHansCommon from '@locales/zh-Hans/common.json';
import zhHansErrors from '@locales/zh-Hans/errors.json';
import zhHansSettings from '@locales/zh-Hans/settings.json';
import zhHansTasks from '@locales/zh-Hans/tasks.json';

/**
 * Locale bundles (docs/ARCHITECTURE.md §8). Namespaces stay small and domain
 * scoped; `npm run i18n:check` compares key sets across every shipped locale.
 *
 * The namespace list grows with the modules that need it: `lists` lands with M03,
 * `notifications` with M04 and `onboarding` with M03's first-run flow.
 */
export const LOCALES = ['en', 'zh-Hans'] as const;
export type Locale = (typeof LOCALES)[number];

export const NAMESPACES = ['common', 'tasks', 'settings', 'errors'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const FALLBACK_LOCALE: Locale = 'en';

export const resources = {
  en: {
    common: enCommon,
    tasks: enTasks,
    settings: enSettings,
    errors: enErrors,
  },
  'zh-Hans': {
    common: zhHansCommon,
    tasks: zhHansTasks,
    settings: zhHansSettings,
    errors: zhHansErrors,
  },
} as const;

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
