// The check script's runner (ADR 0023, amendment of 2026-10-26): lanes of steps side by side, each lane's steps one
// after another, every step to its end whatever the earlier ones returned. Each step's output goes to a file of its
// own; the caller prints a failure's log. Ctrl-C (or the `signal`) kills every running step with its children.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WINDOWS = process.platform === 'win32';

/** Kills a step's shell and everything it started. */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (WINDOWS) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGKILL'); // the step's process group (it was started detached)
    } catch { /* already gone */ }
  }
}

/**
 * How long a failed step's end waits for an interrupt. On Windows a Ctrl-C reaches every process of the console,
 * the steps too: one may end, failed, before the runner's SIGINT handler runs. A step that fails this shortly before
 * an interrupt counts as interrupted, so nothing is recorded for it. A step that passed did its work: no wait.
 */
const SETTLE_MS = 300;

/**
 * Runs one step with its output to `log`; resolves with its exit code, or null when `stop` came while it ran or
 * within `settleMs` after it failed.
 */
function runStep(command, log, running, settleMs) {
  return new Promise((done) => {
    const fd = openSync(log, 'w');
    const child = spawn(command, { shell: true, stdio: ['ignore', fd, fd], detached: !WINDOWS, windowsHide: true });
    closeSync(fd);
    const entry = { child, stopped: false };
    running.add(entry);
    let ended = false;
    const end = (code) => {
      if (ended) return;
      ended = true;
      const settle = () => {
        running.delete(entry);
        done(entry.stopped ? null : (code ?? 1));
      };
      if (code === 0 && !entry.stopped) settle();
      else setTimeout(settle, settleMs);
    };
    child.on('error', () => end(1));
    child.on('close', end);
  });
}

/**
 * Runs `lanes` (arrays of `{ name, command, step }`) side by side, or with `sequential` all steps one after another
 * in lane order. Each step's output goes to `<outDir>/<step or name>.log`; `onEnd(result)` is called as each step
 * ends. Resolves with a result per step in lane order: `{ name, step, status, seconds, log }`, `status` the exit
 * code, or null for a step that was interrupted (SIGINT or `signal`) or never started. When `onEnd` throws, every
 * running step is stopped with its children and runLanes rejects with that error once they are gone. `settleMs` is
 * SETTLE_MS (tests set it).
 */
export async function runLanes(lanes, { sequential = false, outDir, onEnd = () => {}, signal, settleMs = SETTLE_MS } = {}) {
  mkdirSync(outDir, { recursive: true });
  const results = lanes.flat().map(({ name, step }) => ({ name, step, status: null, seconds: 0, log: join(outDir, `${(step ?? name).replace(/[^\w.-]+/g, '-')}.log`) }));
  const running = new Set();
  let stopped = signal?.aborted ?? false;
  const stop = () => {
    stopped = true;
    for (const entry of running) {
      entry.stopped = true;
      killTree(entry.child);
    }
  };
  signal?.addEventListener('abort', stop, { once: true });
  process.on('SIGINT', stop);

  let index = 0;
  const indexed = lanes.map((lane) => lane.map((laneStep) => ({ laneStep, result: results[index++] })));
  let failure;
  const runLane = async (lane) => {
    try {
      for (const { laneStep, result } of lane) {
        if (stopped) return;
        const started = Date.now();
        result.status = await runStep(laneStep.command, result.log, running, settleMs);
        result.seconds = (Date.now() - started) / 1000;
        if (result.status !== null) onEnd(result);
      }
    } catch (error) {
      // No lane may outlive another's error: its steps would keep their ports and browsers.
      failure ??= error;
      stop();
    }
  };
  try {
    await (sequential ? runLane(indexed.flat()) : Promise.all(indexed.map(runLane)));
  } finally {
    signal?.removeEventListener('abort', stop);
    process.off('SIGINT', stop);
  }
  if (failure) throw failure;
  return results;
}

/** Whether a process with this pid runs. A pid can be reused by an unrelated process: then a dead check's lock holds until that one ends (acceptable). */
function processRuns(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM'; // it exists, but is not ours to signal
  }
}

/**
 * One check at a time per clone: takes the lock file at `path` (it holds the pid of the check that has it).
 * Returns `{ release }`, or `{ heldBy }`, the pid of the running check. A lock whose pid no longer runs is taken over;
 * `isRunning(pid)` says whether it runs (tests give their own).
 */
export function takeLock(path, { isRunning = processRuns } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(process.pid), { flag: 'wx' });
      return { release: () => rmSync(path, { force: true }) };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const pid = Number.parseInt(readFileSync(path, 'utf8'), 10);
    if (Number.isInteger(pid) && isRunning(pid)) return { heldBy: pid };
    rmSync(path, { force: true }); // left by a check that is gone
  }
  return { heldBy: Number.NaN };
}
