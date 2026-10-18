import enCommon from '@locales/en/common.json';
import zhHansCommon from '@locales/zh-Hans/common.json';

/**
 * Marker copy resolved without the i18n runtime (docs/ARCHITECTURE.md §2).
 *
 * The marker window is the only window that is never destroyed, so it must not
 * pull i18next onto the always-resident path just to render one tooltip. The
 * handful of keys it needs are imported directly and read as plain properties.
 *
 * `zh-Hans` is assigned under the `en` shape, so a key missing from any shipped
 * locale fails `npm run typecheck`. Every key used here is also mirrored in
 * `locales/static-keys.json`, which `npm run i18n:check` verifies against each
 * locale file at runtime-independent build time.
 */
type MarkerCopy = typeof enCommon;

export type MarkerLabelKey = keyof MarkerCopy;

const fallback: MarkerCopy = enCommon;

const bundles: Record<string, MarkerCopy> = {
  en: enCommon,
  'zh-Hans': zhHansCommon,
};

/** Looks up a marker string, falling back to English for unknown locales. */
export function markerLabel(locale: string, key: MarkerLabelKey): string {
  return (bundles[locale] ?? fallback)[key];
}
