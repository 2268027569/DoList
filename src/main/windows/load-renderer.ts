import { join } from 'node:path';

import type { BrowserWindow } from 'electron';

import { bootQuery } from '@shared/utils/boot';
import type { BootParams } from '@shared/types/app';

/**
 * Two renderer entries, no router (docs/ARCHITECTURE.md §2). Boot parameters are
 * passed as a query string so both entries can apply them before the first paint
 * (see `src/renderer/shared-ui/boot.ts`).
 */
export type RendererEntry = 'panel' | 'marker';

export async function loadRenderer(
  window: BrowserWindow,
  entry: RendererEntry,
  boot: BootParams,
): Promise<void> {
  const devServer = process.env['ELECTRON_RENDERER_URL'];

  if (devServer) {
    const url = new URL(`${devServer}/${entry}/index.html`);
    for (const [key, value] of Object.entries(bootQuery(boot))) {
      url.searchParams.set(key, value);
    }
    await window.loadURL(url.toString());
    return;
  }

  await window.loadFile(join(__dirname, `../renderer/${entry}/index.html`), {
    query: bootQuery(boot),
  });
}
