// Browser tests (ADR 0015): the built web client against the real server and a fresh database.
//   pnpm --filter @dive-hub/web test:e2e
// Uses an installed browser (Edge by default; PLAYWRIGHT_CHANNEL=chrome for Chrome), so no download.
import { defineConfig } from '@playwright/test';
import { E2E_BASE_URL, E2E_PORT } from './e2e/support.ts';

export default defineConfig({
  testDir: 'e2e',
  // One server, one database, one seeded Dive: tests run one after another and reset it themselves.
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: E2E_BASE_URL,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
    locale: 'en-GB',
    storageState: 'e2e/.state/user.json',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx test/e2e-server.ts',
    cwd: '../server',
    url: `${E2E_BASE_URL}/api/health/ready`,
    env: { E2E_PORT: String(E2E_PORT) },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
