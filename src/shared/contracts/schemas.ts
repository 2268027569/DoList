import { z } from 'zod';

/**
 * Every IPC payload is validated in the main process before it is used
 * (docs/ARCHITECTURE.md §6.4). The main process never trusts the renderer.
 */
export const markerAnchorSchema = z.object({
  displayId: z.string().min(1).max(128),
  edge: z.enum(['left', 'right', 'top', 'bottom', 'free']),
  offsetFromEdge: z.number().finite(),
  ratioAlongEdge: z.number().finite().min(0).max(1),
});

/**
 * A resize-handle target size. Only sanity-checked here: the size *range* is
 * enforced by `clampPanelSize` in the main process, because rejecting an
 * overshoot would turn ordinary dragging past a bound into an IPC error.
 */
export const panelSizeInput = z.object({
  width: z.number().finite().positive().max(10_000),
  height: z.number().finite().positive().max(10_000),
});

export const markerSetAnchorInput = z.object({ anchor: markerAnchorSchema });

/**
 * The grab point is the pointer position at `pointerdown`, in screen coordinates.
 * Sending it lets the main process keep the marker exactly under the cursor from
 * the first frame instead of re-anchoring to wherever the pointer had already
 * travelled when the drag was recognised.
 */
export const markerDragStartInput = z.object({
  grabX: z.number().finite(),
  grabY: z.number().finite(),
});

export const settingsGetInput = z.object({ key: z.string().min(1).max(120) });

export const settingsSetInput = z.object({
  key: z.string().min(1).max(120),
  value: z.unknown(),
});

export const setLocaleInput = z.object({ locale: z.string().min(2).max(35) });

export const smokeReportInput = z.object({
  type: z.string().min(1).max(60),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export type SmokeReportInput = z.infer<typeof smokeReportInput>;
