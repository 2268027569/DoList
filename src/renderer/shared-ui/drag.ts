/**
 * Marker drag bridge (docs/ARCHITECTURE.md §9.2, the risky part of M01).
 *
 * The renderer never computes positions frame by frame: it only detects the
 * intent ("the user is dragging") and heartbeat-tells the main process, which
 * reads the real OS cursor via `screen.getCursorScreenPoint()`. That keeps the
 * marker smooth even when the renderer is throttled.
 *
 * `pointerup` can be swallowed by the OS when the button is released outside the
 * window, so the main process treats a missing heartbeat as "released".
 */
const CLICK_SLOP_PX = 4;
/** Heartbeat period while dragging; the main-process watchdog expects ~16ms. */
const TICK_INTERVAL_MS = 32;
/** Clicks landing right after a drag are swallowed for this long. */
const CLICK_SUPPRESSION_MS = 300;

let suppressClickUntil = 0;

/** True when the recent pointer sequence was a drag, not a click. */
export function clickIsSuppressed(): boolean {
  return Date.now() < suppressClickUntil;
}

export interface DragBridge {
  dispose(): void;
  isDragging(): boolean;
}

export function attachDragBridge(element: HTMLElement): DragBridge {
  let pointerId: number | null = null;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let lastTickAt = 0;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    dragging = false;
    startX = event.screenX;
    startY = event.screenY;
    // Capture is required, not optional: the marker window is only 32×39 DIP, so
    // without it Chromium stops delivering pointermove the moment the cursor
    // steps outside (measured — docs/ARCHITECTURE.md §9.1) and the drag never
    // starts. It also has a cost: Chromium warps the OS cursor whenever a
    // captured drag moves the window, which the main process's sampling loop can
    // amplify for a frame (§9.2 open item).
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best effort; the watchdog covers the rest.
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) return;

    if (!dragging) {
      const travelled = Math.hypot(event.screenX - startX, event.screenY - startY);
      if (travelled < CLICK_SLOP_PX) return;
      dragging = true;
      // The grab point is the pointerdown position, not the current one: the
      // marker must not jump by the slop distance when the drag is recognised.
      void window.api.marker.dragStart({ grabX: startX, grabY: startY });
    }

    const now = performance.now();
    if (now - lastTickAt >= TICK_INTERVAL_MS) {
      lastTickAt = now;
      void window.api.marker.dragTick();
    }
  };

  const finish = (): boolean => {
    if (pointerId === null) return false;
    pointerId = null;
    const wasDragging = dragging;
    dragging = false;
    if (wasDragging) {
      suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
      void window.api.marker.dragEnd();
    }
    return wasDragging;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (pointerId !== null && event.pointerId !== pointerId) return;
    finish();
  };

  const onWindowBlur = (): void => {
    finish();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('blur', onWindowBlur);

  return {
    isDragging: () => dragging,
    dispose: () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onWindowBlur);
      finish();
    },
  };
}
