import { release } from 'node:os';

import { TRANSPARENT_WINDOW_BACKGROUND } from '@shared/theme/window-background';

/**
 * The system-drawn backdrop the windows ask for, when the OS can draw one.
 *
 * The panels of this app are their own surfaces — there is no title bar and no
 * system chrome — so the only way to get real frosted glass is to have the OS draw
 * the blur *behind* the window and let the card's own colour sit on top of it.
 *
 * Windows 11 22H2 (build 22621) is the first build with `backgroundMaterial`, the
 * DWM acrylic. macOS has had vibrancy for much longer. Everywhere else the windows
 * stay transparent and paint their own surface, which is the configuration the
 * panel had before (docs/ARCHITECTURE.md §7).
 */
export function windowGlassSupported(): boolean {
  if (process.platform === 'darwin') return true;
  if (process.platform !== 'win32') return false;
  const build = Number(release().split('.')[2] ?? Number.NaN);
  return Number.isFinite(build) && build >= 22621;
}

/** The constructor fields that decide whether a window has a material behind it. */
export interface WindowMaterialOptions {
  transparent: boolean;
  backgroundColor: string;
  roundedCorners: boolean;
  hasShadow: boolean;
  backgroundMaterial?: 'acrylic';
  vibrancy?: 'under-window';
  visualEffectState?: 'active';
}

/**
 * Window options for the material this machine supports.
 *
 * A glass window is deliberately **not** `transparent`: a layered window cannot carry
 * a DWM material, and asking for one leaves a black rectangle. The window's
 * background colour stays fully transparent instead, so the first frame and every
 * pixel the card leaves uncovered show the system's blur rather than a colour.
 *
 * The glass window also takes a real shadow — the transparent one could not, because
 * the shadow of a layered window is drawn around a rectangle the card does not fill
 * (the old 8px CSS margin was doing that job). A material window is a normal shaped
 * window, so DWM can shade it like one.
 */
export function windowMaterialOptions(glass: boolean): WindowMaterialOptions {
  if (!glass) {
    return {
      transparent: true,
      backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
      roundedCorners: false,
      hasShadow: false,
    };
  }

  return {
    transparent: false,
    backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
    roundedCorners: true,
    hasShadow: true,
    ...(process.platform === 'win32' ? { backgroundMaterial: 'acrylic' as const } : {}),
    ...(process.platform === 'darwin'
      ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const }
      : {}),
  };
}
