// Vitest configuration for unit tests with jsdom and chrome API mocks
// Using JS for compatibility out of the box
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup/vitest.setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.ts'],
    globals: true,
    watch: false,
    clearMocks: true,
    reporters: ['default'],
  },
});


