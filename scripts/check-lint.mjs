#!/usr/bin/env node
// Lint and module boundaries (research note 2026-10-22-agent-guardrails, ADR 0023 amendment of 2026-10-22): ESLint
// and dependency-cruiser, each against its baseline of the problems that existed when the rules came. Only new
// problems fail, and a baseline may only shrink. Prints problems only, nothing when all is well (ADR 0039).
//   node scripts/check-lint.mjs --all          every file (pnpm lint)
//   node scripts/check-lint.mjs a.ts b.tsx     these files (the edit hook)
//   node scripts/check-lint.mjs --files-from list.txt   the files listed in a file, one per line (the check by what changed)
//   node scripts/check-lint.mjs --shrink       take fixed problems out of both baselines (pnpm lint:baseline)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASELINES, baselineGrowth, lintTargets } from './check-lib.mjs';

const ESLINT = 'node_modules/eslint/bin/eslint.js';
const DEPCRUISE = 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs';
const KNOWN = '.dependency-cruiser-known-violations.json';
const SOURCES = ['apps/server/src', 'apps/web/src'];
// Past this many files a run over everything is as quick, and the command line stays short.
const MANY = 150;

const run = (cwd, args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: status ?? 1, out: `${stdout ?? ''}${stderr ?? ''}`.trim() };
};
const eslintArgs = ['--quiet', '--no-warn-ignored', '--cache', '--cache-strategy', 'content', '--cache-location', 'node_modules/.cache/eslint/'];

/** A dependency violation as one line, and the key it is matched with against the baseline. */
const key = (v) => `${v.rule.name}|${v.from}|${v.to}`;
const describe = (v) => `${v.rule.name}: ${v.from} → ${v.to}${v.cycle ? ` (${v.cycle.map((step) => step.name ?? step).join(' → ')})` : ''}`;

/** The dependency violations there are now, starting from `paths` (all of them, the known ones too). */
function dependencyViolations(cwd, paths) {
  const dir = mkdtempSync(join(tmpdir(), 'check-deps-'));
  try {
    const file = join(dir, 'violations.json');
    const { status, out } = run(cwd, [DEPCRUISE, '--config', '.dependency-cruiser.cjs', '--output-type', 'baseline', '--output-to', file, ...paths]);
    if (status !== 0 || !existsSync(file)) throw new Error(`dependency-cruiser failed:\n${out}`);
    return JSON.parse(readFileSync(file, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const known = (cwd) => (existsSync(`${cwd}/${KNOWN}`) ? JSON.parse(readFileSync(`${cwd}/${KNOWN}`, 'utf8')) : []);

const gitText = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * The commit the baselines are compared with: BASELINE_REF (CI: the pull request's base, or the commit before a
 * push), else HEAD. A BASELINE_REF that isn't in the history (a force-push) falls back to the commit before HEAD.
 */
function baselineRef(cwd) {
  const wanted = process.env.BASELINE_REF;
  if (!wanted || /^0+$/.test(wanted)) return 'HEAD';
  try {
    gitText(cwd, ['rev-parse', '--verify', '--quiet', `${wanted}^{commit}`]);
    return wanted;
  } catch {
    return 'HEAD^';
  }
}

/** The files moved since the commit to compare with, old path → new (git's rename detection). */
function renamesSince(cwd) {
  const out = gitText(cwd, ['-c', 'core.quotepath=off', 'diff', '-M', '--name-status', '--diff-filter=R', baselineRef(cwd)]);
  return new Map(out.split('\n').filter(Boolean).map((line) => line.split('\t').slice(1, 3)));
}

/** Each baseline as it was at the commit to compare with, null when absent there. */
function baselinesBefore(cwd) {
  const ref = baselineRef(cwd);
  return BASELINES.map((path) => {
    let before = null;
    try {
      before = gitText(cwd, ['show', `${ref}:${path}`]);
    } catch { /* not there at that commit */ }
    return [path, before, existsSync(`${cwd}/${path}`) ? readFileSync(`${cwd}/${path}`, 'utf8') : null];
  });
}

/**
 * Lints every file (`all`) or the given changed files. Returns the problems as text (empty when there are none):
 * ESLint's report, new dependency violations, a baseline that grew, and in a run over everything, known
 * violations that no longer occur (the baseline must shrink with them).
 */
export function lint({ all = false, files = [], cwd = process.cwd() } = {}) {
  const targets = lintTargets(files.map((path) => path.replace(/\\/g, '/')).filter((path) => existsSync(`${cwd}/${path}`)));
  const everything = all || targets.eslint.length > MANY;
  const problems = [];

  if (everything || targets.eslint.length > 0) {
    const { status, out } = run(cwd, [ESLINT, ...eslintArgs, ...(everything ? ['.'] : targets.eslint)]);
    if (status !== 0) problems.push(out || `ESLint exited with ${status}`);
  }

  if (everything || targets.deps.length > 0) {
    const before = known(cwd);
    const knownKeys = new Set(before.map(key));
    const now = dependencyViolations(cwd, everything ? SOURCES : targets.deps);
    const fresh = now.filter((v) => !knownKeys.has(key(v)));
    if (fresh.length > 0) {
      problems.push(`New dependency violations (rules in .dependency-cruiser.cjs, ADR 0053):\n${[...new Map(fresh.map((v) => [key(v), describe(v)])).values()].map((line) => `  ${line}`).join('\n')}`);
    }
    if (everything) {
      const nowKeys = new Set(now.map(key));
      const fixed = before.filter((v) => !nowKeys.has(key(v)));
      if (fixed.length > 0) problems.push(`${fixed.length} known dependency violation(s) no longer occur; take them out of ${KNOWN} with pnpm lint:baseline:\n${fixed.map((v) => `  ${describe(v)}`).join('\n')}`);
    }
  }

  problems.push(...baselineGrowth(baselinesBefore(cwd), renamesSince(cwd)));
  return problems.join('\n\n');
}

/** Takes the problems that no longer occur out of both baselines; never adds one. */
export function shrink(cwd = process.cwd()) {
  const eslint = run(cwd, [ESLINT, ...eslintArgs, '--prune-suppressions', '.']);
  const nowKeys = new Set(dependencyViolations(cwd, SOURCES).map(key));
  const before = known(cwd);
  const kept = before.filter((v) => nowKeys.has(key(v)));
  if (kept.length < before.length) writeFileSync(`${cwd}/${KNOWN}`, `${JSON.stringify(kept, null, 2)}\n`);
  console.log(`${KNOWN}: ${before.length} → ${kept.length}; eslint-suppressions.json pruned${eslint.status === 0 ? '' : ` (ESLint still reports problems:\n${eslint.out})`}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  if (args.includes('--shrink')) {
    shrink();
  } else {
    const from = args.includes('--files-from') ? args[args.indexOf('--files-from') + 1] : null;
    const files = from ? readFileSync(from, 'utf8').split(/\r?\n/).filter(Boolean) : args.filter((arg) => !arg.startsWith('--'));
    const problems = lint({ all: args.includes('--all'), files });
    if (problems) {
      console.log(problems);
      process.exit(1);
    }
  }
}
