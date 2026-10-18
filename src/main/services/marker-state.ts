import type { MarkerStatePayload } from '@shared/contracts/channels';
import { markerAppearanceOf } from '@shared/contracts/settings';
import type { MarkerBadgeMode, MarkerRisk } from '@shared/types/app';
import { localDayBounds } from '@shared/utils/day';
import { markerCounts } from '../db/repositories/tasks';
import { appSettings } from './settings';

/**
 * Builds the marker's complete visual input (docs/ARCHITECTURE.md §9).
 *
 * Appearance comes from settings and the numbers from the task tables; both are
 * cheap synchronous reads, so this is recomputed on boot and on every settings or
 * task change rather than cached.
 */
export function currentMarkerState(now: number = Date.now()): MarkerStatePayload {
  const appearance = markerAppearanceOf(appSettings());
  const counts = markerCounts(now, localDayBounds(now));

  const badge: Record<MarkerBadgeMode, number> = {
    none: 0,
    open: counts.open,
    today: counts.dueToday - counts.doneToday,
    overdue: counts.overdue,
  };

  // Nothing due today means "no data" rather than "0% done", so the ring is
  // hidden instead of reading as a failure.
  const progress =
    counts.dueToday > 0 ? Math.round((counts.doneToday / counts.dueToday) * 100) : null;

  const risk: MarkerRisk =
    counts.overdue > 0 ? 'overdue' : counts.dueSoon > 0 ? 'near' : 'neutral';

  return { appearance, badge: badge[appearance.badgeMode], progress, risk };
}

/**
 * Smoke harness only: a fixed, non-zero state so the badge and ring render on a
 * fresh, empty database. Mirrors the `YICHEN_SMOKE_FOCUSABLE` probe in
 * windows/marker.ts — it exists to make the drawing path observable, not to
 * stand in for real data.
 */
export const SMOKE_MARKER_STATE: MarkerStatePayload = {
  appearance: {
    shape: 'dot',
    scale: 1,
    opacity: 1,
    tint: 'accent',
    badgeMode: 'open',
    showRing: true,
  },
  badge: 3,
  progress: 42,
  risk: 'near',
};
