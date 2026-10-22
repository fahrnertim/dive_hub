import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_BUDGET, buildPrBody, changedFiles, createMonitor, handBack, parseTask, pickTask, protectedHits, readBacklog, setStatus, weighted } from './agent-lib.mjs';

const task = (name, header) => parseTask(`---\n${header}\n---\nbody\n`, `docs/backlog/${name}.md`);

test('protectedHits names the owner-decided paths and the harness, and nothing else', () => {
  const files = [
    'apps/server/drizzle/0012_x.sql', 'apps/server/src/db/schema.ts', 'apps/server/src/auth/index.ts',
    'apps/server/src/providers/ssi/client.ts', 'docs/decisions/0054-x.md', '.github/workflows/check.yml',
    'AGENTS.md', 'eslint-suppressions.json', 'scripts/check-lib.mjs',
  ];
  assert.deepEqual(protectedHits(files), files);
  assert.deepEqual(protectedHits([
    'apps/server/src/db/client.ts', 'apps/server/src/dives/routes.ts', 'docs/backlog/0001-x.md', 'docs/spec/clients.md',
    'apps/web/src/locales/en.json', 'apps/server/src/authors/x.ts', 'scripts/token-report.mjs',
  ]), []);
  assert.deepEqual(protectedHits(['apps\\server\\src\\auth\\a.ts']), ['apps/server/src/auth/a.ts']);
});

test('parseTask reads the header, takes the id from the file name and defaults the budget', () => {
  const t = task('0001-copy', 'title: "Fix copy"\nstatus: ready   # picked up\nrisk: low\nbudget_tokens: 1_500_000');
  assert.equal(t.id, '0001-copy');
  assert.equal(t.title, 'Fix copy');
  assert.equal(t.status, 'ready');
  assert.equal(t.budget, 1_500_000);
  assert.deepEqual(t.problems, []);
  assert.equal(task('0002-x', 'status: draft\nrisk: low').budget, DEFAULT_BUDGET);
});

test('parseTask reports a bad header instead of guessing', () => {
  assert.equal(task('0003-x', 'status: soon\nrisk: low').problems.length, 1);
  assert.equal(task('0004-x', 'status: ready\nrisk: low\nbudget_tokens: lots').problems.length, 1);
  assert.throws(() => parseTask('no header', 'x.md'), /no frontmatter/);
});

test('pickTask takes the first ready task whose branch is free, and never a malformed one', () => {
  const tasks = [
    task('0001-a', 'status: draft\nrisk: low'),
    task('0002-b', 'status: ready\nrisk: low'),
    task('0003-c', 'status: ready\nrisk: low'),
    task('0004-d', 'status: ready\nrisk: sky-high'),
  ];
  assert.equal(pickTask(tasks, () => false).id, '0002-b');
  assert.equal(pickTask(tasks, (b) => b === 'agent/0002-b').id, '0003-c');
  assert.equal(pickTask(tasks, () => true), null);
});

test('setStatus changes the status line only', () => {
  assert.equal(setStatus('---\nstatus: ready\nrisk: low\n---\nstatus: kept\n', 'in-progress'), '---\nstatus: in-progress\nrisk: low\n---\nstatus: kept\n');
  assert.throws(() => setStatus('---\n---\n', 'done'), /no status/);
  assert.throws(() => setStatus('status: ready', 'finished'), /unknown status/);
});

test('weighted counts a request in input-token equivalents', () => {
  assert.equal(weighted({ input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 10 }), 10 + 125 + 50 + 50);
  assert.equal(weighted(undefined), 0);
});

test('every task in docs/backlog has a well-formed header', () => {
  assert.deepEqual(readBacklog().flatMap((t) => t.problems.map((p) => `${t.file}: ${p}`)), []);
});

const say = (id, content, usage = { input_tokens: 10, output_tokens: 10 }) => ({ type: 'assistant', message: { id, usage, content } });
const bash = (id, command) => say(`m-${id}`, [{ type: 'tool_use', id, name: 'Bash', input: { command } }]);
const failed = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true }] } });

test('the monitor stops at the third failed pnpm check, and only counts checks', () => {
  const m = createMonitor({ budget: 1e9, root: '/repo' });
  const run = (id, cmd, bad = true) => [m.feed(bash(id, cmd)), bad ? m.feed(failed(id)) : null];
  assert.deepEqual(run('a', 'pnpm check'), [null, null]);
  assert.deepEqual(run('b', 'ls -la'), [null, null]); // not a check
  assert.deepEqual(run('c', 'npx pnpm@12.8.1 check --failed'), [null, null]);
  assert.match(run('d', 'pnpm check:full')[1], /3 runs of pnpm check failed/);
});

test('the monitor stops when the weighted tokens pass the budget, counting a shared message id once', () => {
  const m = createMonitor({ budget: 900, root: '/repo' });
  const big = { input_tokens: 0, cache_read_input_tokens: 10_000 }; // 500 weighted
  assert.equal(m.feed(say('x', [], big)), null);
  assert.equal(m.feed(say('x', [], big)), null); // same request again: still 500
  assert.match(m.feed(say('y', [], big)) ?? '', /token budget of 900 is spent/);
});

test('the monitor stops on an edit aimed at a protected path, absolute or relative', () => {
  const m = createMonitor({ budget: 1e9, root: '/repo' });
  const edit = (file_path) => say('e', [{ type: 'tool_use', id: 'e', name: 'Edit', input: { file_path } }]);
  assert.equal(m.feed(edit('/repo/apps/server/src/dives/routes.ts')), null);
  assert.match(m.feed(edit('/repo/apps/server/src/auth/index.ts')) ?? '', /protected path apps\/server\/src\/auth\/index\.ts/);
  assert.match(m.feed(edit('docs/decisions/0001-x.md')) ?? '', /protected path/);
});

test('buildPrBody puts the stop first and states what the workflow measured', () => {
  const t = task('0001-x', 'status: in-progress\nrisk: low\nbudget_tokens: 2000000');
  const common = { task: t, agentBody: '## Task\nthe task', check: 'green', hits: [], runUrl: 'https://example/run/1', summary: { tokens: 1234.6, turns: 12, failedChecks: 1 } };
  const ok = buildPrBody({ ...common, stop: null });
  assert.match(ok, /^## Task/);
  assert.match(ok, /Weighted tokens: 1,235 of 2,000,000 · turns: 12 · failed `pnpm check` runs: 1/);
  assert.match(ok, /Protected paths changed: none/);
  const stopped = buildPrBody({ ...common, agentBody: '', stop: 'the token budget is spent', hits: ['docs/decisions/0001-x.md'], check: 'not run' });
  assert.match(stopped, /^> \*\*Stopped, needs the owner:\*\* the token budget is spent/);
  assert.match(stopped, /agent wrote no PR text/);
  assert.match(stopped, /`docs\/decisions\/0001-x\.md`/);
});

test('what decides "green" is protected too: package scripts, lockfile, compiler and test settings', () => {
  const files = ['package.json', 'apps/web/package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'apps/server/tsconfig.json', 'apps/web/vitest.config.ts', 'apps/web/playwright.config.ts'];
  assert.deepEqual(protectedHits(files), files);
});

test('the monitor counts pnpm check and pnpm check:full, not other commands that start the same', () => {
  const m = createMonitor({ budget: 1e9, root: '/repo', maxFailures: 1 });
  m.feed(bash('x', 'pnpm check-foo'));
  assert.equal(m.feed(failed('x')), null);
  m.feed(bash('y', 'cd apps && pnpm check:full; echo done'));
  assert.match(m.feed(failed('y')) ?? '', /1 runs of pnpm check failed/);
});

test('handBack reads STOP only from the last line', () => {
  assert.equal(handBack('Work done.\nSTOP: needs a new ADR'), 'needs a new ADR');
  assert.equal(handBack('I will end with "STOP: <why>" if needed.\nAll done, PR text written.'), null);
  assert.equal(handBack('STOP: x\nthen more text'), null);
  assert.equal(handBack(undefined), null);
});

test('changedFiles names the old path of a renamed file, so a moved protected file is still seen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-git-'));
  try {
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(dir, 'docs/decisions'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/decisions/0001-x.md'), 'decision text that is long enough to be detected as a rename\n'.repeat(5));
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'agent/0001-x');
    git('mv', 'docs/decisions/0001-x.md', 'docs/moved.md');
    git('commit', '-q', '-am', 'move');
    assert.deepEqual(changedFiles('main', dir).sort(), ['docs/decisions/0001-x.md', 'docs/moved.md']);
    assert.deepEqual(protectedHits(changedFiles('main', dir)), ['docs/decisions/0001-x.md']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
