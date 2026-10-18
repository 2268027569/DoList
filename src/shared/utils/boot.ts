import { THEME_IDS } from '../types/app';
import type { BootParams, ThemeMode } from '../types/app';

/**
 * Boot parameters travel from the main process to the renderers as a query
 * string, because they must be readable synchronously (before the first paint)
 * with no IPC round trip — see docs/ARCHITECTURE.md §7 "防闪白".
 */
export const DEFAULT_BOOT: BootParams = { mode: 'light', theme: 'minimal', locale: 'en' };

const MODES: readonly ThemeMode[] = ['light', 'dark'];

function isThemeId(value: string | null): value is BootParams['theme'] {
  return value !== null && (THEME_IDS as readonly string[]).includes(value);
}

function isMode(value: string | null): value is ThemeMode {
  return value !== null && (MODES as readonly string[]).includes(value);
}

function isLocale(value: string | null): value is string {
  return value !== null && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value);
}

export function parseBootParams(search: string): BootParams {
  const params = new URLSearchParams(search);
  const mode = params.get('mode');
  const theme = params.get('theme');
  const locale = params.get('locale');
  const parsed: BootParams = {
    mode: isMode(mode) ? mode : DEFAULT_BOOT.mode,
    theme: isThemeId(theme) ? theme : DEFAULT_BOOT.theme,
    locale: isLocale(locale) ? locale : DEFAULT_BOOT.locale,
  };
  if (params.get('smoke') === '1') parsed.smoke = true;
  return parsed;
}

export function bootQuery(params: BootParams): Record<string, string> {
  const query: Record<string, string> = {
    mode: params.mode,
    theme: params.theme,
    locale: params.locale,
  };
  if (params.smoke) query['smoke'] = '1';
  return query;
}
