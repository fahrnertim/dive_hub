// Writes apps/web/e2e/fixtures/account-export.zip: a hand-made upload in the layout of Garmin's account export
// (ADR 0044), for the browser test of the choice of kinds. It holds the seeded dive (main-computer.fit, so choosing
// the scuba dives adds nothing to the logbook), one apnea session and one run; nothing of it comes from a real export.
// Run: pnpm --filter @dive-hub/server exec tsx test/fixtures/write-account-export-fixture.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipOf } from '../zip.js';
import { makeSyntheticDive, makeSyntheticRun } from './synthetic-dive.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../../web/e2e/fixtures/${name}`, import.meta.url));
const out = fixture('account-export.zip');
writeFileSync(out, await zipOf({
  'DI_CONNECT/DI-Connect-User/user_profile.json': '{}',
  'DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip': await zipOf({
    'diver@example.com_1.fit': Buffer.from(makeSyntheticRun()),
    'diver@example.com_2.fit': readFileSync(fixture('main-computer.fit')),
    'diver@example.com_3.fit': Buffer.from(makeSyntheticDive({
      serialNumber: 4444, start: new Date('2026-05-09T10:00:00Z'), durationSeconds: 12 * 60, maxDepthM: 6.4, subSport: 'apneaDiving',
    })),
  }),
}));
console.log(`wrote ${out}`);
