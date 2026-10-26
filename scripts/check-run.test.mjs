// Tests of the check script's runner: two lanes side by side, every step to its end (ADR 0023, amendment of 2026-10-26).
// Run with: node --test scripts/
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { runLanes, takeLock } from './check-run.mjs';

const wait = (ms, code = 0) => `node -e "setTimeout(() => process.exit(${code}), ${ms})"`;
const step = (name, command) => ({ name, command, step: null });

/** A fresh output folder, removed after the test. */
function outDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'check-run-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const lanes = () => [[step('a', wait(600))], [step('b1', wait(300)), step('b2', wait(300))]];

test('the lanes run side by side', async (t) => {
  const started = Date.now();
  const results = await runLanes(lanes(), { sequential: false, outDir: outDir(t), onEnd: () => {} });
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  assert.deepEqual(results.map((r) => [r.name, r.status]), [['a', 0], ['b1', 0], ['b2', 0]]);
});

test('a failing step does not stop the steps after it', async (t) => {
  const ended = [];
  const results = await runLanes([[step('a', wait(300))], [step('b1', wait(100, 1)), step('b2', wait(100))]], { sequential: false, outDir: outDir(t), onEnd: (result) => ended.push(result.name) });
  assert.deepEqual(results.filter((r) => r.name.startsWith('b')).map((r) => r.status), [1, 0]);
  assert.equal(ended.length, 3);
});

test('with sequential the steps run one after another', async (t) => {
  const started = Date.now();
  const results = await runLanes(lanes(), { sequential: true, outDir: outDir(t), onEnd: () => {} });
  assert.ok(Date.now() - started >= 1200, `took ${Date.now() - started} ms`);
  assert.equal(results.length, 3);
});

test("each step's output goes to its own file", (t) => {
  const dir = outDir(t);
  // In a process of its own, to see that nothing reaches its stdout.
  const script = `import { runLanes } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'check-run.mjs')).href)};
const [result] = await runLanes([[{ name: 'greeting', command: 'node -e "console.log(\\'hello\\')"', step: 'scripts' }]], { sequential: false, outDir: ${JSON.stringify(dir)}, onEnd: () => {} });
process.stderr.write(result.log);`;
  const { stdout, stderr, status } = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(status, 0, stderr);
  assert.equal(stdout, '');
  assert.equal(stderr, join(dir, 'scripts.log'));
  assert.match(readFileSync(stderr, 'utf8'), /hello/);
});

/** Whether a process with this id runs. */
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('a step that ends just before the interrupt counts as interrupted, not as passed or failed', async (t) => {
  // On Windows a Ctrl-C reaches the steps too: one may end before the runner hears of it.
  const dir = outDir(t);
  const controller = new AbortController();
  const ended = [];
  const run = runLanes([[{ name: 'racing', command: 'node -e "console.log(\'done\'); process.exit(1)"', step: null }]], { sequential: false, outDir: dir, onEnd: (result) => ended.push(result.name), signal: controller.signal });
  const log = join(dir, 'racing.log');
  const deadline = Date.now() + 5000;
  while (!(existsSync(log) && readFileSync(log, 'utf8').includes('done')) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 10));
  await new Promise((done) => setTimeout(done, 100)); // the step has ended by now
  controller.abort();
  const [result] = await run;
  assert.equal(result.status, null);
  assert.deepEqual(ended, []);
});

test('an interrupted run leaves unfinished steps without a status', async (t) => {
  const dir = outDir(t);
  const controller = new AbortController();
  const log = join(dir, 'long.log');
  // The long step prints its own process id: the process the shell started, which must be gone too.
  const long = { name: 'long', command: 'node -e "console.log(process.pid); setTimeout(() => {}, 20000)"', step: null };
  const run = runLanes([[long], [step('quick', wait(50)), step('later', wait(20000))]], { sequential: false, outDir: dir, onEnd: () => {}, signal: controller.signal });
  const deadline = Date.now() + 5000;
  while (!(existsSync(log) && /\d+/.test(readFileSync(log, 'utf8'))) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
  await new Promise((done) => setTimeout(done, 100));
  controller.abort();
  const results = await run;
  assert.deepEqual(results.map((r) => [r.name, r.status]), [['long', null], ['quick', 0], ['later', null]]);
  const pid = Number(readFileSync(log, 'utf8').trim());
  assert.ok(pid > 0);
  assert.equal(running(pid), false, `process ${pid} still runs`);
});

test('a second check finds the lock held', (t) => {
  const lock = join(outDir(t), 'check.lock');
  const first = takeLock(lock);
  assert.equal(typeof first.release, 'function');
  assert.deepEqual(takeLock(lock), { heldBy: process.pid });
  first.release();
});

test('a lock left by a process that is gone is taken over', (t) => {
  const lock = join(outDir(t), 'check.lock');
  const gone = spawnSync(process.execPath, ['-e', '0']).pid; // a finished child's pid
  writeFileSync(lock, String(gone));
  const taken = takeLock(lock);
  assert.equal(typeof taken.release, 'function');
  assert.equal(readFileSync(lock, 'utf8'), String(process.pid));
  taken.release();
});

test('release frees it', (t) => {
  const lock = join(outDir(t), 'check.lock');
  takeLock(lock).release();
  assert.equal(existsSync(lock), false);
  const again = takeLock(lock);
  assert.equal(typeof again.release, 'function');
  again.release();
});
