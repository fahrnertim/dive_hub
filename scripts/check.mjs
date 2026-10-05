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
  [/^apps\/web\/src\/(DiveDetail|DiveEditForm|DiveHistory|DiveList|DepthProfile|Decisions|ImportPanel)\.tsx$|^apps\/web\/src\/lib\/(dive-values|history|profile|logbook|devices|importable)\.ts$/, ['@dives']],
  [/^apps\/web\/src\/DiversPage\.tsx$/, ['@divers']],
  [/^apps\/web\/src\/(Account|AccountPage|SsiConnections)\.tsx$/, ['@account']],
  [/^apps\/web\/src\/SsiPanel\.tsx$/, ['@dives']],
  [/^apps\/web\/src\/Admin\.tsx$/, ['@admin']],
  [/^apps\/server\/src\/sites\/import\//, ['@admin', '@sites']],
  [/^apps\/server\/src\/sites\//, ['@sites', '@dives']],
  [/^apps\/server\/src\/(dives|imports|fit)\/|^apps\/server\/src\/(routes|vocabulary)\.ts$/, ['@dives']],
  [/^apps\/server\/src\/divers\//, ['@divers']],
  [/^apps\/server\/src\/(users|auth)\//, ['@account', '@admin']],
  [/^apps\/server\/src\/(ssi|secrets)\//, ['@dives', '@account']],
  [/^apps\/server\/test\/fixtures\/site-sources\//, ['@admin', '@sites']],
  // Zips SSI's site list for the tests and the browser tests' server (ADR 0025).
  [/^apps\/server\/test\/zip\.ts$/, ['@admin', '@sites']],
];
/** Paths that change no behaviour: no tests. */
const QUIET = /^(docs\/|samples\/|\.claude\/|AGENTS\.md$|CLAUDE\.md$|README\.md$|skills-lock\.json$|\.gitignore$|\.dockerignore$|\.env\.example$|compose(\.dev)?\.yaml$|Dockerfile$|apps\/server\/test\/fixtures\/site-sources\/record\.ts$|apps\/server\/test\/fixtures\/ssi\/round-trip\.ts$)/;

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
