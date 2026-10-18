import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

const root = __dirname;

/**
 * Production CSP. Injected at build time only, so the dev server keeps the
 * capabilities React Fast Refresh and Tailwind's HMR need.
 *
 * `style-src 'unsafe-inline'` is a deliberate, bounded exception: React inline
 * `style` attributes and Vite's injected stylesheets need it. Scripts stay
 * strictly `'self'` — the app ships no inline script anywhere (boot mode is
 * applied by the module entry, see src/renderer/shared-ui/boot.ts).
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const cspPlugin: Plugin = {
  name: 'yichen:inject-csp',
  apply: 'build',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => ({
      html,
      tags: [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: PRODUCTION_CSP },
          injectTo: 'head-prepend',
        },
      ],
    }),
  },
};

const alias = {
  '@shared': resolve(root, 'src/shared'),
  '@locales': resolve(root, 'locales'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: {
      alias: {
        ...alias,
        '@renderer': resolve(root, 'src/renderer'),
      },
    },
    plugins: [react(), tailwindcss(), cspPlugin],
    build: {
      rollupOptions: {
        input: {
          panel: resolve(root, 'src/renderer/panel/index.html'),
          marker: resolve(root, 'src/renderer/marker/index.html'),
        },
      },
    },
  },
});
