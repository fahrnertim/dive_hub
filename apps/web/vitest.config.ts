import { defineConfig } from 'vitest/config';

// Unit tests only; the browser tests in e2e/ run with Playwright (pnpm test:e2e).
// A *.test.ts runs in Node; a *.test.tsx is a component test and runs in jsdom, set up by test/dom-setup.ts.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/**/*.test.ts'] } },
      { test: { name: 'component', include: ['test/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['test/dom-setup.ts'] } },
    ],
  },
});
