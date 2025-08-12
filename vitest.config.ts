import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup/vitest.setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.ts'],
    exclude: ['tests/e2e/**'],
    globals: true,
    watch: false,
    clearMocks: true,
    reporters: ['default'],
  },
});

// Converted to JS at vite/vitest level for simpler setup
// See `vitest.config.js`



