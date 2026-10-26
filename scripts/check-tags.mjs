#!/usr/bin/env node
// A step of pnpm check (scripts/check.mjs): fails when a browser test has no area tag (ADR 0023), naming those
// tests: the checks by area would never run them.
import { spawnSync } from 'node:child_process';
import { TAGS } from './check-lib.mjs';

const { stdout, stderr } = spawnSync(`pnpm --filter @dive-hub/web exec playwright test --project=e2e --list --grep-invert "${TAGS.join('|')}"`, { encoding: 'utf8', shell: true });
const total = /Total: (\d+) tests?/.exec(stdout ?? '');
if (!total) {
  console.log(`${stdout ?? ''}${stderr ?? ''}\nthe browser tests could not be listed`);
  process.exit(1);
}
if (total[1] !== '0') {
  console.log(`${stdout}\nThese browser tests have no area tag (${TAGS.join(', ')}): give each one, or the checks by area never run them.`);
  process.exit(1);
}
