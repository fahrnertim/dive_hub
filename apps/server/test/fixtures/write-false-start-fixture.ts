// Writes apps/web/e2e/fixtures/false-start.json: 50 seconds at 1.8 m in 2019, far from every other fixture, for the
// browser test of the logbook check `short_shallow_dive` (ADR 0038): a Dive that is probably no dive.
// Run: pnpm --filter @dive-hub/server exec tsx test/fixtures/write-false-start-fixture.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSuuntoJson } from './suunto-dive.js';

const out = fileURLToPath(new URL('../../../web/e2e/fixtures/false-start.json', import.meta.url));
writeFileSync(out, makeSuuntoJson({
  start: new Date('2019-02-03T10:00:00.000Z'), durationSeconds: 50, maxDepthM: 1.8, serialNumber: '900000000777',
  waypoints: [[0, 0.4], [0.4, 1.7], [0.83, 0.3]],
}));
console.log(`wrote ${out}`);
