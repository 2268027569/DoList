import { create } from 'zustand';

import type { BootParams, PanelState } from '@shared/types/app';

interface PanelStore {
  boot: BootParams;
  panelState: PanelState;
  setBoot: (boot: BootParams) => void;
  setPanelState: (state: PanelState) => void;
}

/**
 * The panel store stays deliberately small: task data (M02) will live in its own
 * slice, so view state never mixes with repository data (docs/ARCHITECTURE.md §7).
 */
export const usePanelStore = create<PanelStore>((set) => ({
  boot: { mode: 'light', theme: 'minimal', locale: 'en' },
  panelState: 'hidden',
  setBoot: (boot) => set({ boot }),
  setPanelState: (panelState) => set({ panelState }),
}));
