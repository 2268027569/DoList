import { describe, expect, it } from 'vitest';

import { PANEL_SIZE, PANEL_SIZE_RANGE, clampPanelSize } from './panel-geometry';

describe('clampPanelSize', () => {
  it('passes a size inside the range through, rounded to whole DIPs', () => {
    expect(clampPanelSize(PANEL_SIZE)).toEqual(PANEL_SIZE);
    expect(clampPanelSize({ width: 400.4, height: 600.6 })).toEqual({ width: 400, height: 601 });
  });

  it('clamps each axis independently, so one axis at its limit does not move the other', () => {
    // Dragging the grip far past a corner is normal; it must stop at the bound
    // rather than throwing or collapsing the other axis.
    expect(clampPanelSize({ width: 100, height: 5000 })).toEqual({
      width: PANEL_SIZE_RANGE.min.width,
      height: PANEL_SIZE_RANGE.max.height,
    });
    expect(clampPanelSize({ width: 5000, height: 100 })).toEqual({
      width: PANEL_SIZE_RANGE.max.width,
      height: PANEL_SIZE_RANGE.min.height,
    });
  });
});
