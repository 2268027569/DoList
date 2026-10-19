import { useEffect, useRef, useState } from 'react';

/**
 * How long the surface stays at a value before it is written (docs/FEATURES.md
 * M01「面板形态」). The slider reports continuously while it is dragged, and
 * every report is a SQLite write plus an edge-hide re-evaluation, so the write
 * waits for the user to let go — while the value itself is applied on every
 * report, because seeing the panel fade is the whole point of the control.
 */
const PERSIST_DELAY_MS = 200;

/**
 * The panel surface's opacity, seeded from the boot parameter (§9.9) and
 * persisted to the settings store.
 *
 * The value is held here rather than in the panel store: it is one number that
 * only this screen draws, and the store's fields are the ones a re-render has to
 * be able to depend on.
 */
export function usePanelOpacity(initial: number): {
  opacity: number;
  setOpacity: (next: number) => void;
} {
  const [opacity, setOpacity] = useState(initial);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const set = (next: number): void => {
    setOpacity(next);
    pending.current = next;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const target = pending.current;
      pending.current = null;
      if (target === null) return;
      // Fire and forget: a rejected write leaves the panel looking the way the
      // user set it, and the stored value catches up on the next open. Nothing
      // about the list is affected, so there is no error surface to raise here.
      void window.api.settings.set({ panelOpacity: target });
    }, PERSIST_DELAY_MS);
  };

  return { opacity, setOpacity: set };
}
