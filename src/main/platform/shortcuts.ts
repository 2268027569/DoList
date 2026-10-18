import { globalShortcut } from 'electron';

import { createLogger } from '../logger';
import { togglePanel } from '../windows/panel';

const log = createLogger('platform/shortcuts');

/**
 * Default: Ctrl/Cmd+Shift+Space toggles the panel (docs/ARCHITECTURE.md §14,
 * open question 5). The quick-add shortcut arrives with M02.
 */
export function registerShortcuts(): void {
  register('CommandOrControl+Shift+Space', () => togglePanel());
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}

function register(accelerator: string, run: () => void): void {
  try {
    const registered = globalShortcut.register(accelerator, run);
    log(registered ? 'shortcut registered' : 'shortcut rejected by the OS', accelerator);
  } catch (error) {
    log('shortcut registration failed', accelerator, error);
  }
}
