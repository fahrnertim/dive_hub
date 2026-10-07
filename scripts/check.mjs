#!/usr/bin/env node
// The checks for what changed (ADR 0023): typecheck, the unit tests whose imports changed, and the
// browser tests of the areas touched. `pnpm check` while working; `pnpm check:full` before a commit.
//   pnpm check                 changes since the last commit (staged, unstaged and new files)
//   pnpm check --base main     changes since another commit or branch
//   pnpm check:full            everything
//   pnpm check --dry           only say what would run (with --files a,b: for these paths)
// Unknown paths count as "everything": when in doubt, run more.
import { execSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const full = args.includes('--full');
const dry = args.includes('--dry');
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'HEAD';

const git = (cmd) => execSync(`git ${cmd}`, { encoding: 'utf8' }).split('\n').map((l) => l.trim()).filter(Boolean);
// --files a,b: pretend these changed (to see what a change would run, with --dry).
const given = args.includes('--files') ? args[args.indexOf('--files') + 1].split(',') : null;
const changed = full ? [] : given ?? [...new Set([...git(`diff --name-only ${base}`), ...git('ls-files --others --exclude-standard')])];

/** Browser test areas (tags in apps/web/e2e) by source path; first match wins. */
const AREAS = [
  [/^apps\/web\/src\/SiteImportPage\.tsx$/, ['@admin', '@sites']],
  [/^apps\/web\/src\/(SitesPage|SiteForm|SiteHistory)\.tsx$|^apps\/web\/src\/lib\/(site-origin|sites-list|geo)\.ts$/, ['@sites']],
  [/^apps\/web\/src\/SitePicker\.tsx$/, ['@sites', '@dives']],
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
  [/^apps\/server\/src\/(dives|imports|fit|suunto|assessment)\/|^apps\/server\/src\/(routes|vocabulary)\.ts$/, ['@dives']],
  [/^apps\/server\/src\/divers\//, ['@divers']],
  [/^apps\/server\/src\/(users|auth)\//, ['@account', '@admin']],
  [/^apps\/server\/src\/(providers|secrets)\//, ['@dives', '@account']],
  [/^apps\/server\/test\/fixtures\/site-sources\//, ['@admin', '@sites']],
  // Zips SSI's site list for the tests and the browser tests' server (ADR 0025).
  [/^apps\/server\/test\/zip\.ts$/, ['@admin', '@sites']],
];
/** Paths that change no behaviour: no tests. */
const QUIET = /^(docs\/|samples\/|\.claude\/|AGENTS\.md$|CLAUDE\.md$|README\.md$|skills-lock\.json$|\.gitignore$|\.dockerignore$|\.env\.example$|compose(\.dev)?\.yaml$|Dockerfile$|apps\/server\/test\/fixtures\/site-sources\/record\.ts$|apps\/server\/test\/fixtures\/ssi\/round-trip\.ts$|apps\/server\/test\/fixtures\/write-assessment-fixture\.ts$|apps\/server\/test\/fixtures\/write-suunto-fixture\.ts$|apps\/server\/test\/fixtures\/write-merge-fixture\.ts$|scripts\/token-report\.mjs$)/;

const plan = { typecheck: full, server: full ? 'all' : 'none', web: full ? 'all' : 'none', e2e: full ? 'all' : 'none', areas: new Set(), specs: new Set() };
const everything = () => Object.assign(plan, { typecheck: true, server: 'all', web: 'all', e2e: 'all' });
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
  // Shared code of one app (web: ui/, design/, i18n/, App, api; server: app, schema, migrations): that app's
  // tests and every browser test. The test setup, packages, configuration and anything else: everything.
  const app = /^apps\/(web|server)\/(src|drizzle)\//.exec(path)?.[1];
  if (app) {
    more(app, 'all');
    plan.e2e = 'all';
    console.log(`check: ${path} is shared ${app} code, so all ${app} tests and all browser tests run`);
    continue;
  }
  everything();
  console.log(`check: ${path} is shared or unknown, so everything runs`);
}

const steps = [];
const pnpm = (cmd) => `pnpm ${cmd}`;
if (plan.typecheck) steps.push(['typecheck', pnpm('typecheck')]);
if (plan.server !== 'none') steps.push([`server tests (${plan.server})`, pnpm(`--filter @dive-hub/server exec vitest run --passWithNoTests${plan.server === 'changed' ? ` --changed ${base}` : ''}`)]);
if (plan.web !== 'none') steps.push([`web unit tests (${plan.web})`, pnpm(`--filter @dive-hub/web exec vitest run --passWithNoTests${plan.web === 'changed' ? ` --changed ${base}` : ''}`)]);
if (plan.e2e !== 'none') {
  const grep = [...plan.areas, ...[...plan.specs].map((s) => s.replace(/\./g, '\\.'))].join('|');
  const which = plan.e2e === 'all' ? 'all' : grep;
  steps.push([`browser tests (${which})`, pnpm(`--filter @dive-hub/web test:e2e${plan.e2e === 'all' ? '' : ` --grep "${grep}"`}`)]);
}

if (steps.length === 0) {
  console.log(changed.length === 0 ? `check: nothing changed since ${base}` : 'check: only documentation and other quiet files changed; nothing to run');
  process.exit(0);
}
console.log(`check: ${full ? 'everything' : `${changed.length} changed file(s) since ${base}`}\n${steps.map(([name]) => `  - ${name}`).join('\n')}`);

if (dry) process.exit(0);
const times = [];
for (const [name, cmd] of steps) {
  console.log(`\n▶ ${name}: ${cmd}`);
  const started = Date.now();
  const { status } = spawnSync(cmd, { stdio: 'inherit', shell: true });
  times.push(`${name}: ${Math.round((Date.now() - started) / 1000)} s`);
  if (status !== 0) {
    console.log(`\n✗ ${name} failed\n${times.join('\n')}`);
    process.exit(status ?? 1);
  }
}
console.log(`\n✓ all checks passed\n${times.join('\n')}`);
