import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    /* Starts one Postgres container for the entire run. Per-file
       setup raced on the published port; see test/global-setup.ts. */
    globalSetup: ['test/global-setup.ts'],
    /* One Postgres container, shared. Running files in parallel would
       have them truncating each other's fixtures mid-assertion. */
    fileParallelism: false,
    // Pulling and starting postgres:16-alpine on a cold machine is slow.
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
