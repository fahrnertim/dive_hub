// Writes apps/web/e2e/fixtures/live-computer.fit and live-computer-2.fit: two synthetic dives from computers no other
// spec uses, on days no other fixture dives. The browser tests upload one while a logbook is open (ADR 0066):
// a scheduled fetch or import brings a new Dive, and the hint must make it appear without a reload (FAH-38).
// Run: pnpm --filter @dive-hub/server exec tsx test/fixtures/write-live-fixtures.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSyntheticDive } from './synthetic-dive.js';

const write = (name: string, options: Parameters<typeof makeSyntheticDive>[0]) => {
  const out = fileURLToPath(new URL(`../../../web/e2e/fixtures/${name}`, import.meta.url));
  writeFileSync(out, makeSyntheticDive(options));
  console.log(`wrote ${out}`);
};

write('live-computer.fit', { serialNumber: 8801, start: new Date('2026-04-10T09:00:00Z'), diveNumber: 60 });
write('live-computer-2.fit', { serialNumber: 8802, start: new Date('2026-04-11T09:00:00Z'), diveNumber: 61 });
