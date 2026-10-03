// Writes apps/web/e2e/fixtures/sited-computer.fit: dive 7, recorded with an exit position at Dahab's
// lighthouse, for the Dive site browser tests (ADR 0020). Run: pnpm --filter @dive-hub/server exec tsx test/fixtures/write-sited-fixture.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSyntheticDive } from './synthetic-dive.js';

const out = fileURLToPath(new URL('../../../web/e2e/fixtures/sited-computer.fit', import.meta.url));
writeFileSync(out, makeSyntheticDive({
  serialNumber: 555, start: new Date('2026-02-10T08:00:00Z'), diveNumber: 7, maxDepthM: 12.4,
  exit: { latitude: 28.5003, longitude: 34.5197 },
}));
console.log(`wrote ${out}`);
