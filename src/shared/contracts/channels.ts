import type {
  MarkerAnchor,
  MarkerAppearance,
  MarkerEdge,
  MarkerRisk,
  PanelState,
  PanelView,
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
    /**
     * Renderer -> main: collapse animation finished, hide the window.
     */
    collapseFinished: 'window:collapse-finished',
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
    /**
     * Renderer -> main: the marker was right-clicked, so open the app menu
     * (docs/FEATURES.md M01 「标记 / 托盘菜单」). The menu is built and owned by the
     * main process — its labels come from the main i18n instance and its actions
     * move windows or quit the app, none of which a renderer may do (§6.5).
     */
    contextMenu: 'marker:context-menu',
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
  },
  task: {
    /** Renderer -> main: fetch the tasks a filter selects. The main process owns the query. */
    query: 'task:query',
    /** Renderer -> main: read one row by id, for the open detail view (M02 S4). */
    get: 'task:get',
    create: 'task:create',
    update: 'task:update',
    /** Soft delete: the rows move to the recycle bin, they are not dropped. */
    delete: 'task:delete',
    restore: 'task:restore',
    reorder: 'task:reorder',
    /**
     * Renderer -> main: apply one command to a multi-selection in a single write.
     * One write, one notification, one undo entry — whatever the row count (S7).
     */
    bulk: 'task:bulk',
    /**
     * Renderer -> main: take the newest write back (M02 D7). The stack lives in the
     * main process, so a restart — and the collapse the panel does on blur — does
     * not lose it, and the panel itself has nothing to keep in sync.
     */
    undo: 'task:undo',
  },
  attachment: {
    /** Renderer -> main: the attachments (copies) hung on one task. */
    list: 'attachment:list',
    /**
     * Renderer -> main: present the OS file picker and copy what it returns into the
     * app's own attachments directory. The dialog belongs to the main process — a
     * renderer cannot open one, and a path has to be typed in by the user rather than
     * sent from a page (S7).
     */
    add: 'attachment:add',
    remove: 'attachment:remove',
    /** Open the copy with its OS handler. */
    open: 'attachment:open',
    /**
     * Renderer -> main: one image attachment's preview, as a data URL, or `null` when
     * there is none (M03 S3). A separate read rather than a field on the row: a
     * thumbnail is the only large payload of the two, and a non-image never needs one.
     */
    thumbnail: 'attachment:thumbnail',
  },
  reminder: {
    /**
     * Renderer -> main: the user answered a reminder card. The main process owns the
     * instance's state, and this is the one fact about it a renderer can report —
     * whether the notification was clicked is not observable from the panel (M04).
     */
    dismiss: 'reminder:dismiss',
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
    /**
     * Main -> panel: show this view. Sent when the app menu's 今日 item opens the
     * panel; the panel owns the view state, so this is a request rather than a
     * command, and switching it by hand is the same state (M02 S8).
     */
    panelView: 'event:panel-view',
    /**
     * Main -> panel: a reminder's in-app card is due — the OS notification for the
     * same instance went unanswered (M04). The two are never up at once: answering
     * either one withdrawals the other, and the main process's reminder row is where
     * that decision is written down.
     */
    reminderDue: 'event:reminder-due',
    /**
     * Main -> panel: open this task. Sent when a reminder notification is clicked,
     * which is the one surface that is not the panel asking for something itself.
     */
    taskFocus: 'event:task-focus',
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

/** Which view the panel should show (M02 S8). */
export interface PanelViewPayload {
  view: PanelView;
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
