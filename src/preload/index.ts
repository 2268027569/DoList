import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import { IPC } from '@shared/contracts/channels';
import type {
  MarkerAnchorPayload,
  MarkerStatePayload,
  PanelStatePayload,
} from '@shared/contracts/channels';
import type { AppSettings } from '@shared/contracts/settings';
import type { BootParams, MarkerAnchor } from '@shared/types/app';
import type { IpcResult } from '@shared/types/ipc';

/**
 * The renderer surface is an explicit allow-list (docs/ARCHITECTURE.md §6.5):
 * no `ipcRenderer` object, no channel strings, no listeners for channels the
 * renderer has no business reading.
 */
function invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<T>>;
}

const api = {
  window: {
    expand: () => invoke<unknown>(IPC.window.expand),
    collapse: () => invoke<unknown>(IPC.window.collapse),
    collapseFinished: () => invoke<null>(IPC.window.collapseFinished),
    setAlwaysOnTop: (enabled: boolean) => invoke<boolean>(IPC.window.setAlwaysOnTop, { enabled }),
    resize: (size: { width: number; height: number }) =>
      invoke<{ width: number; height: number }>(IPC.window.resize, size),
  },
  marker: {
    dragStart: (grab: { grabX: number; grabY: number }) =>
      invoke<null>(IPC.marker.dragStart, grab),
    dragTick: () => invoke<null>(IPC.marker.dragTick),
    dragEnd: () => invoke<MarkerAnchor | null>(IPC.marker.dragEnd),
    setAnchor: (anchor: MarkerAnchor) => invoke<MarkerAnchor>(IPC.marker.setAnchor, anchor),
  },
  settings: {
    get: (key: string) => invoke<AppSettings | string | number | null>(IPC.settings.get, { key }),
    set: (patch: Partial<AppSettings>) => invoke<AppSettings>(IPC.settings.set, patch),
  },
  i18n: {
    setLocale: (locale: string) => invoke<string>(IPC.i18n.setLocale, { locale }),
  },
  app: {
    quit: () => invoke<null>(IPC.app.quit),
  },
  smoke: {
    report: (type: string, detail?: Record<string, unknown>) =>
      invoke<null>(IPC.smoke.report, { type, detail }),
  },
  on: {
    panelState: (listener: (payload: PanelStatePayload) => void) =>
      subscribe(IPC.event.panelState, listener),
    themeChanged: (listener: (payload: BootParams) => void) =>
      subscribe(IPC.event.themeChanged, listener),
    localeChanged: (listener: (payload: { locale: string }) => void) =>
      subscribe(IPC.event.localeChanged, listener),
    markerAnchorChanged: (listener: (payload: MarkerAnchorPayload) => void) =>
      subscribe(IPC.event.markerAnchorChanged, listener),
    markerState: (listener: (payload: MarkerStatePayload) => void) =>
      subscribe(IPC.event.markerState, listener),
  },
} as const;

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

export type RendererApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
