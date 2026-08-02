import { defineConfig } from 'vitest/config';

// convex-test runs Convex functions in-memory under the edge-runtime
// environment. `server.deps.inline` is required so convex-test is transformed
// rather than loaded from a prebuilt bundle. See https://docs.convex.dev/testing/convex-test
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
  },
});
