#!/usr/bin/env node
// PreToolUse hook (ADR 0054): in an unattended run (AGENT_UNATTENDED=1) refuses edits of protected paths.
// Interactive sessions are not affected. Exit code 2 with the reason on stderr, which the agent sees; the
// runner (scripts/agent-run.mjs) also sees the attempt in the event stream and ends the run.
import { readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { protectedHits } from '../../scripts/agent-lib.mjs';

if (process.env.AGENT_UNATTENDED !== '1') process.exit(0);

// Fails closed: this hook only runs in an unattended run, so input it cannot read is refused.
let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.stderr.write('guard-protected could not read the tool input; refusing the edit.\n');
  process.exit(2);
}
const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!file) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const real = (p) => { try { return realpathSync(p); } catch { return p; } };
// A symlink inside the repository that points at a protected file counts as that file.
const path = relative(real(root), real(resolve(root, file))).replaceAll('\\', '/');
if (protectedHits([path]).length) {
  process.stderr.write(`${path} is a protected path: an unattended run never changes it (ADR 0054). The run ends now; if it goes on, change nothing else and make the last line of your last message "STOP: <why this task needs ${path}>".\n`);
  process.exit(2);
}
