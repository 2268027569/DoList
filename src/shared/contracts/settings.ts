import { z } from 'zod';

import { THEME_IDS } from '../types/app';

/** Row keys of the `settings` table (docs/ARCHITECTURE.md §5.2). */
export const SETTINGS_KEY = {
  app: 'app.settings',
  markerAnchor: 'window.marker.anchor',
} as const;

const fieldSchemas = {
  locale: z.string().max(35),
  themeMode: z.enum(['light', 'dark', 'system']),
  themeId: z.enum(THEME_IDS),
  markerShape: z.enum(['dot', 'pill', 'icon']),
  panelAlwaysOnTop: z.boolean(),
};

/** Complete settings; missing keys fall back to the documented defaults. */
export const appSettingsSchema = z.object({
  locale: fieldSchemas.locale.default(''),
  themeMode: fieldSchemas.themeMode.default('system'),
  themeId: fieldSchemas.themeId.default('minimal'),
  markerShape: fieldSchemas.markerShape.default('dot'),
  panelAlwaysOnTop: fieldSchemas.panelAlwaysOnTop.default(true),
});

/** Partial update: only the keys the caller sent are touched. */
export const appSettingsPatchSchema = z.object(fieldSchemas).partial();

export type AppSettings = z.infer<typeof appSettingsSchema>;
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;

export const DEFAULT_SETTINGS: AppSettings = appSettingsSchema.parse({});
