import { defineConfig } from 'vitest/config';

// Opt-in only: this run creates fictional objects in an authorized Stripe sandbox.
export default defineConfig({ test: {
  include: ['test/stripe-sandbox.canary.ts'], globalSetup: ['test/global-setup.ts'],
  fileParallelism: false, testTimeout: 600_000, hookTimeout: 180_000,
} });
