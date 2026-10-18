import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { clampPanelSize } from '@shared/utils/panel-geometry';

/** How often the handle reports a size while the pointer keeps moving. */
const TICK_INTERVAL_MS = 32;

/**
 * Panel resize handle (docs/FEATURES.md M01 "面板形态").
 *
 * The panel window is frameless and not OS-resizable, so the handle reports the
 * size it wants and the main process applies it with `setBounds`. The size is
 * measured from where the pointer started, never from the live `innerWidth`: the
 * window is being resized *by this gesture*, so reading it back mid-drag would
 * feed the gesture its own output and drift.
 */
export function usePanelResize(): {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
} {
  const gesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    lastSize: { width: number; height: number } | null;
    lastTickAt: number;
  } | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const onPointerMove = useCallback((event: PointerEvent): void => {
    const current = gesture.current;
    if (current === null || event.pointerId !== current.pointerId) return;

    const target = clampPanelSize({
      width: current.startWidth + (event.screenX - current.startX),
      height: current.startHeight + (event.screenY - current.startY),
    });

    const now = performance.now();
    if (now - current.lastTickAt >= TICK_INTERVAL_MS) {
      current.lastTickAt = now;
      current.lastSize = target;
      void window.api.window.resize(target);
    }
  }, []);

  const onPointerUp = useCallback((event: PointerEvent): void => {
    const current = gesture.current;
    if (current === null || event.pointerId !== current.pointerId) return;

    // One final report, so a release that landed between two ticks is not lost.
    if (current.lastSize !== null) void window.api.window.resize(current.lastSize);
    gesture.current = null;
    detach.current?.();
    detach.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      gesture.current = {
        pointerId: event.pointerId,
        startX: event.screenX,
        startY: event.screenY,
        startWidth: window.innerWidth,
        startHeight: window.innerHeight,
        lastSize: null,
        lastTickAt: 0,
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      detach.current = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      };
    },
    [onPointerMove, onPointerUp],
  );

  return { onPointerDown };
}
