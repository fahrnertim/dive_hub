// The check script's runner (ADR 0023, amendment of 2026-10-26): lanes of steps side by side, each lane's steps one
// after another, every step to its end whatever the earlier ones returned. Each step's output goes to a file of its
// own; the caller prints a failure's log. Ctrl-C (or the `signal`) kills every running step with its children.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
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

/** Runs one step with its output to `log`; resolves with its exit code, or null when it was killed by `stop`. */
function runStep(command, log, running) {
  return new Promise((done) => {
    const fd = openSync(log, 'w');
    const child = spawn(command, { shell: true, stdio: ['ignore', fd, fd], detached: !WINDOWS, windowsHide: true });
    closeSync(fd);
    const entry = { child, stopped: false };
    running.add(entry);
    const end = (code) => {
      running.delete(entry);
      done(entry.stopped ? null : (code ?? 1));
    };
    child.on('error', () => end(1));
    child.on('close', end);
  });
}

/**
 * Runs `lanes` (arrays of `{ name, command, step }`) side by side, or with `sequential` all steps one after another
 * in lane order. Each step's output goes to `<outDir>/<step or name>.log`; `onEnd(result)` is called as each step
 * ends. Resolves with a result per step in lane order: `{ name, step, status, seconds, log }`, `status` the exit
 * code, or null for a step that was interrupted (SIGINT or `signal`) or never started.
 */
export async function runLanes(lanes, { sequential = false, outDir, onEnd = () => {}, signal } = {}) {
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
  const runLane = async (lane) => {
    for (const { laneStep, result } of lane) {
      if (stopped) return;
      const started = Date.now();
      result.status = await runStep(laneStep.command, result.log, running);
      result.seconds = (Date.now() - started) / 1000;
      if (result.status !== null) onEnd(result);
    }
  };
  try {
    await (sequential ? runLane(indexed.flat()) : Promise.all(indexed.map(runLane)));
  } finally {
    signal?.removeEventListener('abort', stop);
    process.off('SIGINT', stop);
  }
  return results;
}
