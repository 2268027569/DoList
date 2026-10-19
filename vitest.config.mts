import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Unit tests target `src/shared` first (pure functions, no Electron, no Node
 * built-ins) plus the small pure helpers of the main process. Anything that
 * needs a real window belongs to the Playwright E2E suite instead (docs/ARCHITECTURE.md §12).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@locales': resolve(__dirname, 'locales'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts', 'src/main/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts', 'src/main/db/test-db.ts'],
    },
  },
});
