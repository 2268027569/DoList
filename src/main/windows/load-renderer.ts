import { join } from 'node:path';

import type { BrowserWindow } from 'electron';

import { bootQuery } from '@shared/utils/boot';
import type { BootParams } from '@shared/types/app';

/**
 * Four renderer entries, no router (docs/ARCHITECTURE.md §2). Boot parameters are
 * passed as a query string so every entry can apply them before the first paint
 * (see `src/renderer/shared-ui/boot.ts`) — and an entry that needs more than the boot
 * parameters (the reminder popup's payload, the detail window's task id) adds it to
 * the same string, because the window may be drawn before this process could answer
 * an IPC round trip.
 */
export type RendererEntry = 'panel' | 'marker' | 'reminder' | 'detail' | 'clock';

export async function loadRenderer(
  window: BrowserWindow,
  entry: RendererEntry,
  boot: BootParams,
  extra: Record<string, string> = {},
): Promise<void> {
  const query = { ...bootQuery(boot), ...extra };
  const devServer = process.env['ELECTRON_RENDERER_URL'];

  if (devServer) {
    const url = new URL(`${devServer}/${entry}/index.html`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    await window.loadURL(url.toString());
    return;
  }

  await window.loadFile(join(__dirname, `../renderer/${entry}/index.html`), { query });
}
