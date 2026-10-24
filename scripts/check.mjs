#!/usr/bin/env node
// The checks for what changed (ADR 0023): typecheck, lint and module boundaries of the changed files (amendment of
// 2026-10-22), the unit tests whose imports changed, and the browser tests of the areas touched. `pnpm check` while working and before a commit; `pnpm check:full` before a
// push or a release (ADR 0023, amendment of 2026-10-08).
//   pnpm check                 changes since each step's last green run or since main (where this branch left it),
//                              whichever leaves fewer files; since the last commit when neither exists
//   pnpm check --base main     changes since another commit or branch (--base HEAD: all uncommitted changes)
//   pnpm check:full            everything
//   pnpm check --dry           only say what would run and from which base (with --files a,b: for these paths)
//   pnpm check --failed        only the browser tests that failed in the last browser run; when they pass on the
//                              files the failed pnpm check ran on, the browser tests count as green there
// A step that passes records the state it passed on (a local git ref, refs/check/green-<step>); a failed browser
// step keeps its state and failed tests (refs/check/failed-e2e) for --failed. A run with --base or --files records
// nothing. Unknown paths count as "everything": when in doubt, run more.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { readFileSync } from 'node:fs';
import { QUIET, STEPS, TAGS, browserGrepInvert, changedSince, variantsRun, clearFailed, countingBase, e2eServerLoads, failedRerunRenews, failedRun, forBrowserTests, fullPlan, lintTargets, planSteps, recordFailed, recordGreen, snapshot } from './check-lib.mjs';
import { lint } from './check-lint.mjs';

const args = process.argv.slice(2);

/** The ids of the browser tests that failed in Playwright's last run. */
function lastFailed() {
  try {
    return JSON.parse(readFileSync('apps/web/test-results/.last-run.json', 'utf8')).failedTests ?? [];
  } catch {
    return []; // no browser run yet
  }
}

// --failed: after a failing browser run, only the tests that failed (Playwright's record of its last run). When
// they pass on the same files as the failed browser step of `pnpm check`, every test that step planned has passed
// on them, so the browser step counts as green there (ADR 0023, amendment of 2026-10-24); otherwise it records
// nothing and `pnpm check` afterwards runs the browser plan whole.
if (args.includes('--failed')) {
  const failed = lastFailed();
  if (failed.length === 0) {
    console.log('check: no browser test failed in the last browser run; nothing to run');
    process.exit(0);
  }
  const tree = snapshot();
  const verdict = failedRerunRenews(failedRun('e2e'), tree, failed);
  const outcome = verdict.renews ? `${verdict.why}, so if they pass the browser tests count as green on these files` : `nothing is recorded: ${verdict.why}`;
  console.log(`check: the ${failed.length} browser test(s) that failed in the last browser run; ${outcome}`);
  const status = spawnSync('pnpm --filter @dive-hub/web test:e2e --last-failed', { stdio: 'inherit', shell: true }).status ?? 1;
  if (verdict.renews && status === 0) {
    recordGreen('e2e', tree);
    clearFailed('e2e');
    console.log('check: browser tests recorded green on these files; the next pnpm check counts from here');
  } else if (verdict.renews) {
    // Some failed again: a later --failed reruns those, still on the same files.
    recordFailed('e2e', tree, lastFailed());
  }
  process.exit(status);
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
  return [step, countingBase(step, tree)];
}));
// Changed texts count, for the browser tests, as the source files that use them.
const browser = forBrowserTests(since.e2e.changed, since.e2e.base, tree);
const plan = full ? fullPlan() : planSteps({ ...Object.fromEntries(STEPS.map((step) => [step, since[step].changed])), e2e: browser.changed }, { e2eServerLoads: e2eServerLoads() });
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
// ESLint and dependency-cruiser against their baselines; only problems are printed (ADR 0039).
const lintFiles = since.lint.changed;
const lintTargetsNow = lintTargets(lintFiles);
if (plan.lint === 'all' || (plan.lint === 'changed' && lintTargetsNow.eslint.length + lintTargetsNow.deps.length > 0)) {
  const runLint = () => {
    const problems = lint(plan.lint === 'all' ? { all: true } : { files: lintFiles });
    if (problems) console.log(problems);
    return problems ? 1 : 0;
  };
  steps.push([`lint and module boundaries (${plan.lint === 'all' ? 'all' : `${new Set([...lintTargetsNow.eslint, ...lintTargetsNow.deps]).size} changed file(s)`})`, runLint, 'lint']);
}
if (plan.scripts) steps.push(['check script tests', 'node --test scripts/check-lib.test.mjs scripts/agent-lib.test.mjs', 'scripts']);
if (plan.server !== 'none') steps.push([`server tests (${plan.server})`, unitTests('server', plan.server), 'server']);
if (plan.web !== 'none') steps.push([`web unit tests (${plan.web})`, unitTests('web', plan.web), 'web']);
if (plan.e2e !== 'none') {
  steps.push(['browser test tags', untaggedBrowserTests, null]);
  const grep = [...plan.areas, ...[...plan.specs].map((s) => s.replace(/\./g, '\\.'))].join('|');
  const which = plan.e2e === 'all' ? 'all' : grep;
  // The variants of ui-quality that only the full check runs, and the German, dark, phone one unless texts, shared
  // styles or shared UI changed (ADR 0023, amendment of 2026-10-24). Counted from the files before texts were narrowed.
  const variants = variantsRun(since.e2e.changed);
  if (!full) console.log(`check: ${variants.why ?? `browser tests in English, light, desktop only; the other ui-quality variants run in CI (pnpm check:full)`}`);
  const leftOut = browserGrepInvert({ full, variants: variants.run });
  const without = leftOut ? ` --grep-invert "${leftOut}"` : '';
  steps.push([`browser tests (${which}${leftOut ? `, without ${leftOut}` : ''})`, pnpm(`--filter @dive-hub/web test:e2e${plan.e2e === 'all' ? '' : ` --grep "${grep}"`}${without}`), 'e2e']);
}

// A step with nothing to run is as green on this state as on the one it last passed on.
const planned = new Set(steps.map(([, , step]) => step));
if (records) for (const step of STEPS) if (!planned.has(step)) recordGreen(step, tree);

/** "3 changed file(s) since …": one line when every step counts from the same base, else a line per base. */
function bases() {
  const names = { typecheck: 'typecheck', lint: 'lint', scripts: 'check script tests', server: 'server tests', web: 'web unit tests', e2e: 'browser tests' };
  const byBase = new Map();
  for (const step of STEPS) {
    const text = `${since[step].changed.length} changed file(s) since ${since[step].from}`;
    byBase.set(text, [...(byBase.get(text) ?? []), names[step]]);
  }
  if (byBase.size === 1) return `check: ${[...byBase.keys()][0].replace(' its ', ' the ')}`;
  return `check: each step counts from its own last green run or from main\n${[...byBase].map(([text, stepNames]) => `  ${stepNames.join(', ')}: ${text}`).join('\n')}`;
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
    // A failed browser step keeps its files and failed tests: `pnpm check --failed` can then make it green.
    const keeps = records && step === 'e2e' && lastFailed().length > 0;
    if (keeps) recordFailed('e2e', tree, lastFailed());
    console.log(`\n✗ ${name} failed\n${times.join('\n')}`);
    if (keeps) console.log('check: pnpm check --failed reruns the failed browser tests; if they pass on these files, the browser tests count as green');
    process.exit(status ?? 1);
  }
  if (records && step) recordGreen(step, tree);
  if (records && step === 'e2e') clearFailed('e2e');
}
console.log(`\n✓ all checks passed\n${times.join('\n')}`);
