import { BrowserWindow } from 'electron';

import { IPC } from '@shared/contracts/channels';

import { resolveBoot } from './settings';

/** Fan-out for the few events both renderer entries care about (§6.2). */
export function broadcastToWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(channel, payload);
  }
}

export function broadcastTheme(): void {
  broadcastToWindows(IPC.event.themeChanged, resolveBoot(false));
}

export function broadcastLocale(boot: { locale: string }): void {
  broadcastToWindows(IPC.event.localeChanged, boot);
}
