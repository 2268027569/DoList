import type { MarkerAppearance, MarkerShape } from '../types/app';

/** A width/height pair in DIPs. */
export interface Size {
  width: number;
  height: number;
}

/**
 * Design artwork per shape (docs/ARCHITECTURE.md §9.1): the marker *window* may
 * be larger, because a transparent frameless top-level window cannot go below
 * the platform floor (§9.1.1). Keeping the artwork table here lets the main
 * process (window sizing) and the marker renderer (CSS custom properties) share
 * one source of truth instead of duplicating the numbers.
 */
export const MARKER_ARTWORK: Record<MarkerShape, Size> = {
  dot: { width: 28, height: 28 },
  pill: { width: 56, height: 28 },
  icon: { width: 40, height: 40 },
};

export const MARKER_SCALE = { min: 0.8, max: 1.5 } as const;

/** Shipping default before the user has changed anything. */
export const DEFAULT_APPEARANCE: MarkerAppearance = {
  shape: 'dot',
  scale: 1,
  opacity: 1,
  tint: 'accent',
  badgeMode: 'open',
  showRing: true,
};

/** Artwork size after the user's scale, rounded to whole DIPs. */
export function markerArtworkSize(shape: MarkerShape, scale: number): Size {
  const base = MARKER_ARTWORK[shape];
  return {
    width: Math.round(base.width * scale),
    height: Math.round(base.height * scale),
  };
}

/**
 * Window size for an artwork: the larger of the artwork and the platform floor,
 * so the artwork stays centred inside a window the OS is willing to create.
 */
export function markerWindowSize(shape: MarkerShape, scale: number, floor: Size | null): Size {
  const artwork = markerArtworkSize(shape, scale);
  if (floor === null) return artwork;
  return {
    width: Math.max(artwork.width, floor.width),
    height: Math.max(artwork.height, floor.height),
  };
}
