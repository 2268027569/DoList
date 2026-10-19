import type {
  MarkerAnchor,
  MarkerAppearance,
  MarkerEdge,
  MarkerRisk,
  PanelState,
} from '../types/app';

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
    /**
     * Renderer -> main: the resize handle reports a target size. The main process
     * is the one that clamps it to the work area and persists it (windows/panel.ts).
     */
    resize: 'window:resize-panel',
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
  task: {
    /** Renderer -> main: fetch the tasks a filter selects. The main process owns the query. */
    query: 'task:query',
    create: 'task:create',
    update: 'task:update',
    /** Soft delete: the rows move to the recycle bin, they are not dropped. */
    delete: 'task:delete',
    restore: 'task:restore',
    reorder: 'task:reorder',
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
    /** Main -> marker: appearance plus the counts the badge / ring should show. */
    markerState: 'event:marker-state',
    /**
     * Main -> panel: tasks changed, so re-fetch the open query. Carries a
     * description rather than the rows themselves — the main process is the only
     * source of truth and a mirrored list would drift (§6.2, M02 D4).
     */
    taskChanged: 'event:task-changed',
    /**
     * Main -> panel: the quick-add shortcut opened the panel, so its field should
     * take the caret. No payload — the panel focuses the one input it owns
     * (M02-PLAN §6).
     */
    quickAddFocus: 'event:quick-add-focus',
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

/**
 * The marker's complete visual input. Appearance is settings driven and state is
 * data driven; both travel together because the main process recomputes the pair
 * on every settings or task change and the renderer applies it in one pass.
 */
export interface MarkerStatePayload {
  appearance: MarkerAppearance;
  /** Number for the badge; `0` hides it. */
  badge: number;
  /** Today's completion, 0–100; `null` hides the ring. */
  progress: number | null;
  risk: MarkerRisk;
}
