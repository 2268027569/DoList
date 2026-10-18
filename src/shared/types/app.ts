/** App-level types shared by the main process, the preload bridge and both renderers. */

export type ThemeMode = 'light' | 'dark';
export type ThemeModeSetting = ThemeMode | 'system';

export const THEME_IDS = ['minimal', 'graphite'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export type LocaleId = 'en' | 'zh-Hans';

/** Shape of the marker when idle (docs/FEATURES.md M01). */
export type MarkerShape = 'dot' | 'pill' | 'icon';

/** Which work-area edge the marker is anchored to. `free` = snapped to no edge. */
export type MarkerEdge = 'left' | 'right' | 'top' | 'bottom' | 'free';

/**
 * Position persistence is anchor based, never absolute (docs/ARCHITECTURE.md §9.3):
 * the marker survives resolution, DPI and taskbar changes because it is described
 * relative to the display it lives on.
 *
 * - `edge === 'free'`: `offsetFromEdge` is the horizontal offset from the work-area
 *   left edge and `ratioAlongEdge` the normalized vertical position.
 * - `edge` is an edge: `offsetFromEdge` is the distance to that edge and
 *   `ratioAlongEdge` the normalized position along the perpendicular axis.
 */
export interface MarkerAnchor {
  displayId: string;
  edge: MarkerEdge;
  offsetFromEdge: number;
  ratioAlongEdge: number;
}

export type PanelState = 'hidden' | 'expanding' | 'shown' | 'collapsing';

/** Resolved boot parameters handed to both renderers (docs/ARCHITECTURE.md §7). */
export interface BootParams {
  mode: ThemeMode;
  theme: ThemeId;
  locale: string;
  /** Only set by the marker-input smoke harness; the preload exposes extra hooks when true. */
  smoke?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
