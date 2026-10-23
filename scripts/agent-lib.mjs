// The parts of unattended implementation that are plain logic (ADR 0054): the protected paths, the backlog tasks,
// and the token count a task's budget is measured in. No I/O here beyond reading files; agent-task.mjs and
// agent-run.mjs are the command lines.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The owner's four groups: data, access, provider integrations and decisions. An interactive session asks the
 * owner before an edit of one of them (ADR 0055, `.claude/hooks/ask-protected.mjs`).
 */
export const OWNER_PATHS = [
  /^apps\/server\/drizzle\//,
  /^apps\/server\/src\/db\/schema\.ts$/,
  /^apps\/server\/src\/auth\//,
  /^apps\/server\/src\/providers\//,
  /^docs\/decisions\//,
];

/**
 * Paths an unattended run never changes (ADR 0054). One list for the runner's own check and for the CI job, so
 * they cannot disagree. The first group is the owner's decision; the second is the harness an agent could
 * loosen to get its own work through.
 */
export const PROTECTED = [
  ...OWNER_PATHS,
  // The harness: gates, baselines, and the agent's own rules.
  /^\.github\//,
  /^\.claude\//,
  /^\.githooks\//,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^eslint\.config\.mjs$/,
  /^eslint-suppressions\.json$/,
  /^\.dependency-cruiser(-known-violations)?\.(cjs|json)$/,
  /^scripts\/(agent|check|drift)/,
  // What "green" means: the scripts, dependencies and compiler and test settings a change could weaken.
  /(^|\/)package\.json$/,
  /^pnpm-(lock|workspace)\.ya?ml$/,
  /^\.npmrc$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)(vitest|playwright)\.config\.[cm]?[jt]s$/,
];

const hits = (patterns) => (files) => files.map((f) => f.replaceAll('\\', '/')).filter((f) => patterns.some((re) => re.test(f)));
export const protectedHits = hits(PROTECTED);
export const ownerHits = hits(OWNER_PATHS);

export const STATUSES = ['draft', 'ready', 'in-progress', 'done'];
export const RISKS = ['low', 'medium', 'high'];
/** Used when a task names no budget_tokens (ADR 0054). In weighted tokens, see `weighted`. */
export const DEFAULT_BUDGET = 3_000_000;
export const MAX_CHECK_FAILURES = 3;

/** The reason in a last line `STOP: <why>`: the agent's hand-back. A quote of the instruction earlier in the text is not one. */
export function handBack(text) {
  const last = (text ?? '').trim().split('\n').at(-1) ?? '';
  return /^STOP:\s*(.+)$/.exec(last.trim())?.[1] ?? null;
}

/** Frontmatter `key: value` lines; values stay strings. Enough for the task format, no nesting. */
export function parseTask(text, file = '') {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file}: no frontmatter`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  const id = path.basename(file, '.md');
  const budget = meta.budget_tokens ? Number(meta.budget_tokens.replace(/[_,]/g, '')) : DEFAULT_BUDGET;
  const problems = [];
  if (!STATUSES.includes(meta.status)) problems.push(`status must be one of ${STATUSES.join(', ')}`);
  if (!RISKS.includes(meta.risk)) problems.push(`risk must be one of ${RISKS.join(', ')}`);
  if (!Number.isFinite(budget) || budget <= 0) problems.push('budget_tokens must be a positive number');
  return { id, file, title: meta.title ?? id, status: meta.status, risk: meta.risk, budget, body: m[2], problems };
}

export function readBacklog(dir = 'docs/backlog') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^\d{4}-[a-z0-9-]+\.md$/.test(f))
    .sort()
    .map((f) => parseTask(fs.readFileSync(path.join(dir, f), 'utf8'), path.join(dir, f).replace(/\\/g, '/')));
}

/**
 * The next task to run: the first `ready` one by file name, skipping any whose branch already exists (a run is
 * open or waiting for the owner), and any with a malformed header (reported, never run).
 */
export function pickTask(tasks, branchExists) {
  return tasks.find((t) => t.problems.length === 0 && t.status === 'ready' && !branchExists(branchOf(t))) ?? null;
}

/** Files changed on this branch since it left `base`. A rename counts as a delete and an add, so a moved protected file shows its old path. */
export function changedFiles(base, cwd = process.cwd()) {
  const mergeBase = execFileSync('git', ['merge-base', base, 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  return execFileSync('git', ['diff', '--name-only', '--no-renames', `${mergeBase}...HEAD`], { cwd, encoding: 'utf8' }).split('\n').filter(Boolean);
}

export const branchOf = (task) => `agent/${task.id}`;

export function setStatus(text, status) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status ${status}`);
  if (!/^status:[^\n]*$/m.test(text)) throw new Error('no status line');
  return text.replace(/^status:[^\n]*$/m, `status: ${status}`);
}

// Opus list prices relative to uncached input, the weights scripts/token-report.mjs uses (ADR 0039).
const W = { in: 1, cw: 1.25, cr: 0.05, out: 5 };

/** A request's usage in weighted input tokens: the unit of `budget_tokens`. */
export function weighted(u = {}) {
  return (u.input_tokens ?? 0) * W.in
    + (u.cache_creation_input_tokens ?? 0) * W.cw
    + (u.cache_read_input_tokens ?? 0) * W.cr
    + (u.output_tokens ?? 0) * W.out;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// `pnpm check`, `pnpm check:full`, `pnpm run check`, `npx pnpm@12.8.1 check --failed`.
const CHECK_COMMAND = /\bpnpm(@[\w.]+)?\s+(run\s+)?check(:full)?(?=\s|$|[;&|])/;

/**
 * Watches the stream of one unattended run (`claude -p --output-format stream-json --verbose`) and says when it
 * must stop (ADR 0054): the token budget is spent, the third `pnpm check` failed, or an edit aims at a protected
 * path. `feed` takes one parsed event and returns the reason to stop, or null. Pure: agent-run.mjs does the I/O.
 */
export function createMonitor({ budget, root = process.cwd(), maxFailures = MAX_CHECK_FAILURES }) {
  const requests = new Map(); // message id -> weighted tokens; parallel tool calls share an id
  const checks = new Set();
  const state = { tokens: 0, failures: 0, turns: 0 };
  const relative = (p) => path.relative(root, path.resolve(root, p)).replaceAll('\\', '/');

  const onAssistant = (message) => {
    if (message.usage) {
      requests.set(message.id, weighted(message.usage));
      state.tokens = [...requests.values()].reduce((a, b) => a + b, 0);
    }
    for (const block of message.content ?? []) {
      if (block.type !== 'tool_use') continue;
      if (block.name === 'Bash' && CHECK_COMMAND.test(block.input?.command ?? '')) checks.add(block.id);
      const file = block.input?.file_path ?? block.input?.notebook_path;
      if (EDIT_TOOLS.has(block.name) && file && protectedHits([relative(file)]).length) return `an edit of the protected path ${relative(file)}`;
    }
    return state.tokens > budget ? `the token budget of ${budget.toLocaleString('en-US')} is spent (${Math.round(state.tokens).toLocaleString('en-US')})` : null;
  };

  const onUser = (message) => {
    for (const block of message?.content ?? []) {
      if (block.type === 'tool_result' && block.is_error && checks.has(block.tool_use_id)) state.failures += 1;
    }
    return state.failures >= maxFailures ? `${state.failures} runs of pnpm check failed` : null;
  };

  const feed = (event) => {
    if (event.type === 'assistant' && event.message) return onAssistant(event.message);
    if (event.type === 'user') return onUser(event.message);
    if (event.type === 'result') {
      state.turns = event.num_turns ?? state.turns;
      state.tokens = Math.max(state.tokens, weighted(event.usage));
    }
    return null;
  };
  return { feed, state };
}

/**
 * The pull request text of an unattended run: the agent's own text, then what the workflow measured itself.
 * `stop` is the reason the run ended early or null; `check` is "green", "red" or "not run".
 */
export function buildPrBody({ task, agentBody, stop, check, hits, summary, runUrl }) {
  const n = (v) => Math.round(v ?? 0).toLocaleString('en-US');
  return [
    stop ? `> **Stopped, needs the owner:** ${stop}\n` : '',
    agentBody?.trim() || '_The agent wrote no PR text._',
    '\n---',
    `**Unattended run** of \`${task.file}\` · [workflow run](${runUrl}) · ADR 0054`,
    `- Stop: ${stop ?? 'none'}`,
    `- Weighted tokens: ${n(summary?.tokens)} of ${n(task.budget)} · turns: ${summary?.turns ?? '?'} · failed \`pnpm check\` runs: ${summary?.failedChecks ?? '?'}`,
    `- \`pnpm check:full\` after the run: ${check}`,
    `- Protected paths changed: ${hits.length ? hits.map((h) => `\`${h}\``).join(', ') : 'none'}`,
    '\nReview it like any other change; nothing merges without you.',
    '\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].filter((l) => l !== '').join('\n');
}
