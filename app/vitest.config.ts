import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    /* toBeDisabled, toHaveValue and friends. Assertions about the DOM
       read far better than poking at attributes by hand. */
    setupFiles: ['./src/test-setup.ts'],
  },
});
