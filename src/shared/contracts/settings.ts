import { z } from 'zod';

import { THEME_IDS } from '../types/app';
import type { MarkerAppearance } from '../types/app';

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
