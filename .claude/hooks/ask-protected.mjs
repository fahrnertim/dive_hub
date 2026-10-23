#!/usr/bin/env node
// PreToolUse hook (ADR 0055, 0058): in an interactive session, an edit of the owner's two groups (migrations and
// db/schema.ts, docs/decisions) asks the owner first, also in auto mode and from subagents.
// Unattended runs are left to guard-protected.mjs, which refuses them outright.
// Edits made through a shell command are not seen here, as with guard-protected.mjs.
import { readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { ownerHits } from '../../scripts/agent-lib.mjs';

if (process.env.AGENT_UNATTENDED === '1') process.exit(0);

const ask = (reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason },
  }));
  process.exit(0);
};

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  // Fails towards the owner: input it cannot read is put to them instead of let through.
  ask('ask-protected could not read the tool input, so it cannot tell whether this edit touches a protected path.');
}
const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!file) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const real = (p) => { try { return realpathSync(p); } catch { return p; } };
// A symlink inside the repository that points at a protected file counts as that file.
const path = relative(real(root), real(resolve(root, file))).replaceAll('\\', '/');
if (ownerHits([path]).length) {
  ask(`${path} is one of the owner's protected paths (migrations and schema, ADRs; ADR 0055, 0058). The owner decides this edit.`);
}
