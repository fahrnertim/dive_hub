// Writes apps/web/e2e/fixtures/assessed-computer.fit: dive 77, a computer no other spec uses, for the browser tests of
// the dive assessment (ADR 0036). 40 m on EAN32 in twenty minutes: a fast descent, 1.6 bar at the bottom, an ascent at
// 13 m/min and three minutes between 3 and 6 m where five are recommended.
// On a day no other fixture dives, so its findings don't depend on which specs ran before.
// Run: pnpm --filter @dive-hub/server exec tsx test/fixtures/write-assessment-fixture.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSyntheticDive } from './synthetic-dive.js';

const out = fileURLToPath(new URL('../../../web/e2e/fixtures/assessed-computer.fit', import.meta.url));
writeFileSync(out, makeSyntheticDive({ serialNumber: 7777, start: new Date('2026-02-20T09:00:00Z'), diveNumber: 77, maxDepthM: 40, durationSeconds: 20 * 60 }));
console.log(`wrote ${out}`);
