#!/usr/bin/env node
// The checks for what changed (ADR 0023): typecheck, the unit tests whose imports changed, and the
// browser tests of the areas touched. `pnpm check` while working and before a commit; `pnpm check:full` before a
// push or a release (ADR 0023, amendment of 2026-10-08).
//   pnpm check                 changes since each step's last green run, or since the last commit when none is recorded
//   pnpm check --base main     changes since another commit or branch (--base HEAD: all uncommitted changes)
//   pnpm check:full            everything
//   pnpm check --dry           only say what would run and from which base (with --files a,b: for these paths)
//   pnpm check --failed        only the browser tests that failed in the last browser run; records nothing
// A step that passes records the state it passed on (a local git ref, refs/check/green-<step>); a run with --base
// or --files records nothing. Unknown paths count as "everything": when in doubt, run more.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { readFileSync } from 'node:fs';
import { FULL_ONLY, QUIET, STEPS, TAGS, changedSince, forBrowserTests, fullPlan, greenRun, planSteps, recordGreen, snapshot } from './check-lib.mjs';

const args = process.argv.slice(2);

// --failed: after a failing browser run, only the tests that failed (Playwright's record of its last run). It
// says nothing about the other tests, so it records nothing: `pnpm check` afterwards runs the browser plan whole.
if (args.includes('--failed')) {
  let failed = [];
  try {
    failed = JSON.parse(readFileSync('apps/web/test-results/.last-run.json', 'utf8')).failedTests ?? [];
  } catch { /* no browser run yet */ }
  if (failed.length === 0) {
    console.log('check: no browser test failed in the last browser run; nothing to run');
    process.exit(0);
  }
  console.log(`check: the ${failed.length} browser test(s) that failed in the last browser run; nothing is recorded`);
  process.exit(spawnSync('pnpm --filter @dive-hub/web test:e2e --last-failed', { stdio: 'inherit', shell: true }).status ?? 1);
}
const full = args.includes('--full');
const dry = args.includes('--dry');
const givenBase = args.includes('--base') ? args[args.indexOf('--base') + 1] : null;
// --files a,b: pretend these changed (to see what a change would run, with --dry).
const given = args.includes('--files') ? args[args.indexOf('--files') + 1].split(',') : null;
// Only a run that started from the recorded state can say that the state it passed on is green.
const records = !dry && !given && !givenBase;

// The state this run checks. Taken before anything runs: an edit made during the run counts as changed next time.
const tree = given ? null : snapshot();
/** Per step: where its changed files are counted from, and the files. */
const since = Object.fromEntries(STEPS.map((step) => {
  if (given) return [step, { from: '--files', base: null, changed: given }];
  if (givenBase) return [step, { from: givenBase, base: givenBase, changed: changedSince(givenBase, tree) }];
  const green = greenRun(step);
  return [step, green
    ? { from: `its green run of ${green.at}`, base: green.base, changed: changedSince(green.base, tree) }
    : { from: 'the last commit (no green run recorded)', base: 'HEAD', changed: changedSince('HEAD', tree) }];
}));
// Changed texts count, for the browser tests, as the source files that use them.
const browser = forBrowserTests(since.e2e.changed, since.e2e.base, tree);
const plan = full ? fullPlan() : planSteps({ ...Object.fromEntries(STEPS.map((step) => [step, since[step].changed])), e2e: browser.changed });
if (!full) for (const note of [browser.note, ...plan.notes]) if (note) console.log(`check: ${note}`);

/** Fails when a browser test has no area tag (ADR 0023): the checks by area would never run it. */
function untaggedBrowserTests() {
  const { stdout, stderr } = spawnSync(`pnpm --filter @dive-hub/web exec playwright test --project=e2e --list --grep-invert "${TAGS.join('|')}"`, { encoding: 'utf8', shell: true });
  const total = /Total: (\d+) tests?/.exec(stdout ?? '');
  if (!total) { console.log(`${stdout}${stderr}\nthe browser tests could not be listed`); return 1; }
  if (total[1] === '0') return 0;
  console.log(`${stdout}\nThese browser tests have no area tag (${TAGS.join(', ')}): give each one, or the checks by area never run them.`);
  return 1;
}

const pnpm = (cmd) => `pnpm ${cmd}`;
/**
 * The unit tests of one app: all of them, or those that import a changed file (`vitest related`, which is what
 * `vitest --changed` runs, but from our list of files: vitest's own list can only start at a commit).
 */
function unitTests(app, level) {
  const run = `--filter @dive-hub/${app} exec vitest`;
  if (level === 'all') return pnpm(`${run} run --passWithNoTests`);
  const files = since[app].changed.filter((path) => !QUIET.test(path) && existsSync(path)).map((path) => relative(`apps/${app}`, path).replace(/\\/g, '/'));
  const related = pnpm(`${run} related --run --passWithNoTests ${files.map((file) => `"${file}"`).join(' ')}`);
  // Windows takes about 8000 characters in one command.
  return related.length < 7000 ? related : pnpm(`${run} run --passWithNoTests`);
}

/** The steps to run: [name, command or function, the step in STEPS it completes (or null)]. */
const steps = [];
if (plan.typecheck) steps.push(['typecheck', pnpm('typecheck'), 'typecheck']);
if (plan.scripts) steps.push(['check script tests', 'node --test scripts/check-lib.test.mjs', 'scripts']);
if (plan.server !== 'none') steps.push([`server tests (${plan.server})`, unitTests('server', plan.server), 'server']);
if (plan.web !== 'none') steps.push([`web unit tests (${plan.web})`, unitTests('web', plan.web), 'web']);
if (plan.e2e !== 'none') {
  steps.push(['browser test tags', untaggedBrowserTests, null]);
  const grep = [...plan.areas, ...[...plan.specs].map((s) => s.replace(/\./g, '\\.'))].join('|');
  const which = plan.e2e === 'all' ? 'all' : grep;
  // The variants of ui-quality that only the full check runs (ADR 0023).
  const without = full ? '' : ` --grep-invert "${FULL_ONLY}"`;
  steps.push([`browser tests (${which}${full ? '' : `, without ${FULL_ONLY}`})`, pnpm(`--filter @dive-hub/web test:e2e${plan.e2e === 'all' ? '' : ` --grep "${grep}"`}${without}`), 'e2e']);
}

// A step with nothing to run is as green on this state as on the one it last passed on.
const planned = new Set(steps.map(([, , step]) => step));
if (records) for (const step of STEPS) if (!planned.has(step)) recordGreen(step, tree);

/** "3 changed file(s) since …": one line when every step counts from the same base, else a line per base. */
function bases() {
  const names = { typecheck: 'typecheck', scripts: 'check script tests', server: 'server tests', web: 'web unit tests', e2e: 'browser tests' };
  const byBase = new Map();
  for (const step of STEPS) {
    const text = `${since[step].changed.length} changed file(s) since ${since[step].from}`;
    byBase.set(text, [...(byBase.get(text) ?? []), names[step]]);
  }
  if (byBase.size === 1) return `check: ${[...byBase.keys()][0].replace(' its ', ' the ')}`;
  return `check: each step counts from its own last green run\n${[...byBase].map(([text, stepNames]) => `  ${stepNames.join(', ')}: ${text}`).join('\n')}`;
}

console.log(full ? 'check: everything' : bases());
if (steps.length === 0) {
  console.log(STEPS.every((step) => since[step].changed.length === 0) ? 'check: nothing changed, nothing to run' : 'check: only documentation and other quiet files changed; nothing to run');
  process.exit(0);
}
console.log(steps.map(([name]) => `  - ${name}`).join('\n'));

if (dry) process.exit(0);
const times = [];
for (const [name, cmd, step] of steps) {
  console.log(`\n▶ ${name}${typeof cmd === 'string' ? `: ${cmd}` : ''}`);
  const started = Date.now();
  const status = typeof cmd === 'string' ? spawnSync(cmd, { stdio: 'inherit', shell: true }).status : cmd();
  times.push(`${name}: ${Math.round((Date.now() - started) / 1000)} s`);
  if (status !== 0) {
    console.log(`\n✗ ${name} failed\n${times.join('\n')}`);
    process.exit(status ?? 1);
  }
  if (records && step) recordGreen(step, tree);
}
console.log(`\n✓ all checks passed\n${times.join('\n')}`);
