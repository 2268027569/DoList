import { app, nativeTheme } from 'electron';

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  appSettingsSchema,
} from '@shared/contracts/settings';
import type { AppSettings, AppSettingsPatch } from '@shared/contracts/settings';
import { markerAnchorSchema } from '@shared/contracts/schemas';
import { FALLBACK_LOCALE, LOCALES } from '@shared/i18n/resources';
import type { BootParams, MarkerAnchor, ThemeMode } from '@shared/types/app';
import { readRawSetting, writeRawSetting } from '../db/repositories/settings';
import { createLogger } from '../logger';
import { windowGlassSupported } from '../platform/window-material';

const log = createLogger('services/settings');

let cached: AppSettings | null = null;

export function appSettings(): AppSettings {
  if (cached !== null) return cached;
  const raw = readRawSetting(SETTINGS_KEY.app);
  if (raw === undefined) {
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }
  const parsed = appSettingsSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    log('stored settings were invalid, falling back to defaults', parsed.error.issues);
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }
  cached = parsed.data;
  return cached;
}

export function updateAppSettings(patch: AppSettingsPatch): AppSettings {
  const merged = appSettingsSchema.parse({ ...appSettings(), ...patch });
  cached = merged;
  writeRawSetting(SETTINGS_KEY.app, JSON.stringify(merged), Date.now());
  log('settings updated', patch);
  return merged;
}

export function resolveThemeMode(setting: AppSettings['themeMode']): ThemeMode {
  if (setting === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return setting;
}

/**
 * Puts the OS on the same side as the app, so the window material behind the cards
 * is drawn in the tint the cards are drawn in.
 *
 * Windows builds the acrylic backdrop from the system (or per-window) dark-mode
 * flag, and Electron takes that flag from `nativeTheme`. Without this, choosing the
 * dark theme on a light desktop would put a dark card over light glass — the surface
 * reads as washed-out grey instead of glass. `system` is passed through unchanged,
 * because that is exactly what the setting asks for.
 */
export function applyNativeTheme(): void {
  nativeTheme.themeSource = appSettings().themeMode;
}

/** Locale resolution order: stored setting -> OS locale -> fallback (§8). */
export function resolveLocale(setting: string): string {
  if (isShipped(setting)) return setting;

  const system = app.getLocale();
  if (isShipped(system)) return system;

  const lower = system.toLowerCase();
  if (lower.startsWith('zh')) {
    // zh-Hant ships with M06; until then Traditional Chinese falls back to English.
    return /(hant|tw|hk|mo)/.test(lower) ? FALLBACK_LOCALE : 'zh-Hans';
  }
  if (lower.startsWith('en')) return 'en';
  return FALLBACK_LOCALE;
}

export function resolveBoot(smoke: boolean): BootParams {
  const settings = appSettings();
  const boot: BootParams = {
    mode: resolveThemeMode(settings.themeMode),
    theme: settings.themeId,
    locale: resolveLocale(settings.locale),
    panelOpacity: settings.panelOpacity,
    // Not a setting: the OS either can draw a backdrop or it cannot. The renderers
    // need the answer before their first paint, because a glass window has no margin
    // for the card's shadow and fills the whole window (§7).
    glass: windowGlassSupported(),
  };
  if (smoke) boot.smoke = true;
  return boot;
}

export function readMarkerAnchor(): MarkerAnchor | null {
  const raw = readRawSetting(SETTINGS_KEY.markerAnchor);
  if (raw === undefined) return null;
  const parsed = markerAnchorSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    log('stored marker anchor was invalid, falling back to the default position');
    return null;
  }
  return parsed.data;
}

export function writeMarkerAnchor(anchor: MarkerAnchor): void {
  writeRawSetting(SETTINGS_KEY.markerAnchor, JSON.stringify(anchor), Date.now());
}

function isShipped(locale: string): boolean {
  return (LOCALES as readonly string[]).includes(locale);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
