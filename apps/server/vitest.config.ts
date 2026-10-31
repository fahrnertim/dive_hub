// Server tests (ADR 0023). Each test file has its own database, so files don't share data, but they share
// loaded modules: without isolation the suite takes about 35 s instead of 55 s (measured 2026-10-04).
// Module-level state must therefore stay harmless to share (caches, constants), never per-test data.
import { configDefaults, defineConfig } from 'vitest/config';

/** Files that mock a module the app loads (vi.mock): with shared modules another file may have loaded it first. */
const ISOLATED = ['test/route-guards.test.ts'];

export default defineConfig({
  test: {
    isolate: false,
    // More workers made it slower: they compete for PostgreSQL and the CPU (4: 35 s, 6: 37 s, 8: 40 s).
    maxWorkers: 4,
    // Creating and migrating a database per file can take a few seconds while the machine is busy.
    hookTimeout: 30_000,
    // Tests that take 1-2 s alone (several sends, imports, password hashing) passed 5 s when the machine was busy
    // (the whole suite at 100 s instead of 35, 2026-10-06); a test that hangs still fails.
    testTimeout: 15_000,
    projects: [
      { extends: true, test: { name: 'shared', exclude: [...configDefaults.exclude, ...ISOLATED] } },
      { extends: true, test: { name: 'isolated', include: ISOLATED, isolate: true } },
    ],
  },
});
