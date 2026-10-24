// What the check script plans and what it remembers (ADR 0023): the plan from the changed files, and the record
// of each step's last green run, from which the next run takes its changed files.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';

/** The steps that each remember their own green run, in the order they run. */
export const STEPS = ['typecheck', 'lint', 'scripts', 'server', 'web', 'e2e'];

/** Browser test areas (tags in apps/web/e2e) by source path; first match wins. */
const AREAS = [
  [/^apps\/web\/src\/SiteImportPage\.tsx$/, ['@admin', '@sites']],
  [/^apps\/web\/src\/(SitesPage|SiteForm|SiteHistory)\.tsx$|^apps\/web\/src\/lib\/(site-origin|sites-list|geo)\.ts$/, ['@sites']],
  [/^apps\/web\/src\/SitePicker\.tsx$/, ['@sites', '@dives']],
  // Dive centres and their verification codes (ADR 0043): their own pages, a panel on a Dive site, a line on a Dive.
  [/^apps\/web\/src\/CentresPage\.tsx$|^apps\/web\/src\/ui\/QrCode\.tsx$/, ['@sites', '@dives']],
  // The scanner for verification codes (ADR 0043): on the new centre form, where a centre's number is set, and where a diver's code is taken.
  [/^apps\/web\/src\/CodeScanner\.tsx$|^apps\/web\/src\/lib\/qr-reader\.ts$/, ['@sites', '@divers']],
  [/^apps\/web\/src\/lib\/address-search\.ts$/, ['@sites', '@dives']],
  [/^apps\/web\/src\/(DiveDetail|DiveEditForm|DiveHistory|DiveList|ProfileSketch|DepthProfile|ProfilePlot|Decisions|ReviewPage|ReviewStrip|ReviewRows|ImportPanel|DeleteDive|DeletedDives|MergeDive|LogbookChecks|Participants|Assessment|Cylinders|Weighting|LeadHint|PushRun).tsx$|^apps\/web\/src\/lib\/(dive-values|history|profile|tanks|cylinders|weighting|sketch|logbook|review|devices|importable|deletion|assessment)\.ts$/, ['@dives']],
  // The Dive the deletion browser tests delete and restore (ADR 0026).
  [/^apps\/web\/e2e\/fixtures\/deletable-computer\.fit$/, ['@dives']],
  // The two computers' files of the Dives the merging browser tests merge (ADR 0038).
  [/^apps\/web\/e2e\/fixtures\/mergeable-(main|backup)\.fit$/, ['@dives']],
  // The Dive whose assessment has several findings (ADR 0036).
  [/^apps\/web\/e2e\/fixtures\/assessed-computer\.fit$/, ['@dives']],
  // The Suunto dive a browser test imports (ADR 0037).
  [/^apps\/web\/e2e\/fixtures\/suunto-d5\.json$/, ['@dives']],
  // The upload with several kinds of dive, for the choice of what to import (ADR 0044).
  [/^apps\/web\/e2e\/fixtures\/account-export\.zip$/, ['@dives']],
  // A Diver's codes and details, and taking a scanned code (ADR 0043): on the divers page; the codes also show on a Dive.
  [/^apps\/web\/src\/DiverCodes\.tsx$/, ['@divers', '@dives']],
  [/^apps\/web\/src\/DiversPage\.tsx$/, ['@divers']],
  // A Diver's body weight (ADR 0031), a dialog on the divers page.
  [/^apps\/web\/src\/BodyWeight\.tsx$/, ['@divers']],
  // A Diver certification cards (ADR 0050), a section of the divers page (slice 25c); their server side also takes part in the import.
  [/^apps\/web\/src\/Certifications\.tsx$|^apps\/server\/src\/certifications\//, ['@divers', '@account']],
  [/^apps\/web\/src\/(Account|AccountPage|Connections|ProviderBuddies)\.tsx$|^apps\/web\/src\/lib\/account-tabs\.ts$/, ['@account']],
  // Importing a Provider's dives (ADR 0030): on the Connection, and the dives it makes.
  [/^apps\/web\/src\/(ProviderDiveImport|GoneDives)\.tsx$/, ['@account', '@dives']],
  // A Dive at a Provider, and a Conflict with it asked on the Dive's page and waiting on the Review page (ADR 0056).
  [/^apps\/web\/src\/(ProviderPanel|ProviderConflicts|ProviderConflictsSection)\.tsx$/, ['@dives']],
  // A Dive's numbers at its Providers (ADR 0048): on the Dive's Provider panel, a push run and the account's Connections.
  [/^apps\/web\/src\/(NumberChain|ProviderDiveNumbers)\.tsx$/, ['@dives', '@account']],
  // Providers in the web client (ADR 0027): the account's Connections and each Dive's panels read them.
  [/^apps\/web\/src\/lib\/providers\.ts$/, ['@dives', '@account']],
  [/^apps\/web\/src\/Admin\.tsx$/, ['@admin']],
  // The Tools page (ADR 0032): gas numbers and bottom time; its server computation and the MCP tool that answers the same.
  [/^apps\/web\/src\/Tools(Page|Plan|PlanProfile|Lead)\.tsx$|^apps\/web\/src\/ProfilePlot\.tsx$|^apps\/web\/src\/lib\/tools\.ts$|^apps\/server\/src\/planning\/|^apps\/server\/src\/lead\/|^apps\/server\/src\/mcp\/tools-planning(-gas-plan)?.ts$/, ['@tools']],
  // AI accesses to the MCP endpoint (ADR 0035): on the account page, their switch on the admin page.
  [/^apps\/web\/src\/AiAccess\.tsx$|^apps\/web\/src\/lib\/ai-access\.ts$/, ['@account', '@admin']],
  [/^apps\/server\/src\/mcp\//, ['@account', '@admin']],
  [/^apps\/server\/src\/sites\/import\/|^apps\/server\/src\/providers\/ssi\/ssi-sites\.ts$/, ['@admin', '@sites']],
  [/^apps\/server\/src\/sites\//, ['@sites', '@dives']],
  [/^apps\/server\/src\/centres\//, ['@sites', '@dives']],
  [/^apps\/server\/src\/(dives|imports|fit|suunto|assessment)\/|^apps\/server\/src\/(routes|vocabulary)\.ts$/, ['@dives']],
  // Divers reach further than their page: a Dive shows its Participants and their codes, the account page imports buddies.
  [/^apps\/server\/src\/divers\//, ['@divers', '@dives', '@account']],
  [/^apps\/server\/src\/(users|auth)\//, ['@account', '@admin']],
  [/^apps\/server\/src\/(providers|secrets)\//, ['@dives', '@account']],
  [/^apps\/server\/test\/fixtures\/site-sources\//, ['@admin', '@sites']],
  // Zips SSI's site list for the tests and the browser tests' server (ADR 0025).
  [/^apps\/server\/test\/zip\.ts$/, ['@admin', '@sites']],
];
/** Paths that change no behaviour: no tests. */
export const QUIET = /^(docs\/|samples\/|\.claude\/|\.github\/|\.githooks\/|AGENTS\.md$|CLAUDE\.md$|README\.md$|LICENSE$|NOTICE$|skills-lock\.json$|\.gitignore$|\.dockerignore$|\.env\.example$|compose(\.dev)?\.yaml$|Dockerfile$|apps\/server\/test\/fixtures\/site-sources\/record\.ts$|apps\/server\/test\/fixtures\/ssi\/round-trip\.ts$|apps\/server\/test\/fixtures\/write-assessment-fixture\.ts$|apps\/server\/test\/fixtures\/write-suunto-fixture\.ts$|apps\/server\/test\/fixtures\/write-merge-fixture\.ts$|apps\/server\/test\/fixtures\/write-account-export-fixture\.ts$|scripts\/token-report\.mjs$|scripts\/fit-compressibility\.mjs$)/;

/** The area tags a browser test can have; a test with none of them would run only in the full check. */
export const TAGS = ['@dives', '@divers', '@sites', '@account', '@admin', '@layout', '@tools'];

/** The tag of browser tests that only the full check runs: ui-quality's two variants without axe (small phone, tablet). */
export const FULL_ONLY = '@full';

/**
 * The tag of ui-quality's other variant with axe (German, dark, phone), which `pnpm check` runs only when texts,
 * shared styles or shared UI changed; CI's full check always runs it (amendment of 2026-10-24).
 */
export const VARIANTS = '@variants';
const VARIANT_TRIGGERS = /^apps\/web\/src\/((i18n|ui|design)\/|(App|main)\.tsx$|pages\.css$)/;

/** Whether `pnpm check` runs the other ui-quality variants for these changed files: `{ run, why }`. */
export function variantsRun(changed) {
  const triggers = changed.filter((path) => VARIANT_TRIGGERS.test(path));
  if (triggers.length === 0) return { run: false, why: null };
  return { run: true, why: `${triggers.join(', ')} changed texts, shared styles or shared UI, so the German, dark, phone variant of the areas touched runs too` };
}

/** The browser tests a run leaves out (`--grep-invert`), or null for none. */
export function browserGrepInvert({ full, variants }) {
  if (full) return null;
  return variants ? FULL_ONLY : `${FULL_ONLY}|${VARIANTS}`;
}

/** The plan that runs everything (`pnpm check:full`). */
export const fullPlan = () => ({ typecheck: true, lint: 'all', scripts: true, server: 'all', web: 'all', e2e: 'all', areas: new Set(), specs: new Set(), notes: [] });

/**
 * Test helpers outside the test files (amendment of 2026-10-24); false when `path` isn't one.
 * - Under apps/server/test (helpers, fixtures, one-off scripts): the server tests that import the file; the test
 *   setup and data files (read, not imported) all server tests; every browser test only when the browser tests'
 *   server loads the file (`loads`; without it, every helper counts as loaded).
 * - Under apps/web/e2e (setup and data): every browser test. The review capture is not part of the check.
 */
function planTestSupport(path, plan, more, loads) {
  if (path.startsWith('apps/server/test/')) {
    const data = !path.endsWith('.ts');
    if (path === 'apps/server/test/support.ts' || data) {
      more('server', 'all');
      plan.notes.push({ text: `${path} is the server test setup or data the server tests read, so all server tests run`, steps: ['server'] });
    } else more('server', 'changed');
    // Data is read by path, which no import shows: the e2e server may read it too (when unsure, run more).
    if (data || !loads || loads.has(path)) {
      plan.e2e = 'all';
      plan.notes.push({ text: `${path} is loaded by the browser tests' server, so all browser tests run`, steps: ['e2e'] });
    }
    return true;
  }
  if (path.startsWith('apps/web/e2e/')) {
    if (!path.endsWith('.capture.ts')) {
      plan.e2e = 'all';
      plan.notes.push({ text: `${path} is browser test setup or data, so all browser tests run`, steps: ['e2e'] });
    }
    return true;
  }
  return false;
}

/**
 * What a set of changed files asks for. Unknown paths count as "everything": when in doubt, run more.
 * `notes` say why more than the changed area runs: `{ text, steps }`, with the steps the note widened.
 * `e2eServerLoads`: the files under apps/server/test the browser tests' server loads (see `e2eServerLoads()`);
 * without it, every server test helper counts as loaded.
 */
export function planFor(changed, { e2eServerLoads: loads } = {}) {
  const plan = { typecheck: false, lint: 'none', scripts: false, server: 'none', web: 'none', e2e: 'none', areas: new Set(), specs: new Set(), notes: [] };
  const more = (key, level) => { if (plan[key] !== 'all') plan[key] = level; };

  for (const path of changed) {
    // The edit hook runs the lint of the check script: its tests and a lint of everything.
    if (path === '.claude/hooks/lint-file.mjs') {
      plan.scripts = true;
      plan.lint = 'all';
      continue;
    }
    // The scripts of unattended implementation have tests of their own, and nothing else reads them.
    // So have the protected-path hooks (agent-lib.test.mjs runs them).
    if (/^scripts\/(agent|drift)/.test(path) || /^\.claude\/hooks\/(ask|guard)-protected\.mjs$/.test(path)) { plan.scripts = true; continue; }
    // So has the check script (amendment of 2026-10-24); its lint part also lints everything.
    if (/^scripts\/check/.test(path)) {
      plan.scripts = true;
      if (path === 'scripts/check-lint.mjs') plan.lint = 'all';
      continue;
    }
    if (QUIET.test(path)) continue;
    // The lint rules and their baselines change what every file is checked against, and nothing else.
    if (LINT_CONFIG.test(path)) {
      plan.lint = 'all';
      plan.notes.push({ text: `${path} is lint configuration, so every file is linted`, steps: ['lint'] });
      continue;
    }
    plan.typecheck = true;
    more('lint', 'changed');
    const spec = /^apps\/web\/e2e\/([\w-]+\.spec\.ts)$/.exec(path);
    if (spec) { more('e2e', 'some'); plan.specs.add(spec[1]); continue; }
    if (/^apps\/web\/test\//.test(path)) { more('web', 'changed'); continue; }
    if (/^apps\/server\/test\/[\w-]+\.test\.ts$/.test(path)) { more('server', 'changed'); continue; }
    const area = AREAS.find(([re]) => re.test(path));
    if (area) {
      more(path.startsWith('apps/server/') ? 'server' : 'web', 'changed');
      more('e2e', 'some');
      for (const tag of area[1]) plan.areas.add(tag);
      // Any page change can break the layout checks that span pages.
      if (path.startsWith('apps/web/')) plan.areas.add('@layout');
      continue;
    }
    // The pages' shared styles can break how any page looks, which ui-quality checks on every page; a style that
    // breaks what another browser test does is found by the full check.
    if (path === 'apps/web/src/pages.css') {
      more('web', 'all');
      more('e2e', 'some');
      plan.specs.add('ui-quality.spec.ts');
      plan.notes.push({ text: `${path} is shared by all pages, so the page checks of every page run (ui-quality.spec.ts)`, steps: ['e2e'] });
      continue;
    }
    if (planTestSupport(path, plan, more, loads)) continue;
    // Shared code of one app (web: ui/, design/, i18n/, App, api; server: app, schema, migrations): that app's
    // tests and every browser test. The test setup, packages, configuration and anything else: everything.
    const app = /^apps\/(web|server)\/(src|drizzle)\//.exec(path)?.[1];
    if (app) {
      more(app, 'all');
      plan.e2e = 'all';
      plan.notes.push({ text: `${path} is shared ${app} code, so all ${app} tests and all browser tests run`, steps: [app, 'e2e'] });
      continue;
    }
    Object.assign(plan, { lint: 'all', server: 'all', web: 'all', e2e: 'all' });
    plan.notes.push({ text: `${path} is shared or unknown, so everything runs`, steps: ['lint', 'server', 'web', 'e2e'] });
  }
  return plan;
}

/**
 * The plan when each step has its own changed files (those since that step's last green run): a step that
 * passed on a later state than another repeats less. `changedByStep` has a list of paths per step in STEPS.
 */
export function planSteps(changedByStep, context = {}) {
  const plans = Object.fromEntries(STEPS.map((step) => [step, planFor(changedByStep[step], context)]));
  const notes = STEPS.flatMap((step) => plans[step].notes.filter((note) => note.steps.includes(step)).map((note) => note.text));
  return {
    typecheck: plans.typecheck.typecheck,
    lint: plans.lint.lint,
    scripts: plans.scripts.scripts,
    server: plans.server.server,
    web: plans.web.web,
    e2e: plans.e2e.e2e,
    areas: plans.e2e.areas,
    specs: plans.e2e.specs,
    notes: [...new Set(notes)],
  };
}

/** The lint configuration and the baselines of what it found before (research note 2026-10-22-agent-guardrails). */
export const LINT_CONFIG = /^(eslint\.config\.mjs|eslint-suppressions\.json|\.dependency-cruiser\.cjs|\.dependency-cruiser-known-violations\.json)$/;
/** The baselines: problems that existed when the rules came, which may only shrink. */
export const BASELINES = ['eslint-suppressions.json', '.dependency-cruiser-known-violations.json'];
const ESLINT_FILES = /^(apps\/[\w-]+\/(src|test)\/|apps\/web\/e2e\/|packages\/[\w-]+\/src\/).*\.tsx?$/;
const DEPS_FILES = /^apps\/(server|web)\/src\/.*\.tsx?$/;

/** Of the changed files, those ESLint checks and those dependency-cruiser starts from (tests aside). */
export function lintTargets(changed) {
  return {
    eslint: changed.filter((path) => ESLINT_FILES.test(path)),
    deps: changed.filter((path) => DEPS_FILES.test(path) && !/\.(test|spec)\.tsx?$/.test(path)),
  };
}

/** Entries in a baseline (ESLint's suppressions: the counts; dependency-cruiser's known violations: the list). */
export function baselineSize(text) {
  if (!text) return 0;
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data.length;
  return Object.values(data).flatMap((rules) => Object.values(rules)).reduce((sum, rule) => sum + rule.count, 0);
}

/** A baseline's entries by key with their counts: ESLint's file and rule, dependency-cruiser's rule, from and to. */
function baselineEntries(text) {
  const entries = new Map();
  if (!text) return entries;
  const data = JSON.parse(text);
  if (Array.isArray(data)) {
    for (const v of data) {
      const key = `${v.rule.name}: ${v.from} → ${v.to}`;
      entries.set(key, (entries.get(key) ?? 0) + 1);
    }
  } else {
    for (const [file, rules] of Object.entries(data)) for (const [rule, { count }] of Object.entries(rules)) entries.set(`${file} (${rule})`, count);
  }
  return entries;
}

/**
 * `[path, before, now]` per baseline (texts, null when absent) → a message for each one with an entry that is new
 * or counts more than before. Comparing sizes alone would let a fixed problem be swapped for a new one.
 */
export function baselineGrowth(baselines) {
  return baselines.flatMap(([path, before, now]) => {
    if (before === null) return [];
    const was = baselineEntries(before);
    const grown = [...baselineEntries(now)].filter(([key, count]) => count > (was.get(key) ?? 0)).map(([key]) => key);
    return grown.length > 0 ? [`${path} has new entries: ${grown.join(', ')}: fix the new problems instead of adding them to the baseline`] : [];
  });
}

const git = (args, cwd, env) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean);

/**
 * The working tree as it is now, as a git tree: tracked files with their edits, and new files that aren't
 * ignored. Built in a copy of the index, so the index and the working tree stay untouched.
 */
export function snapshot(cwd = process.cwd()) {
  const dir = mkdtempSync(join(tmpdir(), 'check-index-'));
  try {
    // The copy keeps git's record of unchanged files, so only edited files are read again.
    const index = resolve(cwd, git(['rev-parse', '--git-path', 'index'], cwd));
    const copy = join(dir, 'index');
    if (existsSync(index)) copyFileSync(index, copy);
    git(['add', '-A'], cwd, { GIT_INDEX_FILE: copy });
    return git(['write-tree'], cwd, { GIT_INDEX_FILE: copy });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The paths that differ between a base (a commit, a branch or a recorded green run) and a snapshot. */
export function changedSince(base, tree, cwd = process.cwd()) {
  // Without rename detection a moved file counts under both paths.
  return lines(git(['diff', '--name-only', '--no-renames', base, tree], cwd));
}

// A green run is a commit of the snapshot it passed on, held by a local ref: git keeps the snapshot as long as
// the ref exists, and refs outside refs/heads and refs/tags are neither pushed nor fetched.
const ref = (step) => `refs/check/green-${step}`;

/** Records that `step` passed on the snapshot `tree`. */
export function recordGreen(step, tree, cwd = process.cwd()) {
  const commit = git(['-c', 'user.name=pnpm check', '-c', 'user.email=check@localhost', 'commit-tree', tree, '-m', `${step}: green`], cwd);
  git(['update-ref', ref(step), commit], cwd);
}

/** The last green run of `step`: `{ base, at }` (what to diff against, and when it passed), or null. */
export function greenRun(step, cwd = process.cwd()) {
  try {
    const at = git(['log', '-1', '--format=%cd', '--date=format:%Y-%m-%d %H:%M', ref(step), '--'], cwd);
    return { base: ref(step), at };
  } catch {
    return null;
  }
}

/** Of the candidates `{ from, base, changed }` (in order of preference), the one with the fewest changed files; null when none. */
export function chooseBase(candidates) {
  return candidates.reduce((best, next) => (best && best.changed.length <= next.changed.length ? best : next), null);
}

/** Whether a ref names a commit here. */
function exists(name, cwd) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${name}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

/** The checked-out branch's name; null when HEAD is detached. */
function currentBranch(cwd) {
  try {
    return git(['symbolic-ref', '--short', '-q', 'HEAD'], cwd);
  } catch {
    return null;
  }
}

/**
 * The bases `step` may count from, in order of preference: its green run, and where this branch left main and
 * origin/main (CI checks those). The same merge base is taken once; a main without common history is skipped.
 * Returns `[{ from, base }]`.
 */
export function baseCandidates(step, cwd = process.cwd()) {
  const candidates = [];
  const green = greenRun(step, cwd);
  if (green) candidates.push({ from: `its green run of ${green.at}`, base: green.base });
  let onMain = null;
  for (const name of ['main', 'origin/main']) {
    if (!exists(name, cwd)) continue;
    try {
      const base = git(['merge-base', 'HEAD', name], cwd);
      if (candidates.some((candidate) => candidate.base === base)) continue;
      onMain ??= currentBranch(cwd) === 'main';
      candidates.push({ from: onMain ? `main (${base.slice(0, 7)})` : `main (where this branch left it, ${base.slice(0, 7)})`, base });
    } catch { /* no common history */ }
  }
  return candidates;
}

/**
 * Where `step` counts its changed files from (ADR 0023, amendment of 2026-10-24): of `baseCandidates`, the one that
 * leaves the fewest files; a tie prefers the green run. Without any, the last commit. Returns `{ from, base, changed }`.
 */
export function countingBase(step, tree, cwd = process.cwd()) {
  const counted = baseCandidates(step, cwd).map((candidate) => ({ ...candidate, changed: changedSince(candidate.base, tree, cwd) }));
  return chooseBase(counted) ?? { from: 'the last commit (no green run recorded)', base: 'HEAD', changed: changedSince('HEAD', tree, cwd) };
}

// A failed run of a step (amendment of 2026-10-24: a passing --failed renews the browser record): the snapshot it
// failed on and the tests that failed, as a commit held by a local ref like the green runs.
const failedRef = (step) => `refs/check/failed-${step}`;

/** Records that `step` failed on the snapshot `tree`, with the ids of the tests that failed. */
export function recordFailed(step, tree, failedTests, cwd = process.cwd()) {
  const message = `${step}: failed\n\n${JSON.stringify([...failedTests].sort())}`;
  const commit = git(['-c', 'user.name=pnpm check', '-c', 'user.email=check@localhost', 'commit-tree', tree, '-m', message], cwd);
  git(['update-ref', failedRef(step), commit], cwd);
}

/** The last failed run of `step` that was kept: `{ tree, failedTests }`, or null. */
export function failedRun(step, cwd = process.cwd()) {
  try {
    const tree = git(['rev-parse', `${failedRef(step)}^{tree}`], cwd);
    const body = git(['log', '-1', '--format=%b', failedRef(step), '--'], cwd);
    return { tree, failedTests: JSON.parse(body || '[]') };
  } catch {
    return null;
  }
}

/** Forgets the failed run of `step`. */
export function clearFailed(step, cwd = process.cwd()) {
  try {
    git(['update-ref', '-d', failedRef(step)], cwd);
  } catch { /* none kept */ }
}

/**
 * The failed tests a failed browser step may keep for `--failed` (Playwright's last run, `.last-run.json`), or none:
 * only a report Playwright wrote during the step (`writtenAt` after `startedAt`; a server that didn't start, a setup
 * that crashed or Ctrl-C leave an older file), of a run that ended as failed with a list, and only when Playwright
 * can't have stopped early (`stopsEarly`: maxFailures set), which would leave unrun tests out of every list.
 * Returns `{ failedTests, why }`: the list, or null and why not.
 */
export function keptFailures({ lastRun, writtenAt, startedAt, stopsEarly }) {
  if (!lastRun || writtenAt === null || writtenAt < startedAt) return { failedTests: null, why: "Playwright's last report is from an earlier run" };
  if (lastRun.status !== 'failed' || !(lastRun.failedTests?.length > 0)) return { failedTests: null, why: `Playwright's run ended as ${lastRun.status} without a list of failed tests` };
  if (stopsEarly) return { failedTests: null, why: 'Playwright may have stopped early (maxFailures), so some tests never ran' };
  return { failedTests: lastRun.failedTests, why: null };
}

/**
 * Whether a passing rerun of the failed browser tests makes the browser step green: only on the snapshot the
 * kept failed run ran on, and only when Playwright's last run is that run (the same failed tests). `{ renews, why }`.
 */
export function failedRerunRenews(kept, tree, failedTests) {
  if (!kept) return { renews: false, why: 'no failed run of pnpm check is kept' };
  if (kept.tree !== tree) return { renews: false, why: 'the files changed since the failed run' };
  if (JSON.stringify([...failedTests].sort()) !== JSON.stringify(kept.failedTests)) return { renews: false, why: "Playwright's last run is not the failed run of pnpm check" };
  return { renews: true, why: 'the same files as the failed run' };
}

const E2E_SERVER = 'apps/server/test/e2e-server.ts';

/**
 * The files under apps/server/test that the browser tests' server loads: e2e-server.ts and the test files it
 * imports, followed through their imports (amendment of 2026-10-24). Imports of src/ and packages are not followed.
 */
export function e2eServerLoads(cwd = process.cwd()) {
  const loads = new Set();
  const visit = (path) => {
    if (loads.has(path) || !existsSync(join(cwd, path))) return;
    loads.add(path);
    const dir = path.slice(0, path.lastIndexOf('/'));
    for (const [, spec] of readFileSync(join(cwd, path), 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = posix.normalize(`${dir}/${spec}`);
      if (!target.startsWith('apps/server/test/')) continue;
      // './x.js' is x.ts; './x' is x.ts or x/index.ts; anything else (a .json) as it is.
      if (target.endsWith('.js')) visit(target.replace(/\.js$/, '.ts'));
      else if (/\.\w+$/.test(target)) visit(target);
      else for (const candidate of [`${target}.ts`, `${target}/index.ts`]) visit(candidate);
    }
  };
  visit(E2E_SERVER);
  return loads;
}

const TEXTS = /^apps\/web\/src\/i18n\/locales\/[\w-]+\.json$/;
const WEB_SOURCES = 'apps/web/src';

/** The top-level groups of a texts file as it is in a commit or tree; none when the file isn't there. */
function textGroups(at, path, cwd) {
  try {
    return JSON.parse(git(['show', `${at}:${path}`], cwd));
  } catch {
    return {};
  }
}

/** The web client's source files, without the texts themselves. */
function webSources(cwd, dir = WEB_SOURCES) {
  return readdirSync(join(cwd, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return webSources(cwd, path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * The changed files as the browser tests should see them: a changed texts file (i18n/locales) alone would run
 * every browser test, so it is replaced by the source files that name a key of the groups whose texts changed
 * ('sites.title', `import.status.${…}`). They then count like any changed file: a page runs its areas, shared
 * code runs everything. When a changed group is named by no file, the texts file stays and everything runs.
 * Returns `{ changed, note }`.
 */
export function forBrowserTests(changed, base, tree, cwd = process.cwd()) {
  const texts = changed.filter((path) => TEXTS.test(path));
  if (texts.length === 0 || !base || !tree) return { changed, note: null };

  const groups = new Set();
  for (const path of texts) {
    const [before, after] = [textGroups(base, path, cwd), textGroups(tree, path, cwd)];
    for (const group of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[group]) !== JSON.stringify(after[group])) groups.add(group);
    }
  }
  const sources = webSources(cwd).map((path) => [path, readFileSync(join(cwd, path), 'utf8')]);
  const users = new Set();
  for (const group of groups) {
    const named = new RegExp(`['"\`]${group}\\.`);
    const using = sources.filter(([, text]) => named.test(text)).map(([path]) => path);
    if (using.length === 0) return { changed, note: null };
    for (const path of using) users.add(path);
  }
  return {
    changed: [...new Set([...changed.filter((path) => !TEXTS.test(path)), ...users])],
    note: `texts changed in ${[...groups].sort().join(', ') || 'no group'}: the browser tests count the ${users.size} source file(s) that use them as changed`,
  };
}
