import { defineConfig } from 'vitest/config';

/**
 * Pure domain-logic unit tests (AGENTS.md §9). Node environment — the shared
 * package has no DOM, network, or framework dependencies.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
