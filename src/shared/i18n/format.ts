/**
 * Single entry point for locale-aware formatting (docs/ARCHITECTURE.md §8).
 * Business code must never hand-roll `YYYY-MM-DD` strings.
 */

export function formatDate(
  value: Date | number,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

export function formatDateTime(
  value: Date | number,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

export function formatTime(
  value: Date | number,
  locale: string,
  options: Intl.DateTimeFormatOptions = { timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

export function formatRelative(
  value: Date | number,
  locale: string,
  now: Date | number = Date.now(),
): string {
  const target = toMillis(value);
  const base = toMillis(now);
  const deltaSeconds = (target - base) / 1000;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const units: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];

  for (const [unit, seconds] of units) {
    if (Math.abs(deltaSeconds) >= seconds) {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return formatter.format(Math.round(deltaSeconds), 'second');
}

/**
 * Relative wording for a difference measured in whole days.
 *
 * `formatRelative` picks its unit from the magnitude, so a zero difference falls
 * through to seconds and reads "now" — and a 39-hour gap rounds to "2 days ago".
 * Neither is right for a task dated by its day, which is what this helper is for:
 * it names the day ("today" / "tomorrow" / "yesterday" / "in 3 days").
 */
export function formatDayOffset(days: number, locale: string): string {
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day');
}

export function formatNumber(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/** Fallback week starts, used when `Intl.Locale` has no `weekInfo` at runtime. */
const WEEK_START_FALLBACK: Record<string, number> = {
  en: 0,
  'zh-Hans': 1,
  'zh-Hant': 0,
  ja: 0,
  ko: 0,
  es: 1,
  fr: 1,
  de: 1,
  ru: 1,
  pt: 0,
  it: 1,
  ar: 6,
  vi: 1,
  th: 0,
  id: 0,
};

interface LocaleWithWeekInfo extends Intl.Locale {
  weekInfo?: { firstDay?: number };
  getWeekInfo?: () => { firstDay?: number };
}

/** Returns 0 = Sunday … 6 = Saturday for the given locale. */
export function weekStartDay(locale: string): number {
  try {
    const localeWithWeekInfo = new Intl.Locale(locale) as LocaleWithWeekInfo;
    const firstDay =
      localeWithWeekInfo.weekInfo?.firstDay ?? localeWithWeekInfo.getWeekInfo?.().firstDay;
    if (typeof firstDay === 'number') return firstDay % 7;
  } catch {
    // Unknown locale tag: fall through to the table.
  }
  const language = locale.split('-')[0] ?? locale;
  return WEEK_START_FALLBACK[locale] ?? WEEK_START_FALLBACK[language] ?? 1;
}

function toMillis(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}
