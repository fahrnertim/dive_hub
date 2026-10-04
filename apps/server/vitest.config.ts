// Server tests (ADR 0023). Each test file has its own database, so files don't share data, but they share
// loaded modules: without isolation the suite takes about 35 s instead of 55 s (measured 2026-10-04).
// Module-level state must therefore stay harmless to share (caches, constants), never per-test data.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    isolate: false,
    // More workers made it slower: they compete for PostgreSQL and the CPU (4: 35 s, 6: 37 s, 8: 40 s).
    maxWorkers: 4,
    // Creating and migrating a database per file can take a few seconds while the machine is busy.
    hookTimeout: 30_000,
  },
});
