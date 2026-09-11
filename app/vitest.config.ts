import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /* Provided by vite-plugin-pwa in the real build; here the app must
         render as if no service worker existed. */
      'virtual:pwa-register/react': fileURLToPath(new URL('./src/test-support/pwa-register.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    /* toBeDisabled, toHaveValue and friends. Assertions about the DOM
       read far better than poking at attributes by hand. */
    setupFiles: ['./src/test-setup.ts'],
    /* Vitest's 5 s default assumes a test spends its time testing. These
       spend it importing: several call `vi.resetModules()` and then
       re-import a route or the repository gate, so the module graph is
       transformed again per case, and with files running in parallel the
       workers contend for a single transform pipeline. Aggregate import
       time across the suite runs to minutes while the assertions
       themselves are milliseconds — so the deadline was firing on machine
       load rather than on anything the code did, and a different two or
       three tests failed on every run. */
    testTimeout: 20_000,
  },
});
