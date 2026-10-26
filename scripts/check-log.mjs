#!/usr/bin/env node
// The local run log of `pnpm check` (ADR 0023, amendment of 2026-10-26): one JSON line per run that ran steps, in
// `check-runs.jsonl` in git's common directory. `pnpm check:log [--last N] [--branch <name>]` reads it.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failedTestsFromReport, localTime } from './check-lib.mjs';

/** The log's path: `check-runs.jsonl` in git's common directory. */
export const logPath = () => resolve(spawnSync('git rev-parse --git-common-dir', { encoding: 'utf8', shell: true }).stdout.trim(), 'check-runs.jsonl');

/** Appends `entry` as one line to the log at `path`; false (never a throw) when it cannot be written. */
export function appendRun(entry, path) {
  try {
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** The tests of a Playwright JSON report: count, summed run time, the failed ones (`--test-list` lines), the 5 slowest. */
export function browserStats(report) {
  const timed = [];
  const walk = (suite, describes) => {
    for (const spec of suite.specs ?? []) {
      const ms = (spec.tests ?? []).flatMap((t) => t.results ?? []).reduce((sum, r) => sum + (r.duration ?? 0), 0);
      timed.push({ test: [spec.file, ...describes, spec.title].join(' › '), seconds: ms / 1000 });
    }
    for (const child of suite.suites ?? []) walk(child, [...describes, child.title]);
  };
  for (const fileSuite of report?.suites ?? []) walk(fileSuite, []);
  const round = (n) => Math.round(n * 10) / 10;
  return {
    tests: timed.length,
    workerSeconds: round(timed.reduce((sum, t) => sum + t.seconds, 0)),
    failed: failedTestsFromReport(report),
    slowest: timed.sort((a, b) => b.seconds - a.seconds).slice(0, 5).map(({ test, seconds }) => ({ test, seconds: round(seconds) })),
  };
}

const where = (run) => run.branch ?? `(detached ${run.head})`;

/** The last runs, one line each, then per branch the runs, the failed ones and the total wall time. */
export function summarise(entries, { last = 20, branch } = {}) {
  const runs = branch ? entries.filter((run) => run.branch === branch) : entries;
  const lines = runs.slice(-last).map((run) => {
    const slowest = [...(run.steps ?? [])].sort((a, b) => b.seconds - a.seconds)[0];
    const time = localTime(new Date(run.at));
    return `${time}  ${where(run)}  ${run.by}  ${run.result}  ${Math.round(run.wall)} s  slowest: ${slowest ? `${slowest.step} ${Math.round(slowest.seconds)} s` : '-'}`;
  });
  const byBranch = new Map();
  for (const run of runs) {
    const sum = byBranch.get(where(run)) ?? { runs: 0, failed: 0, wall: 0 };
    byBranch.set(where(run), { runs: sum.runs + 1, failed: sum.failed + (run.result === 'failed' ? 1 : 0), wall: sum.wall + run.wall });
  }
  const totals = [...byBranch].map(([name, s]) => `${name}: ${s.runs} run${s.runs === 1 ? '' : 's'}, ${s.failed} failed, ${Math.round(s.wall)} s`);
  return [...lines, '', ...totals].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const path = logPath();
  if (!existsSync(path)) return console.log('no check runs logged yet');
  const entries = readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const last = value('--last') ? Number(value('--last')) : 20;
  if (entries.length === 0) return console.log('no check runs logged yet');
  console.log(summarise(entries, { last, branch: value('--branch') }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
