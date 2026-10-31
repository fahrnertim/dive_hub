// Writes the owner's dive 85/86 for the browser tests (ADR 0063):
//   pnpm --filter @dive-hub/server exec tsx test/fixtures/write-continuation-fixture.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ownersDiveParts } from './surface-break-dive.js';

const { first, second } = ownersDiveParts();
for (const [name, bytes] of [['surface-break-first.fit', first], ['surface-break-second.fit', second]] as const) {
  const out = fileURLToPath(new URL(`../../../web/e2e/fixtures/${name}`, import.meta.url));
  writeFileSync(out, bytes);
  console.log(`wrote ${out}`);
}
