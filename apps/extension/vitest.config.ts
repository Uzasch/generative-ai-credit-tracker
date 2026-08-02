import { defineConfig } from 'vitest/config';

/**
 * Adapter/business-logic unit tests only (AGENTS.md §9): the pure cost-extraction
 * core, not the DOM/network/messaging glue. Node environment — no WXT auto-imports
 * or browser globals are needed by the pure adapters under test.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
