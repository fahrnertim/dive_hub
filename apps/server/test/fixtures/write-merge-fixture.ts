// Writes apps/web/e2e/fixtures/mergeable-main.fit and mergeable-backup.fit: dive 31 from two computers no other spec
// uses, for the browser tests that merge two Dives (ADR 0038). Imported, they are one Dive with two Recordings; the
// tests split the backup off to get two Dives at the same time.
// Run: pnpm --filter @dive-hub/server exec tsx test/fixtures/write-merge-fixture.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSyntheticDive } from './synthetic-dive.js';

const out = (name: string) => fileURLToPath(new URL(`../../../web/e2e/fixtures/${name}`, import.meta.url));
writeFileSync(out('mergeable-main.fit'), makeSyntheticDive({ serialNumber: 881, start: new Date('2026-04-02T08:00:00Z'), diveNumber: 31, maxDepthM: 16.4 }));
writeFileSync(out('mergeable-backup.fit'), makeSyntheticDive({ serialNumber: 882, start: new Date('2026-04-02T08:00:20Z'), diveNumber: 31, maxDepthM: 16.1 }));
console.log(`wrote ${out('mergeable-main.fit')} and ${out('mergeable-backup.fit')}`);
