// Writes apps/web/e2e/fixtures/deletable-computer.fit: dive 9, a computer no other spec uses, for the browser tests
// that delete and restore a Dive (ADR 0026). Run: pnpm --filter @dive-hub/server exec tsx test/fixtures/write-deletion-fixture.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSyntheticDive } from './synthetic-dive.js';

const out = fileURLToPath(new URL('../../../web/e2e/fixtures/deletable-computer.fit', import.meta.url));
writeFileSync(out, makeSyntheticDive({ serialNumber: 666, start: new Date('2026-03-05T08:00:00Z'), diveNumber: 9, maxDepthM: 15.2 }));
console.log(`wrote ${out}`);
