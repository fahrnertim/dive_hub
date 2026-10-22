#!/usr/bin/env node
// PostToolUse hook (research note 2026-10-22-agent-guardrails): after an edit, ESLint and dependency-cruiser on the
// edited file, against their baselines. Silent when the file is fine; otherwise exit code 2 with the problems on
// stderr, which the agent sees and fixes. Only problems are printed (ADR 0039).
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { LINT_CONFIG, lintTargets } from '../../scripts/check-lib.mjs';
import { lint } from '../../scripts/check-lint.mjs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
if (!file) process.exit(0);

const path = relative(root, file).replace(/\\/g, '/');
const targets = lintTargets([path]);
// Outside the repository, or a file neither tool looks at; a baseline that grew is checked on every run.
if (path.startsWith('..') || (targets.eslint.length === 0 && targets.deps.length === 0 && !LINT_CONFIG.test(path))) process.exit(0);

let problems;
try {
  problems = lint({ files: LINT_CONFIG.test(path) ? [] : [path], cwd: root });
} catch (error) {
  // A broken tool must not block editing; the check reports it.
  process.stderr.write(`lint-file hook could not run: ${error.message.split('\n')[0]}\n`);
  process.exit(0);
}
if (problems) {
  process.stderr.write(`${problems}\n(Fix these in ${path}; don't add them to a baseline or raise a threshold.)\n`);
  process.exit(2);
}
