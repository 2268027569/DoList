import { globalShortcut } from 'electron';

import { createLogger } from '../logger';
import { expandPanelForQuickAdd, togglePanel } from '../windows/panel';

const log = createLogger('platform/shortcuts');

/**
 * Defaults: Ctrl/Cmd+Shift+Space toggles the panel, Ctrl/Cmd+Shift+N opens it with
 * the caret already in the quick-add field (docs/ARCHITECTURE.md §14, open question
 * 5; M02-PLAN §6). Both are user-configurable with conflict detection in M09 — until
 * then a rejected accelerator is logged rather than surfaced.
 */
export function registerShortcuts(): void {
  register('CommandOrControl+Shift+Space', () => togglePanel());
  register('CommandOrControl+Shift+N', () => expandPanelForQuickAdd());
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
