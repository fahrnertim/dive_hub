// Tests of the check script's planning and of its record of green runs (ADR 0023, amendment of 2026-10-08).
// Run with: node --test scripts/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { baselineGrowth, baselineSize, changedSince, chooseBase, countingBase, forBrowserTests, greenRun, lintTargets, planFor, planSteps, recordGreen, snapshot } from './check-lib.mjs';

/** A git repository with one commit holding `files`. */
function repository(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'check-test-'));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git('init', '--quiet');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'core.autocrlf', 'false');
  const write = (path, text) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  git('add', '-A');
  git('commit', '--quiet', '-m', 'first');
  return { cwd, git, write, remove: (path) => rmSync(join(cwd, path)), drop: () => rmSync(cwd, { recursive: true, force: true }) };
}

test('without a green run, the changes are those since the last commit: edited, new and deleted files', (t) => {
  const repo = repository({ 'a.ts': 'a', 'b.ts': 'b', 'c.ts': 'c', '.gitignore': 'ignored/\n' });
  t.after(repo.drop);
  repo.write('a.ts', 'a2');
  repo.write('new/d.ts', 'd');
  repo.write('ignored/e.ts', 'e');
  repo.remove('c.ts');

  assert.equal(greenRun('server', repo.cwd), null);
  assert.deepEqual(changedSince('HEAD', snapshot(repo.cwd), repo.cwd).sort(), ['a.ts', 'c.ts', 'new/d.ts']);
});

test('after a green run, only the files changed since then count, committed or not', (t) => {
  const repo = repository({ 'a.ts': 'a', 'b.ts': 'b' });
  t.after(repo.drop);
  repo.write('a.ts', 'a2');
  repo.write('new.ts', 'n');
  recordGreen('server', snapshot(repo.cwd), repo.cwd);

  const green = greenRun('server', repo.cwd);
  assert.match(green.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.deepEqual(changedSince(green.base, snapshot(repo.cwd), repo.cwd), []);

  // The commit of the state that passed changes nothing; a later edit does.
  repo.git('add', '-A');
  repo.git('commit', '--quiet', '-m', 'second');
  assert.deepEqual(changedSince(green.base, snapshot(repo.cwd), repo.cwd), []);
  repo.write('b.ts', 'b2');
  assert.deepEqual(changedSince(green.base, snapshot(repo.cwd), repo.cwd), ['b.ts']);
});

test('a file changed back to what passed no longer counts', (t) => {
  const repo = repository({ 'a.ts': 'a' });
  t.after(repo.drop);
  recordGreen('web', snapshot(repo.cwd), repo.cwd);
  repo.write('a.ts', 'a2');
  repo.write('a.ts', 'a');
  assert.deepEqual(changedSince(greenRun('web', repo.cwd).base, snapshot(repo.cwd), repo.cwd), []);
});

test('each step has its own green run, and taking a snapshot leaves the index alone', (t) => {
  const repo = repository({ 'a.ts': 'a' });
  t.after(repo.drop);
  repo.write('staged.ts', 's');
  repo.git('add', 'staged.ts');
  repo.write('untracked.ts', 'u');
  recordGreen('server', snapshot(repo.cwd), repo.cwd);

  assert.equal(greenRun('e2e', repo.cwd), null);
  assert.notEqual(greenRun('server', repo.cwd), null);
  assert.equal(repo.git('status', '--short').toString(), 'A  staged.ts\n?? untracked.ts\n');
});

test('a page runs the typecheck, the web tests related to it and its areas with the layout checks', () => {
  const plan = planFor(['apps/web/src/SitesPage.tsx', 'docs/index.md']);
  assert.equal(plan.typecheck, true);
  assert.equal(plan.server, 'none');
  assert.equal(plan.web, 'changed');
  assert.equal(plan.e2e, 'some');
  assert.deepEqual([...plan.areas].sort(), ['@layout', '@sites']);
});

test('documentation runs nothing; shared code of an app runs its tests and every browser test; an unknown path everything', () => {
  assert.deepEqual(planFor(['docs/index.md', 'README.md']), { typecheck: false, lint: 'none', scripts: false, server: 'none', web: 'none', e2e: 'none', areas: new Set(), specs: new Set(), notes: [] });

  const shared = planFor(['apps/web/src/api.ts']);
  assert.deepEqual([shared.server, shared.web, shared.e2e], ['none', 'all', 'all']);

  const unknown = planFor(['pnpm-lock.yaml']);
  assert.deepEqual([unknown.typecheck, unknown.lint, unknown.server, unknown.web, unknown.e2e], [true, 'all', 'all', 'all', 'all']);
});

test('a changed source file is linted itself; the CI workflow and the git hooks run nothing', () => {
  assert.equal(planFor(['apps/web/src/SitesPage.tsx']).lint, 'changed');
  assert.equal(planFor(['apps/server/test/dive-list.test.ts']).lint, 'changed');
  assert.deepEqual(planFor(['.github/workflows/check.yml', '.githooks/pre-commit']), planFor([]));
});

test('the lint configuration and its baselines lint everything and run no tests', () => {
  for (const path of ['eslint.config.mjs', 'eslint-suppressions.json', '.dependency-cruiser.cjs', '.dependency-cruiser-known-violations.json']) {
    const plan = planFor([path]);
    assert.deepEqual([plan.lint, plan.typecheck, plan.server, plan.web, plan.e2e], ['all', false, 'none', 'none', 'none'], path);
  }
});

test('ESLint gets the TypeScript files it covers; dependency-cruiser the sources of both apps', () => {
  const targets = lintTargets(['apps/web/src/SitesPage.tsx', 'apps/server/src/routes.ts', 'apps/server/test/dive-list.test.ts',
    'apps/web/e2e/sites.spec.ts', 'apps/web/src/pages.css', 'apps/web/src/i18n/locales/en.json', 'scripts/check.mjs', 'docs/index.md', 'packages/api-client/src/index.ts']);
  assert.deepEqual(targets.eslint, ['apps/web/src/SitesPage.tsx', 'apps/server/src/routes.ts', 'apps/server/test/dive-list.test.ts', 'apps/web/e2e/sites.spec.ts', 'packages/api-client/src/index.ts']);
  assert.deepEqual(targets.deps, ['apps/web/src/SitesPage.tsx', 'apps/server/src/routes.ts']);
});

test('a baseline may only shrink: more suppressions or known violations than before fail', () => {
  const suppressions = (count) => JSON.stringify({ 'apps/a.ts': { 'sonarjs/cognitive-complexity': { count } } });
  const known = (n) => JSON.stringify(Array.from({ length: n }, () => ({ type: 'module', from: 'a', to: 'b', rule: { name: 'no-cycles' } })));
  assert.equal(baselineSize(suppressions(3)), 3);
  assert.equal(baselineSize(known(2)), 2);
  assert.equal(baselineSize(null), 0);

  assert.deepEqual(baselineGrowth([['eslint-suppressions.json', suppressions(3), suppressions(2)]]), []);
  assert.deepEqual(baselineGrowth([['eslint-suppressions.json', suppressions(3), suppressions(4)], ['known.json', known(2), known(2)]]),
    ['eslint-suppressions.json has new entries: apps/a.ts (sonarjs/cognitive-complexity): fix the new problems instead of adding them to the baseline']);
  // A baseline that didn't exist before has nothing to grow from.
  assert.deepEqual(baselineGrowth([['known.json', null, known(5)]]), []);
});

test('a baseline may not swap a fixed problem for a new one, even at the same size', () => {
  const suppressions = (entries) => JSON.stringify(Object.fromEntries(entries.map(([file, rule, count]) => [file, { [rule]: { count } }])));
  const known = (pairs) => JSON.stringify(pairs.map(([from, to]) => ({ type: 'module', from, to, rule: { severity: 'error', name: 'no-cycles' } })));

  assert.deepEqual(baselineGrowth([['eslint-suppressions.json', suppressions([['a.ts', 'r', 1]]), suppressions([['b.ts', 'r', 1]])]]),
    ['eslint-suppressions.json has new entries: b.ts (r): fix the new problems instead of adding them to the baseline']);
  assert.deepEqual(baselineGrowth([['known.json', known([['a', 'b']]), known([['c', 'd']])]]),
    ['known.json has new entries: no-cycles: c → d: fix the new problems instead of adding them to the baseline']);
  // Fewer of the same problem is a shrink.
  assert.deepEqual(baselineGrowth([['eslint-suppressions.json', suppressions([['a.ts', 'r', 3]]), suppressions([['a.ts', 'r', 2]])]]), []);
});

test('a change to the edit hook runs the check script tests and lints everything', () => {
  const plan = planFor(['.claude/hooks/lint-file.mjs']);
  assert.deepEqual([plan.scripts, plan.lint, plan.server, plan.e2e], [true, 'all', 'none', 'none']);
  assert.equal(planFor(['.claude/hooks/guard-memory.mjs']).scripts, false);
});

test('a change to a protected-path hook runs the script tests that cover it, and nothing else', () => {
  for (const hook of ['.claude/hooks/ask-protected.mjs', '.claude/hooks/guard-protected.mjs']) {
    const plan = planFor([hook]);
    assert.deepEqual([plan.scripts, plan.lint, plan.typecheck, plan.server, plan.e2e], [true, 'none', false, 'none', 'none']);
  }
});

test('a changed check script runs its own tests', () => {
  assert.equal(planFor(['scripts/check-lib.mjs']).scripts, true);
  assert.equal(planFor(['apps/web/src/SitesPage.tsx']).scripts, false);
});

test('each step is planned from the files changed since its own green run', () => {
  // The server tests passed after the server change; the browser tests have not passed since before it.
  const plan = planSteps({
    typecheck: ['apps/web/src/DiversPage.tsx'],
    lint: [],
    scripts: [],
    server: [],
    web: ['apps/web/src/DiversPage.tsx'],
    e2e: ['apps/server/src/sites/routes.ts', 'apps/web/src/DiversPage.tsx', 'apps/web/e2e/sites.spec.ts'],
  });
  assert.equal(plan.typecheck, true);
  assert.equal(plan.lint, 'none');
  assert.equal(plan.scripts, false);
  assert.equal(plan.server, 'none');
  assert.equal(plan.web, 'changed');
  assert.equal(plan.e2e, 'some');
  assert.deepEqual([...plan.areas].sort(), ['@divers', '@dives', '@layout', '@sites']);
  assert.deepEqual([...plan.specs], ['sites.spec.ts']);
});

test('a note about running more is given only for the steps it widened', () => {
  const plan = planSteps({ typecheck: [], lint: [], scripts: [], server: ['apps/web/src/api.ts'], web: [], e2e: [] });
  assert.equal(plan.e2e, 'none');
  assert.deepEqual(plan.notes, []);

  const widened = planSteps({ typecheck: [], lint: [], scripts: [], server: [], web: [], e2e: ['apps/web/src/api.ts'] });
  assert.equal(widened.e2e, 'all');
  assert.deepEqual(widened.notes, ['apps/web/src/api.ts is shared web code, so all web tests and all browser tests run']);
});

test('the shared page styles run the page checks of every page, not the other browser tests', () => {
  const plan = planFor(['apps/web/src/pages.css']);
  assert.deepEqual([plan.server, plan.web, plan.e2e], ['none', 'all', 'some']);
  assert.deepEqual([...plan.specs], ['ui-quality.spec.ts']);
});

const EN = 'apps/web/src/i18n/locales/en.json';
const DE = 'apps/web/src/i18n/locales/de.json';
const texts = (groups) => JSON.stringify(groups, null, 2);

test('changed texts count, for the browser tests, as the source files that use their groups', (t) => {
  const repo = repository({
    [EN]: texts({ sites: { title: 'Dive sites' }, divers: { title: 'Divers' }, common: { save: 'Save' } }),
    [DE]: texts({ sites: { title: 'Tauchplätze' }, divers: { title: 'Taucher' }, common: { save: 'Speichern' } }),
    'apps/web/src/SitesPage.tsx': "t('sites.title')",
    'apps/web/src/SitePicker.tsx': 't(`sites.${key}`)',
    'apps/web/src/DiversPage.tsx': "t('divers.title'); t('common.save')",
    // The group's name alone, as in a route or a query key, is not a text.
    'apps/web/src/api.ts': "['sites'] as const; '/sites/'",
  });
  t.after(repo.drop);
  repo.write(DE, texts({ sites: { title: 'Tauchgebiete' }, divers: { title: 'Taucher' }, common: { save: 'Speichern' } }));
  repo.write('apps/web/src/Admin.tsx', 'x');

  const narrowed = forBrowserTests([DE, 'apps/web/src/Admin.tsx'], 'HEAD', snapshot(repo.cwd), repo.cwd);
  assert.deepEqual(narrowed.changed.sort(), ['apps/web/src/Admin.tsx', 'apps/web/src/SitePicker.tsx', 'apps/web/src/SitesPage.tsx']);
  assert.match(narrowed.note, /sites/);
});

test('texts of a group that no source file names stay a change of the texts, which runs every browser test', (t) => {
  const repo = repository({ [EN]: texts({ errors: { gone: 'Gone' } }), 'apps/web/src/api.ts': 't(problem.key)' });
  t.after(repo.drop);
  repo.write(EN, texts({ errors: { gone: 'No longer there' } }));

  assert.deepEqual(forBrowserTests([EN], 'HEAD', snapshot(repo.cwd), repo.cwd), { changed: [EN], note: null });
  assert.equal(planFor([EN]).e2e, 'all');
});

test('without changed texts, or without a base to compare them with, the files stay as they are', (t) => {
  const repo = repository({ [EN]: texts({ sites: { title: 'Dive sites' } }), 'apps/web/src/SitesPage.tsx': "t('sites.title')" });
  t.after(repo.drop);
  assert.deepEqual(forBrowserTests(['apps/web/src/Admin.tsx'], 'HEAD', snapshot(repo.cwd), repo.cwd).changed, ['apps/web/src/Admin.tsx']);
  assert.deepEqual(forBrowserTests([EN], null, null, repo.cwd).changed, [EN]);
});

test('the counting base is the candidate with the fewest changed files; a tie prefers the first (the green run)', () => {
  const green = { from: 'its green run', base: 'g', changed: ['a', 'b'] };
  const main = { from: 'main', base: 'm', changed: ['a'] };
  assert.equal(chooseBase([green, main]), main);
  assert.equal(chooseBase([green, { ...main, changed: ['x', 'y'] }]), green);
  assert.equal(chooseBase([main]), main);
  assert.equal(chooseBase([]), null);
});

test('a branch counts from main when that leaves fewer files than a stale green run', (t) => {
  const repo = repository({ 'a.ts': 'a' });
  t.after(repo.drop);
  repo.git('branch', '-M', 'main');
  assert.match(countingBase('server', snapshot(repo.cwd), repo.cwd).from, /^main \(/, 'on main without a green run: main itself');
  recordGreen('server', snapshot(repo.cwd), repo.cwd);
  assert.match(countingBase('server', snapshot(repo.cwd), repo.cwd).from, /^its green run of /);
  // Main moves on without a green run; a branch leaves it and adds one file.
  repo.write('b.ts', 'b');
  repo.write('c.ts', 'c');
  repo.git('add', '-A');
  repo.git('commit', '--quiet', '-m', 'main moves on');
  repo.git('checkout', '--quiet', '-b', 'topic');
  repo.write('d.ts', 'd');
  const chosen = countingBase('server', snapshot(repo.cwd), repo.cwd);
  assert.match(chosen.from, /^main \(where this branch left it, [0-9a-f]{7,}\)$/);
  assert.deepEqual(chosen.changed, ['d.ts']);
  assert.equal(chosen.base, repo.git('merge-base', 'HEAD', 'main').toString().trim());
});
