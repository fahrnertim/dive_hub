import { defineConfig } from 'vitest/config';

// Unit tests only; the browser tests in e2e/ run with Playwright (pnpm test:e2e).
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
