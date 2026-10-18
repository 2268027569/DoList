import { THEME_IDS } from '../types/app';
import type {
  BootParams,
  MarkerAppearance,
  MarkerBadgeMode,
  MarkerShape,
  MarkerTint,
  ThemeMode,
} from '../types/app';
import { MARKER_SCALE } from './marker-geometry';

/**
 * Boot parameters travel from the main process to the renderers as a query
 * string, because they must be readable synchronously (before the first paint)
 * with no IPC round trip — see docs/ARCHITECTURE.md §7 "防闪白".
 */
export const DEFAULT_BOOT: BootParams = { mode: 'light', theme: 'minimal', locale: 'en' };

const MODES: readonly ThemeMode[] = ['light', 'dark'];
const MARKER_SHAPES: readonly MarkerShape[] = ['dot', 'pill', 'icon'];
const MARKER_TINTS: readonly MarkerTint[] = ['accent', 'info', 'warning', 'overdue', 'neutral'];
const MARKER_BADGES: readonly MarkerBadgeMode[] = ['none', 'open', 'today', 'overdue'];
/** Idle-opacity bounds, mirrored from the settings contract (§9.5). */
const OPACITY = { min: 0.4, max: 1 } as const;

function isThemeId(value: string | null): value is BootParams['theme'] {
  return value !== null && (THEME_IDS as readonly string[]).includes(value);
}

function isMode(value: string | null): value is ThemeMode {
  return value !== null && (MODES as readonly string[]).includes(value);
}

function isLocale(value: string | null): value is string {
  return value !== null && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The marker's shape/scale/colour travel as a compact token because the marker
 * window is sized for its appearance *before* the renderer exists: without it the
 * first paint would use the CSS defaults and flash the wrong shape in a window the
 * OS has already sized for the real one (§9.5).
 */
export function encodeMarkerAppearance(appearance: MarkerAppearance): string {
  return [
    appearance.shape,
    appearance.scale,
    appearance.opacity,
    appearance.tint,
    appearance.badgeMode,
    appearance.showRing ? '1' : '0',
  ].join(',');
}

/** Decodes the marker token; anything malformed is ignored rather than trusted. */
export function parseMarkerAppearance(token: string | null): MarkerAppearance | undefined {
  if (token === null) return undefined;
  const parts = token.split(',');
  if (parts.length !== 6) return undefined;

  const [shape, scale, opacity, tint, badgeMode, showRing] = parts;
  if (!MARKER_SHAPES.includes(shape as MarkerShape)) return undefined;
  if (!MARKER_TINTS.includes(tint as MarkerTint)) return undefined;
  if (!MARKER_BADGES.includes(badgeMode as MarkerBadgeMode)) return undefined;

  const parsedScale = Number(scale);
  const parsedOpacity = Number(opacity);
  if (!Number.isFinite(parsedScale) || !Number.isFinite(parsedOpacity)) return undefined;

  return {
    shape: shape as MarkerShape,
    scale: clamp(parsedScale, MARKER_SCALE.min, MARKER_SCALE.max),
    opacity: clamp(parsedOpacity, OPACITY.min, OPACITY.max),
    tint: tint as MarkerTint,
    badgeMode: badgeMode as MarkerBadgeMode,
    showRing: showRing === '1',
  };
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
  const marker = parseMarkerAppearance(params.get('marker'));
  if (marker !== undefined) parsed.marker = marker;
  if (params.get('smoke') === '1') parsed.smoke = true;
  return parsed;
}

export function bootQuery(params: BootParams): Record<string, string> {
  const query: Record<string, string> = {
    mode: params.mode,
    theme: params.theme,
    locale: params.locale,
  };
  if (params.marker) query['marker'] = encodeMarkerAppearance(params.marker);
  if (params.smoke) query['smoke'] = '1';
  return query;
}
