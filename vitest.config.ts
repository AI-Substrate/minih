import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Many CLI tests shell out to real `node <cli>` subprocesses via execSync
    // (some spawn two+ per test). Under parallel-worker CPU contention a cold
    // node startup can exceed Vitest's implicit 5s default and flake CI, even
    // though each passes in ~1s in isolation. Give the whole suite headroom at
    // the root (~4x the worst observed ~5.6s) instead of chasing individual
    // timers one at a time.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
