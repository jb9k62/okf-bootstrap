import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// One IIFE file that scripts/okf-view.mts inlines into viz.html. React is bundled in, so the
// viewer needs no extra CDN script, and the CSS is inlined by the entry point (`?inline`).
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Library mode leaves process.env in the bundle, which a browser page does not have. Build
  // only: the tests need the development React, which is the one that exports act.
  define:
    command === 'build'
      ? { 'process.env.NODE_ENV': JSON.stringify('production') }
      : {},
  resolve: {
    alias: {
      // Only pure modules (no I/O, no framework side effects) should come through here, so a
      // widget runs the app's real logic and the explainer cannot drift from it. Change the
      // target to wherever the project's source lives.
      '@app': fileURLToPath(new URL('../../src', import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL('src/index.tsx', import.meta.url)),
      name: 'OkfWidgets',
      formats: ['iife'],
      fileName: () => 'okf-widgets.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));
