import type { Size } from './marker-geometry';

/**
 * Panel window geometry (docs/FEATURES.md M01 "面板形态").
 *
 * The panel is not OS-resizable: on Windows a frameless transparent window only
 * grows a resize border with `thickFrame: true`, which would also add the frame
 * we are trying to avoid (§9.1.1). Resizing is therefore driven by a handle in
 * the renderer that reports a target size, and the main process clamps it here
 * and applies it with `setBounds` — the same shape as the marker drag, minus the
 * per-frame cursor sampling.
 */
export const PANEL_SIZE: Size = { width: 380, height: 560 };

/** Bounds a user may drag the panel between, so it can never become unusable. */
export const PANEL_SIZE_RANGE = {
  min: { width: 320, height: 420 },
  max: { width: 640, height: 900 },
} as const;

export function clampPanelSize(size: Size): Size {
  return {
    width: Math.round(
      Math.min(Math.max(size.width, PANEL_SIZE_RANGE.min.width), PANEL_SIZE_RANGE.max.width),
    ),
    height: Math.round(
      Math.min(Math.max(size.height, PANEL_SIZE_RANGE.min.height), PANEL_SIZE_RANGE.max.height),
    ),
  };
}
