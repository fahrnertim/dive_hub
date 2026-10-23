#!/usr/bin/env node
// Runs one backlog task with Claude Code, unattended, and enforces the stops of ADR 0054 on the event stream.
//
//   node scripts/agent-run.mjs --task docs/backlog/0001-x.md --budget 3000000 --out <dir>
//
// Writes <dir>/stream.jsonl (every event), <dir>/summary.json (tokens, turns, cost, the agent's last message)
// and, when the run must end early, <dir>/stop.txt (one line: why). Exit 0: the agent finished. Exit 10: a stop,
// the caller hands the branch to the owner. Exit 1: the runner itself failed.
// Nothing else reaches stdout; the workflow log stays short (ADR 0039).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createMonitor, DEFAULT_BUDGET, handBack } from './agent-lib.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const task = arg('--task');
const out = arg('--out');
const budget = Number(arg('--budget') ?? DEFAULT_BUDGET);
if (!task || !out || !Number.isFinite(budget)) {
  console.error('Usage: agent-run.mjs --task <file> --out <dir> [--budget <weighted tokens>]');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

// What the agent may do. Everything else is denied without asking (--permission-mode dontAsk): no network
// tools, no gh, no push, no shell beyond these. Edits to protected paths are refused by the hook as well
// (.claude/hooks/guard-protected.mjs) and stop the run here.
const ALLOWED = [
  'Read', 'Grep', 'Glob', 'Edit', 'Write', 'Agent', 'Skill',
  'Bash(pnpm *)', 'Bash(node scripts/*)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git show*)',
  'Bash(git add *)', 'Bash(git commit *)', 'Bash(ls*)',
];

const monitor = createMonitor({ budget });
const stream = fs.createWriteStream(path.join(out, 'stream.jsonl'));
const child = spawn(process.env.AGENT_CLAUDE_BIN ?? 'claude', [
  '-p', `Run the backlog task ${task}.`,
  '--agent', 'unattended-runner',
  '--output-format', 'stream-json', '--verbose',
  '--permission-mode', 'dontAsk',
  '--allowedTools', ALLOWED.join(','),
  '--max-turns', '200',
], { env: { ...process.env, AGENT_UNATTENDED: '1', DISABLE_AUTOUPDATER: '1' }, stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });

let stop = null;
let result = null;
const lines = createInterface({ input: child.stdout });
lines.on('line', (line) => {
  stream.write(`${line}\n`);
  if (stop) return;
  let event;
  try { event = JSON.parse(line); } catch { return; }
  if (event.type === 'result') result = event;
  stop = monitor.feed(event);
  if (stop) child.kill('SIGTERM');
});

child.on('error', (error) => { console.error(`Could not start claude: ${error.message}`); process.exit(1); });
child.on('close', (code) => {
  stream.end();
  const last = typeof result?.result === 'string' ? result.result.trim() : '';
  // The agent hands a task back by making the last line of its last message "STOP: <why>" (an ADR would need to change, ...).
  const why = handBack(last);
  if (!stop && why) stop = `the agent handed the task back: ${why}`;
  if (!stop && (!result || result.is_error || result.subtype !== 'success')) {
    stop = `the run ended without finishing (${result?.subtype ?? `exit code ${code}`})`;
  }
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({
    task, budget, tokens: Math.round(monitor.state.tokens), turns: monitor.state.turns,
    failedChecks: monitor.state.failures, costUsd: result?.total_cost_usd ?? null, stop, last,
  }, null, 2));
  if (stop) {
    fs.writeFileSync(path.join(out, 'stop.txt'), `${stop}\n`);
    console.error(`Stopped: ${stop}`);
    process.exit(10);
  }
});
