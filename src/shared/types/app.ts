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
 * Which slice of the tasks the panel lists (docs/M03-PLAN.md §2). Six views, and
 * they are all the same query with a different filter (§5.1): the Inbox and the
 * dated slices beside it, plus the two archives. A view with a faceted identity —
 * a list of its own, a tag, a saved search — is still M03.
 */
export type PanelView = 'inbox' | 'today' | 'tomorrow' | 'upcoming' | 'completed' | 'cancelled';

/**
 * The two views that show rows whose story is over, rather than work still to be
 * done (M03 D5). They are the ones where adding a task makes no sense and where
 * the list stops offering the controls that are about ordering work.
 */
export const ARCHIVE_VIEWS: readonly PanelView[] = ['completed', 'cancelled'];

export function isArchiveView(view: PanelView): boolean {
  return ARCHIVE_VIEWS.includes(view);
}

/** Resolved boot parameters handed to both renderers (docs/ARCHITECTURE.md §7). */
export interface BootParams {
  mode: ThemeMode;
  theme: ThemeId;
  locale: string;
  /**
   * Panel-only: how solid the panel's own surface is. Travels with the boot
   * parameters for the same reason the theme does — it is read before the first
   * paint, so the window is never drawn opaque and then faded (§9.9).
   */
  panelOpacity?: number;
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
