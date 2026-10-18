import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

import { IPC } from '@shared/contracts/channels';
import type { PanelStatePayload } from '@shared/contracts/channels';
import { TRANSPARENT_WINDOW_BACKGROUND } from '@shared/theme/window-background';
import type { BootParams, PanelState } from '@shared/types/app';
import { placePanel } from '@shared/utils/anchoring';
import { createLogger } from '../logger';
import { smokeRecord } from '../platform/smoke';
import { appSettings } from '../services/settings';
import { loadRenderer } from './load-renderer';
import { getMarkerWindow } from './marker';
import { PANEL_SIZE } from './window-state';

const log = createLogger('windows/panel');

/** Panel animation lengths, inside the 180–220ms window of FEATURES M01. */
const EXPAND_DURATION_MS = 200;
const COLLAPSE_DURATION_MS = 180;

/** Blur -> collapse delay, so clicking inside the panel does not close it (§3). */
const COLLAPSE_DELAY_MS = 150;
/** Safety net if the renderer never reports its collapse animation as finished. */
const COLLAPSE_FALLBACK_MS = 400;

let panelWindow: BrowserWindow | null = null;
let panelState: PanelState = 'hidden';
let collapseTimer: NodeJS.Timeout | null = null;
let fallbackTimer: NodeJS.Timeout | null = null;

export function getPanelWindow(): BrowserWindow | null {
  return panelWindow;
}

export function panelStateOf(): PanelState {
  return panelState;
}

export function createPanelWindow(boot: BootParams): BrowserWindow {
  const window = new BrowserWindow({
    width: PANEL_SIZE.width,
    height: PANEL_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: appSettings().panelAlwaysOnTop,
    hasShadow: false,
    roundedCorners: false,
    ...(process.platform === 'win32' ? { thickFrame: false } : {}),
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (process.platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  window.on('blur', () => scheduleCollapse());
  window.on('focus', () => cancelCollapse());
  window.on('closed', () => {
    panelWindow = null;
    panelState = 'hidden';
  });

  panelWindow = window;
  void loadRenderer(window, 'panel', boot);
  log('panel created (hidden)', { alwaysOnTop: appSettings().panelAlwaysOnTop });
  return window;
}

/** Marker click / tray / shortcut: place the panel next to the marker and show it. */
export function expandPanel(): PanelState {
  const window = panelWindow;
  const marker = getMarkerWindow();
  if (window === null || window.isDestroyed()) return panelState;
  if (marker === null || marker.isDestroyed()) return panelState;

  cancelCollapse();
  const markerBounds = marker.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: markerBounds.x + markerBounds.width / 2,
    y: markerBounds.y + markerBounds.height / 2,
  });

  window.setBounds(placePanel(markerBounds, PANEL_SIZE, display.workArea));
  if (!window.isVisible()) window.show();
  window.focus();
  window.moveTop();

  panelState = 'shown';
  send({ state: 'expanding', durationMs: EXPAND_DURATION_MS });
  log('panel expanded', { markerBounds, panelBounds: window.getBounds() });
  smokeRecord('panel-expanded', { panelBounds: window.getBounds() });
  return panelState;
}

export function collapsePanel(): void {
  const window = panelWindow;
  if (window === null || window.isDestroyed() || !window.isVisible()) {
    panelState = 'hidden';
    return;
  }
  if (panelState === 'collapsing') return;

  panelState = 'collapsing';
  send({ state: 'collapsing', durationMs: COLLAPSE_DURATION_MS });
  cancelFallback();
  fallbackTimer = setTimeout(() => {
    log('collapse animation was not acknowledged, hiding anyway');
    hidePanel();
  }, COLLAPSE_FALLBACK_MS);
}

/** Called from the renderer once its collapse animation completed (`window:collapse-finished`). */
export function finishCollapse(): void {
  if (panelState !== 'collapsing') return;
  hidePanel();
}

export function togglePanel(): PanelState {
  if (panelState === 'hidden') return expandPanel();
  collapsePanel();
  return panelState;
}

export function setPanelAlwaysOnTop(enabled: boolean): boolean {
  const window = panelWindow;
  if (window === null || window.isDestroyed()) return enabled;
  window.setAlwaysOnTop(enabled);
  log('panel always-on-top set', { enabled });
  return enabled;
}

function hidePanel(): void {
  cancelFallback();
  const window = panelWindow;
  if (window !== null && !window.isDestroyed()) window.hide();
  panelState = 'hidden';
  log('panel hidden');
  smokeRecord('panel-hidden');
}

function scheduleCollapse(): void {
  cancelCollapse();
  collapseTimer = setTimeout(() => {
    collapseTimer = null;
    const window = panelWindow;
    if (window === null || window.isDestroyed() || window.isFocused()) return;
    collapsePanel();
  }, COLLAPSE_DELAY_MS);
}

function cancelCollapse(): void {
  if (collapseTimer === null) return;
  clearTimeout(collapseTimer);
  collapseTimer = null;
}

function cancelFallback(): void {
  if (fallbackTimer === null) return;
  clearTimeout(fallbackTimer);
  fallbackTimer = null;
}

function send(payload: PanelStatePayload): void {
  const window = panelWindow;
  if (window === null || window.isDestroyed()) return;
  window.webContents.send(IPC.event.panelState, payload);
}
