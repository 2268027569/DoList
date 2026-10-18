import type { MarkerAnchor, MarkerEdge, PanelState } from '../types/app';

/** Channel names follow `<domain>:<action>`; events use the `event:` prefix (§6.1). */
export const IPC = {
  app: {
    quit: 'app:quit',
  },
  window: {
    /** Marker click / tray / shortcut -> main: open the panel. */
    expand: 'window:expand',
    /** Renderer -> main: start the collapse sequence. */
    collapse: 'window:collapse',
    /** Renderer -> main: collapse animation finished, hide the window. */
    collapseFinished: 'window:collapse-finished',
    setAlwaysOnTop: 'window:set-always-on-top',
  },
  marker: {
    /** Renderer -> main: pointer moved past the drag threshold. */
    dragStart: 'marker:drag-start',
    /**
     * Renderer -> main: heartbeat on every pointermove. The main process reads the
     * OS cursor for smoothness, so this is only proof that the renderer still
     * receives pointer events; when it stops while the cursor moves, the drag is
     * treated as released (see windows/marker.ts).
     */
    dragTick: 'marker:drag-tick',
    /** Renderer -> main: pointer released (or the drag watchdog fired). */
    dragEnd: 'marker:drag-end',
    /** Renderer -> main: persist a new anchor immediately. */
    setAnchor: 'marker:set-anchor',
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
  },
  i18n: {
    setLocale: 'i18n:set-locale',
  },
  smoke: {
    /** Dev/smoke only: renderer reports an input event for the marker hit-test harness. */
    report: 'smoke:report',
  },
  event: {
    panelState: 'event:panel-state',
    themeChanged: 'event:theme-changed',
    localeChanged: 'event:locale-changed',
    markerAnchorChanged: 'event:marker-anchor-changed',
  },
} as const;

export interface PanelStatePayload {
  state: PanelState;
  /** Collapse (or expand) animation length the renderer should honour, in ms. */
  durationMs: number;
}

export interface MarkerAnchorPayload {
  anchor: MarkerAnchor;
  edge: MarkerEdge;
}
