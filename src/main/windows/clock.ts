import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

import { CLOCK_SIZE, placeClock } from '@shared/utils/anchoring';
import type { BootParams } from '@shared/types/app';
import { createLogger } from '../logger';
import { smokeRecord } from '../platform/smoke';
import { windowMaterialOptions } from '../platform/window-material';
import { loadRenderer } from './load-renderer';

const log = createLogger('windows/clock');

/**
 * The desktop clock (docs/FEATURES.md M03).
 *
 * A window of its own rather than a corner of the panel: the clock has to be readable
 * while the panel is collapsed, and the panel is opened for a task rather than for the
 * time. Pinned to the top centre of the primary display, above every other window, and
 * sized once — it is a scoreboard, not a surface to work in.
 *
 * It is deliberately **ambient**: `focusable: false`, shown with `showInactive()`, and
 * `setIgnoreMouseEvents(true)`, so a click on it reaches whatever is underneath. A clock
 * that swallowed the click aimed at the window behind it would be a clock in the way.
 */
export function createClockWindow(boot: BootParams): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workArea;
  const bounds = placeClock(workArea);

  const window = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: CLOCK_SIZE.width,
    height: CLOCK_SIZE.height,
    show: false,
    frame: false,
    // Same material as the panel, detail and popup (M07): the card is drawn on the
    // system backdrop rather than pretending to blur one it cannot see.
    ...windowMaterialOptions(boot.glass === true),
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    // Placed by the program, never dragged: no surface of the window is a grip.
    movable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    ...(process.platform === 'win32' ? { thickFrame: false } : {}),
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // Every click belongs to whatever is under the card.
  window.setIgnoreMouseEvents(true);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setSkipTaskbar(true);
  if (process.platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  window.once('ready-to-show', () => {
    window.showInactive();
    log('clock shown', { bounds: window.getBounds(), workArea });
    smokeRecord('clock-placed', { bounds: window.getBounds(), workArea });
  });

  // The top centre is a function of the work area, so a taskbar that moves, a
  // resolution change or a monitor being unplugged all have to re-place it — the
  // clock must never be left hanging over a screen edge or under the system chrome.
  const reposition = (reason: string): void => {
    if (window.isDestroyed()) return;
    const next = screen.getPrimaryDisplay().workArea;
    const rect = placeClock(next);
    const current = window.getBounds();
    if (rect.x === current.x && rect.y === current.y) return;
    window.setBounds(rect);
    log(`display change (${reason}) re-placed the clock`, { bounds: rect, workArea: next });
    smokeRecord('clock-placed', { bounds: rect, workArea: next });
  };
  const onAdded = (): void => reposition('display-added');
  const onRemoved = (): void => reposition('display-removed');
  const onMetrics = (): void => reposition('display-metrics-changed');
  screen.on('display-added', onAdded);
  screen.on('display-removed', onRemoved);
  screen.on('display-metrics-changed', onMetrics);

  window.on('closed', () => {
    screen.removeListener('display-added', onAdded);
    screen.removeListener('display-removed', onRemoved);
    screen.removeListener('display-metrics-changed', onMetrics);
  });

  void loadRenderer(window, 'clock', boot);
  log('clock created (hidden)', { bounds, glass: boot.glass === true });
  return window;
}
