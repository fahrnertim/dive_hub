#!/usr/bin/env node
// Command line of unattended implementation (ADR 0054). Prints only what a caller needs.
//
//   node scripts/agent-task.mjs next [--task <id>]    the task to run, as JSON; exit 3 when there is none
//   node scripts/agent-task.mjs set-status <file> <status>
//   node scripts/agent-task.mjs guard <base-ref>      protected paths changed since the merge base; exit 1 if any
//   node scripts/agent-task.mjs pr-body <task file> <out dir> <check: green|red|not run> <run url>   the PR text on stdout
//   node scripts/agent-task.mjs validate              every backlog header is well-formed; exit 1 if not
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { branchOf, buildPrBody, changedFiles, parseTask, pickTask, protectedHits, readBacklog, setStatus } from './agent-lib.mjs';

const [command, ...args] = process.argv.slice(2);
const branchExists = (name) => {
  try { execFileSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', name], { stdio: 'ignore' }); return true; } catch { return false; }
};

if (command === 'next') {
  const want = args[0] === '--task' ? args[1] : undefined;
  const tasks = readBacklog();
  const task = want ? pickTask(tasks.filter((t) => t.id === want), branchExists) : pickTask(tasks, branchExists);
  if (!task) { console.error(want ? `${want} is not a ready task without a branch` : 'No ready task.'); process.exit(3); }
  console.log(JSON.stringify({ id: task.id, file: task.file, branch: branchOf(task), budget: task.budget, risk: task.risk, title: task.title }));
} else if (command === 'set-status') {
  const [file, status] = args;
  fs.writeFileSync(file, setStatus(fs.readFileSync(file, 'utf8'), status));
} else if (command === 'guard') {
  const hits = protectedHits(changedFiles(args[0] ?? 'origin/main'));
  if (hits.length) { console.error(`Protected paths changed:\n${hits.map((h) => `  ${h}`).join('\n')}`); process.exit(1); }
} else if (command === 'pr-body') {
  const [file, out, check, runUrl] = args;
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
  const summary = JSON.parse(read(`${out}/summary.json`) ?? 'null');
  const stop = read(`${out}/stop.txt`)?.trim() ?? null;
  const hits = protectedHits(changedFiles('origin/main'));
  console.log(buildPrBody({
    task: parseTask(read(file), file), agentBody: read('.agent/pr-body.md'), check, hits, runUrl, summary,
    stop: stop ?? (hits.length ? 'a protected path changed' : check === 'red' ? 'pnpm check:full is red' : null),
  }));
} else if (command === 'validate') {
  const bad = readBacklog().flatMap((t) => t.problems.map((p) => `${t.file}: ${p}`));
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
} else {
  console.error('Usage: agent-task.mjs next [--task id] | set-status <file> <status> | guard [base] | validate');
  process.exit(2);
}
