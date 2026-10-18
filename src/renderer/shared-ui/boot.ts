import { parseBootParams } from '@shared/utils/boot';
import type { BootParams } from '@shared/types/app';

/**
 * Boot parameters must be applied before the first paint so neither window
 * flashes the wrong theme (§7). Both entries call this as their first statement.
 */
export function readBoot(): BootParams {
  const params = parseBootParams(window.location.search);
  applyBootParams(params);
  return params;
}

/**
 * Writes boot parameters onto the document root: `data-mode` selects light/dark,
 * `data-theme` selects the token set and `dir` handles RTL (§7, §8).
 */
export function applyBootParams(params: BootParams): void {
  const root = document.documentElement;
  root.dataset['mode'] = params.mode;
  root.dataset['theme'] = params.theme;
  root.lang = params.locale;
  root.dir = params.locale.startsWith('ar') ? 'rtl' : 'ltr';
}

export function smokeEnabled(boot: BootParams): boolean {
  return boot.smoke === true;
}
