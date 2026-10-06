// Writes apps/web/e2e/fixtures/suunto-d5.json: a hand-made Suunto D5 dive with a tank pod in the shape of the Suunto
// app's JSON export (ADR 0037), a computer no other spec uses, for the browser test of a Suunto import.
// Run: pnpm --filter @dive-hub/server exec tsx test/fixtures/write-suunto-fixture.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSuuntoJson } from './suunto-dive.js';

const out = fileURLToPath(new URL('../../../web/e2e/fixtures/suunto-d5.json', import.meta.url));
writeFileSync(out, makeSuuntoJson({ serialNumber: '555000000005', start: new Date('2025-11-08T08:30:00.280Z'), utcOffsetMinutes: 60 }));
console.log(`wrote ${out}`);
