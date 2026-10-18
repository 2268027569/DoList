import type { RendererApi } from './index';

declare global {
  interface Window {
    /** Whitelisted bridge installed by the preload script (docs/ARCHITECTURE.md §6.5). */
    readonly api: RendererApi;
  }
}

export {};
