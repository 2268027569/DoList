/** App-level types shared by the main process, the preload bridge and both renderers. */

export type ThemeMode = 'light' | 'dark';
export type ThemeModeSetting = ThemeMode | 'system';

export const THEME_IDS = ['minimal', 'graphite'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export type LocaleId = 'en' | 'zh-Hans';

/** Shape of the marker when idle (docs/FEATURES.md M01). */
export type MarkerShape = 'dot' | 'pill' | 'icon';

/** Marker colour, resolved to a semantic token by the renderer (§7). */
export type MarkerTint = 'accent' | 'info' | 'warning' | 'overdue' | 'neutral';

/** Which count the marker advertises. `none` hides the number. */
export type MarkerBadgeMode = 'none' | 'open' | 'today' | 'overdue';

/** How alarming the ring should look (docs/FEATURES.md M01). */
export type MarkerRisk = 'neutral' | 'near' | 'overdue';

/** Everything the marker renderer needs to draw the button (§9). */
export interface MarkerAppearance {
  shape: MarkerShape;
  /** Artwork scale, 0.8–1.5. */
  scale: number;
  /** Idle opacity, 0.4–1; hover always restores full opacity. */
  opacity: number;
  tint: MarkerTint;
  badgeMode: MarkerBadgeMode;
  /** Show today's completion on the marker. */
  showRing: boolean;
}

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

/**
 * Which slice of the tasks the panel lists (docs/M02-PLAN.md §8, slice S8). Two
 * views: the Inbox, and everything due by the end of today. A view with its own
 * identity — a list, a tag, a saved search — is M03.
 */
export type PanelView = 'inbox' | 'today';

/** Resolved boot parameters handed to both renderers (docs/ARCHITECTURE.md §7). */
export interface BootParams {
  mode: ThemeMode;
  theme: ThemeId;
  locale: string;
  /**
   * Marker-only: applied before the first paint so the window never flashes a
   * different shape / scale than the one it was sized for (§9.5).
   */
  marker?: MarkerAppearance;
  /** Only set by the marker-input smoke harness; the preload exposes extra hooks when true. */
  smoke?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
