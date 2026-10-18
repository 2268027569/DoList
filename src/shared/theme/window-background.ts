import type { ThemeMode } from '../types/app';

/**
 * The only color the main process needs: the window background, painted before
 * the renderer commits its first frame so there is no white flash (§7).
 *
 * Mirrors `--bg-surface` of the built-in themes in `tokens.css`; the static
 * token check (`scripts/check-tokens.mjs`) fails the build if they diverge.
 */
export const WINDOW_BACKGROUND: Record<ThemeMode, string> = {
  light: '#FFFFFF',
  dark: '#1E1F23',
};

export const TRANSPARENT_WINDOW_BACKGROUND = '#00000000';
