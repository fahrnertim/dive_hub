#!/usr/bin/env node
// The checks for what changed (ADR 0023): typecheck, lint and module boundaries of the changed files (amendment of
// 2026-10-22), the unit tests whose imports changed, and the browser tests of the areas touched. `pnpm check` while working and before a commit; `pnpm check:full`
// everything, which CI runs on every pull request: no full check by hand before a push (ADR 0023, amendment of 2026-10-24).
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
// The browser tests run in one lane, the other steps in another beside it (in CI one after another), and every
// step runs to its end; each step's output goes to node_modules/.cache/check/logs, printed when it fails
// (ADR 0023, amendment of 2026-10-26).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { QUIET, STEPS, browserGrepInvert, browserTestList, listedTests, changedSince, variantsRun, clearFailed, countingBase, e2eServerLoads, failedRerunRenews, failedRun, forBrowserTests, keptFailures, failedTestsFromReport, REPORT, fullPlan, lintTargets, planSteps, recordFailed, recordGreen, snapshot } from './check-lib.mjs';
import { appendRun, browserStats, logPath } from './check-log.mjs';
import { runLanes, takeLock } from './check-run.mjs';

const args = process.argv.slice(2);
// pnpm check runs axe once per ui-quality test, on its final state; check:full (CI) at every page check (ADR 0023,
// amendment of 2026-10-24). Set here so that --failed reruns tests the way the failed check ran them.
if (!args.includes('--full')) process.env.E2E_AXE ??= 'once';

/**
 * One check at a time per clone (a second would fight the first over the ports, the browsers and the cache): the lock
 * is `check.lock` in the git directory. Released on every way out: the normal end, a failure, Ctrl-C, an uncaught error.
 */
let lanesRunning = false;
if (!args.includes('--dry')) {
  const lock = takeLock(resolve(spawnSync('git rev-parse --git-common-dir', { encoding: 'utf8', shell: true }).stdout.trim(), 'check.lock'));
  if (lock.heldBy !== undefined) {
    console.error(`check: another pnpm check is running (pid ${lock.heldBy})`);
    process.exit(1);
  }
  process.on('exit', lock.release);
  // The steps' own Ctrl-C handling (runLanes) ends the run; anywhere else the default would skip the exit handlers.
  process.on('SIGINT', () => { if (!lanesRunning) process.exit(130); });
}

const git = (cmd) => spawnSync(`git ${cmd}`, { encoding: 'utf8', shell: true }).stdout.trim();

/**
 * Appends this run to the local run log (`check-runs.jsonl`, read by `pnpm check:log`), for a run that ran steps; never in
 * CI. The check's result is unchanged when the log cannot be written: one line says so.
 */
function logRun({ steps, results, browserSince }) {
  if (process.env.CI) return;
  const statuses = results.map(({ status }) => status);
  const result = statuses.includes(null) ? 'interrupted' : statuses.some((status) => status !== 0) ? 'failed' : 'passed';
  const entry = {
    at: new Date().toISOString(), branch: git('symbolic-ref --short -q HEAD') || null, head: git('rev-parse --short HEAD'),
    by: process.env.CHECK_FROM_HOOK ? 'hook' : 'person', args, wall: Math.round(process.uptime()), result, steps,
  };
  if (browserSince !== undefined) {
    try {
      // Only a report written during the browser step; an older one is not this run's.
      if (statSync(REPORT).mtimeMs >= browserSince) entry.browser = browserStats(JSON.parse(readFileSync(REPORT, 'utf8')));
    } catch { /* no report */ }
  }
  if (!appendRun(entry, logPath())) console.log('check: run log skipped (could not write check-runs.jsonl)');
}

const LAST_RUN = 'apps/web/test-results/.last-run.json';
/** The ids of the browser tests that failed in Playwright's last run. */
function lastFailed() {
  try {
    return JSON.parse(readFileSync(LAST_RUN, 'utf8')).failedTests ?? [];
  } catch {
    return []; // no browser run yet
  }
}

/**
 * The failed tests a browser step that started at `startedAt` may keep (`keptFailures`): Playwright's report only
 * when it was written during the step. The config sets no maxFailures today; if it ever does, nothing is kept.
 */
function failuresSince(startedAt) {
  let lastRun = null;
  let writtenAt = null;
  try {
    lastRun = JSON.parse(readFileSync(LAST_RUN, 'utf8'));
    writtenAt = statSync(LAST_RUN).mtimeMs;
  } catch { /* no report */ }
  const stopsEarly = /maxFailures/.test(readFileSync('apps/web/playwright.config.ts', 'utf8'));
  return keptFailures({ lastRun, writtenAt, startedAt, stopsEarly });
}

/** The failed tests' `--test-list` lines from Playwright's JSON report, only when it was written after `startedAt`; else none. */
function failedTitlesSince(startedAt) {
  try {
    if (statSync(REPORT).mtimeMs < startedAt) return [];
    return failedTestsFromReport(JSON.parse(readFileSync(REPORT, 'utf8')));
  } catch {
    return []; // no report
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
  const startedAt = Date.now();
  const ran = spawnSync('pnpm --filter @dive-hub/web test:e2e --last-failed', { stdio: 'inherit', shell: true });
  const status = ran.status ?? 1;
  logRun({ steps: [{ step: 'e2e', from: '--failed', changed: failed.length, plan: 'failed', seconds: Math.round((Date.now() - startedAt) / 1000), status: ran.status }], results: [{ status: ran.status }], browserSince: startedAt });
  if (verdict.renews && status === 0) {
    recordGreen('e2e', tree);
    clearFailed('e2e');
    console.log('check: browser tests recorded green on these files; the next pnpm check counts from here');
  } else if (verdict.renews) {
    // Some failed again: a later --failed reruns those, still on the same files; without a fresh report, nothing.
    const again = failuresSince(startedAt);
    if (again.failedTests) recordFailed('e2e', tree, { ids: again.failedTests, tests: failedTitlesSince(startedAt) });
    else clearFailed('e2e');
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

const pnpm = (cmd) => `pnpm ${cmd}`;
const CACHE = resolve('node_modules/.cache/check');
/** Writes `lines` to a file in the check's cache (long lists stay off the command line); returns its path. */
function listFile(name, lines) {
  const file = resolve(CACHE, name);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

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

/** The lane beside the browser tests: typecheck, lint, the check script's tests and the unit tests. */
function otherSteps() {
  const lane = [];
  if (plan.typecheck) lane.push({ name: 'typecheck', command: pnpm('typecheck'), step: 'typecheck' });
  // ESLint and dependency-cruiser against their baselines; only problems are printed (ADR 0039).
  const lintFiles = since.lint.changed;
  const targets = lintTargets(lintFiles);
  const count = new Set([...targets.eslint, ...targets.deps]).size;
  if (plan.lint === 'all') lane.push({ name: 'lint and module boundaries (all)', command: 'node scripts/check-lint.mjs --all', step: 'lint' });
  else if (plan.lint === 'changed' && count > 0) {
    const file = dry ? resolve(CACHE, 'lint-files.txt') : listFile('lint-files.txt', lintFiles);
    lane.push({ name: `lint and module boundaries (${count} changed file(s))`, command: `node scripts/check-lint.mjs --files-from "${file}"`, step: 'lint' });
  }
  if (plan.scripts) lane.push({ name: 'check script tests', command: 'node --test scripts/check-lib.test.mjs scripts/agent-lib.test.mjs scripts/check-run.test.mjs scripts/check-log.test.mjs', step: 'scripts' });
  if (plan.server !== 'none') lane.push({ name: `server tests (${plan.server})`, command: unitTests('server', plan.server), step: 'server' });
  if (plan.web !== 'none') lane.push({ name: `web unit tests (${plan.web})`, command: unitTests('web', plan.web), step: 'web' });
  return lane;
}

/** The `playwright test --list` lines (as `--test-list` lines) of the browser tests narrowed by `filters`; null when the listing failed. */
function listBrowserTests(filters) {
  const { stdout, stderr, status } = spawnSync(`pnpm --filter @dive-hub/web exec playwright test --project=e2e --list --pass-with-no-tests${filters}`, { encoding: 'utf8', shell: true });
  if (status === 0) return listedTests(stdout ?? '');
  console.log(`${stdout ?? ''}${stderr ?? ''}`);
  return null;
}

/** The browser step that failed before it ran, its tests not listable; the failed run's record stays as it is. */
let unlisted = null;

/**
 * After a failed run and a fix: the owed (failed) tests plus the planned ones, through one `--test-list` file
 * (ADR 0023, amendment of 2026-10-26), listed before the lanes start. Owed tests that no longer exist are dropped,
 * said so. Null when there is nothing to run (then green) or the tests could not be listed (then failed).
 */
function browserOwedStep(name, { owed, filters, planned: plannedNone }) {
  const file = resolve(CACHE, 'e2e-tests.txt');
  const step = { name, command: pnpm(`--filter @dive-hub/web test:e2e --test-list "${file}"`), step: 'e2e' };
  if (dry) return step;
  const all = listBrowserTests('');
  const planned = plannedNone || !all ? [] : listBrowserTests(filters);
  if (!all?.length || !planned) {
    console.log(`✗ ${name} failed\ncheck: could not list the browser tests; the failed run stays owed`);
    unlisted = { name, step: 'e2e', status: 1, seconds: 0, log: null };
    return null;
  }
  const { lines, dropped } = browserTestList({ all, planned, owed });
  for (const line of dropped) console.log(`check: ${line} no longer exists; dropped from the owed tests`);
  if (lines.length === 0) {
    console.log('check: no owed browser test is left and none is planned; nothing to run');
    if (records) clearFailed('e2e'); // and, as a step not planned, green below
    return null;
  }
  listFile('e2e-tests.txt', lines);
  console.log(`check: ${lines.length} browser test(s) in ${file}`);
  return step;
}

/** The browser lane: the area tags check, then the browser tests. */
function browserSteps() {
  const owedTests = since.e2e.owed ?? []; // none with --files or --base
  if (plan.e2e === 'none' && owedTests.length === 0) return [];
  const lane = plan.e2e === 'none' ? [] : [{ name: 'browser test tags', command: 'node scripts/check-tags.mjs', step: null }];
  const grep = [...plan.areas, ...[...plan.specs].map((s) => s.replace(/\./g, '\\.'))].join('|');
  const which = plan.e2e === 'all' ? 'all' : grep || 'none';
  // The variants of ui-quality that only the full check runs, and the German, dark, phone one unless texts, shared
  // styles or shared UI changed (ADR 0023, amendment of 2026-10-24). Counted from the files before texts were narrowed.
  const variants = variantsRun(since.e2e.changed);
  if (!full) {
    console.log(`check: ${variants.why ?? 'browser tests in English, light, desktop only; the other ui-quality variants run in CI (pnpm check:full)'}`);
    if (process.env.E2E_AXE === 'once') console.log('check: axe once per ui-quality test, on its final state; CI runs it at every page check');
  }
  const leftOut = browserGrepInvert({ full, variants: variants.run });
  const without = leftOut ? ` --grep-invert "${leftOut}"` : '';
  const filters = `${plan.e2e === 'all' ? '' : ` --grep "${grep}"`}${without}`;
  if (owedTests.length === 0) return [...lane, { name: `browser tests (${which}${leftOut ? `, without ${leftOut}` : ''})`, command: pnpm(`--filter @dive-hub/web test:e2e${filters}`), step: 'e2e' }];
  const owedStep = browserOwedStep(`browser tests (${owedTests.length} failed test(s) owed + ${which})`, { owed: owedTests, filters, planned: plan.e2e === 'none' });
  return owedStep ? [...lane, owedStep] : lane;
}

const lanes = [browserSteps(), otherSteps()].filter((lane) => lane.length > 0);
const steps = lanes.flat();

// A step with nothing to run is as green on this state as on the one it last passed on.
const planned = new Set([...steps.map(({ step }) => step), ...(unlisted ? ['e2e'] : [])]);
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
if (steps.length === 0 && !unlisted) {
  console.log(STEPS.every((step) => since[step].changed.length === 0) ? 'check: nothing changed, nothing to run' : 'check: only documentation and other quiet files changed; nothing to run');
  process.exit(0);
}
// In CI one after another (its runner has fewer cores); here the lanes side by side.
const sequential = Boolean(process.env.CI);
console.log(`check: ${lanes.length > 1 ? (sequential ? 'one step after another' : 'two lanes side by side') : 'one lane'}, every step to its end\n${lanes.map((lane) => `  - ${lane.map(({ name }) => name).join(' → ')}`).join('\n')}`);

if (dry) process.exit(0);

/** A failed browser step keeps its files and failed tests: `pnpm check --failed` can then make it green. */
function browserFailed(result) {
  if (!records) return;
  const started = Date.now() - result.seconds * 1000;
  const kept = failuresSince(started);
  if (kept.failedTests) {
    recordFailed('e2e', tree, { ids: kept.failedTests, tests: failedTitlesSince(started) });
    console.log('check: pnpm check --failed reruns the failed browser tests; if they pass on these files, the browser tests count as green');
    return;
  }
  clearFailed('e2e');
  if (kept.why) console.log(`check: nothing kept for pnpm check --failed: ${kept.why}`);
}

/** As each step ends: one line when it passed (and its green record), its log when it failed. */
function stepEnded(result) {
  if (result.status === 0) {
    console.log(`✓ ${result.name} (${Math.round(result.seconds)} s)`);
    if (records && result.step) recordGreen(result.step, tree);
    if (records && result.step === 'e2e') clearFailed('e2e');
    return;
  }
  console.log(`\n✗ ${result.name} failed\n${readFileSync(result.log, 'utf8').trimEnd()}\n`);
  if (result.step === 'e2e') browserFailed(result);
}

/** Every step's time and the failures; the exit code: 1 when a step failed, 130 when interrupted. */
function summary(results) {
  const all = unlisted ? [unlisted, ...results] : results;
  const times = all.map(({ name, status, seconds }) => `${name}: ${status === null ? 'not finished' : `${Math.round(seconds)} s`}`).join('\n');
  const failed = all.filter(({ status }) => status !== 0 && status !== null);
  if (all.some(({ status }) => status === null)) {
    console.log(`\ncheck: interrupted\n${times}`);
    return 130;
  }
  if (failed.length > 0) {
    console.log(`\n✗ ${failed.length} step(s) failed: ${failed.map(({ name }) => name).join(', ')}\n${times}`);
    return 1;
  }
  console.log(`\n✓ all checks passed\n${times}`);
  return 0;
}

lanesRunning = true;
const lanesStartedAt = Date.now();
const results = await runLanes(lanes, { sequential, outDir: resolve(CACHE, 'logs'), onEnd: stepEnded });
const code = summary(results);
const all = unlisted ? [unlisted, ...results] : results;
logRun({
  steps: all.filter(({ step }) => step).map(({ step, seconds, status }) => ({ step, from: since[step].from, changed: since[step].changed.length, plan: plan[step], seconds: Math.round(seconds), status })),
  results: all,
  browserSince: all.some(({ step, seconds }) => step === 'e2e' && seconds > 0) ? lanesStartedAt : undefined,
});
process.exit(code);
