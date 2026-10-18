import { z } from 'zod';

import { THEME_IDS } from '../types/app';
import type { MarkerAppearance } from '../types/app';
import type { EdgeHideConfig } from '../utils/edge-hide';
import { PANEL_SIZE, PANEL_SIZE_RANGE } from '../utils/panel-geometry';

/** Row keys of the `settings` table (docs/ARCHITECTURE.md §5.2). */
export const SETTINGS_KEY = {
  app: 'app.settings',
  markerAnchor: 'window.marker.anchor',
} as const;

/** Artwork scale bounds the marker window can be resized within (§9.1). */
export const MARKER_SCALE_RANGE = { min: 0.8, max: 1.5 } as const;
export const MARKER_OPACITY_RANGE = { min: 0.4, max: 1 } as const;
/** Edge-snap threshold bounds, in DIPs (docs/FEATURES.md M01 "屏幕边缘吸附"). */
export const MARKER_SNAP_THRESHOLD_RANGE = { min: 0, max: 80 } as const;
export const DEFAULT_SNAP_THRESHOLD = 24;

/** Edge auto-hide bounds, in DIPs (docs/FEATURES.md M01 "贴边自动隐藏", §9.4). */
export const MARKER_HIDE_PEEK_RANGE = { min: 3, max: 8 } as const;
export const MARKER_HIDE_REVEAL_RANGE = { min: 8, max: 64 } as const;
export const MARKER_HIDE_EXIT_RANGE = { min: 16, max: 160 } as const;
export const DEFAULT_MARKER_HIDE = { peek: 5, reveal: 24, exit: 48 } as const;

const fieldSchemas = {
  locale: z.string().max(35),
  themeMode: z.enum(['light', 'dark', 'system']),
  themeId: z.enum(THEME_IDS),
  markerShape: z.enum(['dot', 'pill', 'icon']),
  markerScale: z.number().min(MARKER_SCALE_RANGE.min).max(MARKER_SCALE_RANGE.max),
  markerOpacity: z.number().min(MARKER_OPACITY_RANGE.min).max(MARKER_OPACITY_RANGE.max),
  markerTint: z.enum(['accent', 'info', 'warning', 'overdue', 'neutral']),
  markerBadge: z.enum(['none', 'open', 'today', 'overdue']),
  markerRing: z.boolean(),
  markerSnap: z.boolean(),
  markerSnapThreshold: z
    .number()
    .min(MARKER_SNAP_THRESHOLD_RANGE.min)
    .max(MARKER_SNAP_THRESHOLD_RANGE.max),
  markerAutoHide: z.boolean(),
  markerHidePeek: z.number().min(MARKER_HIDE_PEEK_RANGE.min).max(MARKER_HIDE_PEEK_RANGE.max),
  markerHideReveal: z
    .number()
    .min(MARKER_HIDE_REVEAL_RANGE.min)
    .max(MARKER_HIDE_REVEAL_RANGE.max),
  markerHideExit: z.number().min(MARKER_HIDE_EXIT_RANGE.min).max(MARKER_HIDE_EXIT_RANGE.max),
  panelWidth: z
    .number()
    .min(PANEL_SIZE_RANGE.min.width)
    .max(PANEL_SIZE_RANGE.max.width),
  panelHeight: z
    .number()
    .min(PANEL_SIZE_RANGE.min.height)
    .max(PANEL_SIZE_RANGE.max.height),
  panelAlwaysOnTop: z.boolean(),
};

/** Complete settings; missing keys fall back to the documented defaults. */
export const appSettingsSchema = z.object({
  locale: fieldSchemas.locale.default(''),
  themeMode: fieldSchemas.themeMode.default('system'),
  themeId: fieldSchemas.themeId.default('minimal'),
  markerShape: fieldSchemas.markerShape.default('dot'),
  markerScale: fieldSchemas.markerScale.default(1),
  markerOpacity: fieldSchemas.markerOpacity.default(1),
  markerTint: fieldSchemas.markerTint.default('accent'),
  markerBadge: fieldSchemas.markerBadge.default('open'),
  markerRing: fieldSchemas.markerRing.default(true),
  markerSnap: fieldSchemas.markerSnap.default(true),
  markerSnapThreshold: fieldSchemas.markerSnapThreshold.default(DEFAULT_SNAP_THRESHOLD),
  // Off by default, and not just for taste: the marker opens parked at the right
  // edge (DEFAULT_MARKER_ANCHOR), so switching this on by default would greet a
  // first-time user with a 5px sliver instead of the marker (§9.4).
  markerAutoHide: fieldSchemas.markerAutoHide.default(false),
  markerHidePeek: fieldSchemas.markerHidePeek.default(DEFAULT_MARKER_HIDE.peek),
  markerHideReveal: fieldSchemas.markerHideReveal.default(DEFAULT_MARKER_HIDE.reveal),
  markerHideExit: fieldSchemas.markerHideExit.default(DEFAULT_MARKER_HIDE.exit),
  panelWidth: fieldSchemas.panelWidth.default(PANEL_SIZE.width),
  panelHeight: fieldSchemas.panelHeight.default(PANEL_SIZE.height),
  panelAlwaysOnTop: fieldSchemas.panelAlwaysOnTop.default(true),
});

/** Partial update: only the keys the caller sent are touched. */
export const appSettingsPatchSchema = z.object(fieldSchemas).partial();

export type AppSettings = z.infer<typeof appSettingsSchema>;
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;

export const DEFAULT_SETTINGS: AppSettings = appSettingsSchema.parse({});

/** Projects the appearance fields out of the flat settings row. */
export function markerAppearanceOf(settings: AppSettings): MarkerAppearance {
  return {
    shape: settings.markerShape,
    scale: settings.markerScale,
    opacity: settings.markerOpacity,
    tint: settings.markerTint,
    badgeMode: settings.markerBadge,
    showRing: settings.markerRing,
  };
}

/**
 * Snap distance for the marker's drag release: zero disables snapping, because
 * `snapToWorkArea` with a threshold of 0 never fires and the anchor is then built
 * as `free`, which round-trips through `fromAnchor` unchanged (§9.3).
 */
export function markerSnapThresholdOf(settings: AppSettings): number {
  return settings.markerSnap ? settings.markerSnapThreshold : 0;
}

/**
 * Park policy for the marker, or `null` when it stays visible (§9.4).
 *
 * The exit distance is forced above the reveal distance: if they cross over, the
 * marker would park and reveal around the same cursor position and flicker.
 */
export function markerEdgeHideOf(settings: AppSettings): EdgeHideConfig | null {
  if (!settings.markerAutoHide) return null;
  return {
    peek: settings.markerHidePeek,
    revealDistance: settings.markerHideReveal,
    hideDistance: Math.max(settings.markerHideExit, settings.markerHideReveal + 8),
  };
}

/** Panel size as stored, i.e. the size the user last dragged it to. */
export function panelSizeOf(settings: AppSettings): { width: number; height: number } {
  return { width: settings.panelWidth, height: settings.panelHeight };
}
