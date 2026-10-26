// Tests of the check script's runner: two lanes side by side, every step to its end (ADR 0023, amendment of 2026-10-26).
// Run with: node --test scripts/
// No test here may depend on a tight time bound or on a process id being free: `node --test` runs the script test
// files side by side, and Windows reuses process ids.
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
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A fresh output folder, removed after the test. */
function outDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'check-run-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A step that passes only when it runs at the same time as the step writing `other`: it writes its own file `mine`,
 * then waits (20 s at most) for `other`. No time bound decides, so a slow machine cannot fail it.
 */
function meeting(dir, name, mine, other) {
  const script = join(dir, 'meet.mjs');
  writeFileSync(script, `import { existsSync, writeFileSync } from 'node:fs';
const [mine, other] = process.argv.slice(2);
writeFileSync(mine, '');
const deadline = Date.now() + 20000;
const look = () => (existsSync(other) ? process.exit(0) : Date.now() > deadline ? process.exit(1) : setTimeout(look, 20));
look();
`);
  return step(name, `node "${script}" "${join(dir, mine)}" "${join(dir, other)}"`);
}

test('the lanes run side by side', async (t) => {
  // a and b1 each wait for the other: run one after another, the first would give up and fail.
  const dir = outDir(t);
  const lanes = [[meeting(dir, 'a', 'a.flag', 'b1.flag')], [meeting(dir, 'b1', 'b1.flag', 'a.flag'), step('b2', wait(10))]];
  const results = await runLanes(lanes, { sequential: false, outDir: dir, onEnd: () => {} });
  assert.deepEqual(results.map((r) => [r.name, r.status]), [['a', 0], ['b1', 0], ['b2', 0]]);
});

test('a failing step does not stop the steps after it', async (t) => {
  const ended = [];
  const results = await runLanes([[step('a', wait(300))], [step('b1', wait(100, 1)), step('b2', wait(100))]], { sequential: false, outDir: outDir(t), onEnd: (result) => ended.push(result.name) });
  assert.deepEqual(results.filter((r) => r.name.startsWith('b')).map((r) => r.status), [1, 0]);
  assert.equal(ended.length, 3);
});

test('with sequential the steps run one after another', async (t) => {
  // A lower bound only: a slow machine makes it longer, never shorter.
  const started = Date.now();
  const results = await runLanes([[step('a', wait(600))], [step('b1', wait(300)), step('b2', wait(300))]], { sequential: true, outDir: outDir(t), onEnd: () => {} });
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

/**
 * A step whose node process writes a dot every 20 ms until it is killed: whether that process still runs shows in its
 * log, with no process id involved.
 */
const ticking = (name) => ({ name, command: `node -e "setInterval(() => process.stdout.write('.'), 20)"`, step: null });

/** Waits (10 s at most) until `log` contains `text`. */
async function untilLogged(log, text) {
  const deadline = Date.now() + 10_000;
  while (!(existsSync(log) && readFileSync(log, 'utf8').includes(text)) && Date.now() < deadline) await sleep(20);
}

/** Whether the process writing `log` still runs: the log grows within 500 ms. */
async function stillWrites(log) {
  const before = readFileSync(log, 'utf8').length;
  await sleep(500);
  return readFileSync(log, 'utf8').length !== before;
}

test('a step that ends just before the interrupt counts as interrupted, not as passed or failed', async (t) => {
  // On Windows a Ctrl-C reaches the steps too: one may end before the runner hears of it. The settle time, ten times
  // the real one, leaves 2.5 s between the interrupt below and its end, however slow the machine is.
  const dir = outDir(t);
  const controller = new AbortController();
  const ended = [];
  const run = runLanes([[{ name: 'racing', command: `node -e "console.log('done'); process.exit(1)"`, step: null }]], { sequential: false, outDir: dir, onEnd: (result) => ended.push(result.name), signal: controller.signal, settleMs: 3000 });
  await untilLogged(join(dir, 'racing.log'), 'done');
  await sleep(500); // the step has ended by now
  controller.abort();
  const [result] = await run;
  assert.equal(result.status, null);
  assert.deepEqual(ended, []);
});

test('an interrupted run leaves unfinished steps without a status', async (t) => {
  const dir = outDir(t);
  const controller = new AbortController();
  const log = join(dir, 'long.log');
  let quickEnded;
  const quick = new Promise((done) => { quickEnded = done; });
  const onEnd = (result) => { if (result.name === 'quick') quickEnded(); };
  const run = runLanes([[ticking('long')], [step('quick', wait(50)), step('later', wait(20_000))]], { sequential: false, outDir: dir, onEnd, signal: controller.signal });
  await quick;
  await untilLogged(log, '.');
  controller.abort();
  const results = await run;
  assert.deepEqual(results.map((r) => [r.name, r.status]), [['long', null], ['quick', 0], ['later', null]]);
  // The node process the shell started is gone too, not only the shell.
  assert.equal(await stillWrites(log), false, 'the long step still runs');
});

test('a throw in onEnd stops every step before runLanes rejects', async (t) => {
  // A green record that cannot be written (a ref lock held by an IDE) must not leave the other lane running.
  const dir = outDir(t);
  const log = join(dir, 'long.log');
  const run = runLanes([[step('quick', wait(50))], [ticking('long')]], { sequential: false, outDir: dir, onEnd: () => { throw new Error('boom'); } });
  await assert.rejects(run, /boom/);
  assert.equal(existsSync(log) && await stillWrites(log), false, 'the long step still runs');
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
  writeFileSync(lock, '12345');
  // The liveness check is given: a real finished child's pid may already run something else (Windows reuses them).
  const taken = takeLock(lock, { isRunning: () => false });
  assert.equal(typeof taken.release, 'function');
  assert.equal(readFileSync(lock, 'utf8'), String(process.pid));
  taken.release();
});

test('a lock whose process runs is kept', (t) => {
  const lock = join(outDir(t), 'check.lock');
  writeFileSync(lock, '12345');
  assert.deepEqual(takeLock(lock, { isRunning: (pid) => pid === 12345 }), { heldBy: 12345 });
  assert.equal(readFileSync(lock, 'utf8'), '12345');
});

test('release frees it', (t) => {
  const lock = join(outDir(t), 'check.lock');
  takeLock(lock).release();
  assert.equal(existsSync(lock), false);
  const again = takeLock(lock);
  assert.equal(typeof again.release, 'function');
  again.release();
});
