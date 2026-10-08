// What the check script plans and what it remembers (ADR 0023): the plan from the changed files, and the record
// of each step's last green run, from which the next run takes its changed files.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** The steps that each remember their own green run, in the order they run. */
export const STEPS = ['typecheck', 'scripts', 'server', 'web', 'e2e'];

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
  [/^apps\/web\/src\/(DiveDetail|DiveEditForm|DiveHistory|DiveList|ProfileSketch|DepthProfile|Decisions|ReviewPage|ReviewStrip|ReviewRows|ImportPanel|DeleteDive|DeletedDives|MergeDive|LogbookChecks|Participants|Assessment)\.tsx$|^apps\/web\/src\/lib\/(dive-values|history|profile|sketch|logbook|review|devices|importable|deletion|assessment)\.ts$/, ['@dives']],
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
  [/^apps\/web\/src\/(Account|AccountPage|Connections|ProviderBuddies)\.tsx$/, ['@account']],
  // Importing a Provider's dives (ADR 0030): on the Connection, and the dives it makes.
  [/^apps\/web\/src\/ProviderDiveImport\.tsx$/, ['@account', '@dives']],
  [/^apps\/web\/src\/ProviderPanel\.tsx$/, ['@dives']],
  // Providers in the web client (ADR 0027): the account's Connections and each Dive's panels read them.
  [/^apps\/web\/src\/lib\/providers\.ts$/, ['@dives', '@account']],
  [/^apps\/web\/src\/Admin\.tsx$/, ['@admin']],
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
export const QUIET = /^(docs\/|samples\/|\.claude\/|AGENTS\.md$|CLAUDE\.md$|README\.md$|skills-lock\.json$|\.gitignore$|\.dockerignore$|\.env\.example$|compose(\.dev)?\.yaml$|Dockerfile$|apps\/server\/test\/fixtures\/site-sources\/record\.ts$|apps\/server\/test\/fixtures\/ssi\/round-trip\.ts$|apps\/server\/test\/fixtures\/write-assessment-fixture\.ts$|apps\/server\/test\/fixtures\/write-suunto-fixture\.ts$|apps\/server\/test\/fixtures\/write-merge-fixture\.ts$|apps\/server\/test\/fixtures\/write-account-export-fixture\.ts$|scripts\/token-report\.mjs$)/;

/** The area tags a browser test can have; a test with none of them would run only in the full check. */
export const TAGS = ['@dives', '@divers', '@sites', '@account', '@admin', '@layout'];

/** The tag of browser tests that only the full check runs: ui-quality's two variants without axe (small phone, tablet). */
export const FULL_ONLY = '@full';

/** The plan that runs everything (`pnpm check:full`). */
export const fullPlan = () => ({ typecheck: true, scripts: true, server: 'all', web: 'all', e2e: 'all', areas: new Set(), specs: new Set(), notes: [] });

/**
 * What a set of changed files asks for. Unknown paths count as "everything": when in doubt, run more.
 * `notes` say why more than the changed area runs: `{ text, steps }`, with the steps the note widened.
 */
export function planFor(changed) {
  const plan = { typecheck: false, scripts: false, server: 'none', web: 'none', e2e: 'none', areas: new Set(), specs: new Set(), notes: [] };
  const more = (key, level) => { if (plan[key] !== 'all') plan[key] = level; };

  for (const path of changed) {
    if (QUIET.test(path)) continue;
    plan.typecheck = true;
    const spec = /^apps\/web\/e2e\/([\w-]+\.spec\.ts)$/.exec(path);
    if (spec) { more('e2e', 'some'); plan.specs.add(spec[1]); continue; }
    if (/^apps\/web\/test\//.test(path)) { more('web', 'changed'); continue; }
    if (/^apps\/server\/test\/[\w-]+\.test\.ts$/.test(path)) { more('server', 'changed'); continue; }
    if (/^apps\/server\/test\/fixtures\//.test(path)) more('server', 'changed');
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
    // Shared code of one app (web: ui/, design/, i18n/, App, api; server: app, schema, migrations): that app's
    // tests and every browser test. The test setup, packages, configuration and anything else: everything.
    const app = /^apps\/(web|server)\/(src|drizzle)\//.exec(path)?.[1];
    if (app) {
      more(app, 'all');
      plan.e2e = 'all';
      plan.notes.push({ text: `${path} is shared ${app} code, so all ${app} tests and all browser tests run`, steps: [app, 'e2e'] });
      continue;
    }
    // The check script has tests of its own.
    if (/^scripts\/check/.test(path)) plan.scripts = true;
    Object.assign(plan, { server: 'all', web: 'all', e2e: 'all' });
    plan.notes.push({ text: `${path} is shared or unknown, so everything runs`, steps: ['server', 'web', 'e2e'] });
  }
  return plan;
}

/**
 * The plan when each step has its own changed files (those since that step's last green run): a step that
 * passed on a later state than another repeats less. `changedByStep` has a list of paths per step in STEPS.
 */
export function planSteps(changedByStep) {
  const plans = Object.fromEntries(STEPS.map((step) => [step, planFor(changedByStep[step])]));
  const notes = STEPS.flatMap((step) => plans[step].notes.filter((note) => note.steps.includes(step)).map((note) => note.text));
  return {
    typecheck: plans.typecheck.typecheck,
    scripts: plans.scripts.scripts,
    server: plans.server.server,
    web: plans.web.web,
    e2e: plans.e2e.e2e,
    areas: plans.e2e.areas,
    specs: plans.e2e.specs,
    notes: [...new Set(notes)],
  };
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
