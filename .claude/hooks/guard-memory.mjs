#!/usr/bin/env node
// PreToolUse hook: enforces ADR 0001 (all project knowledge lives in this repo).
// Blocks writes to agent memory locations outside the repository.
// Exit code 2 + stderr = block the tool call (stderr is shown to the agent).

import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const tool = input.tool_name;
const ti = input.tool_input ?? {};

// Paths that hold per-user / per-machine agent memory.
const FORBIDDEN = [
  /[\\/]\.claude[\\/]projects[\\/][^\\/]+[\\/]memory([\\/]|$)/i, // auto memory
  /[\\/]\.claude[\\/]CLAUDE\.md$/i,                               // user-level CLAUDE.md
  /(^|[\\/])CLAUDE\.local\.md$/i,                                 // local-only project memory
];
const FORBIDDEN_IN_COMMAND = [
  /\.claude[\\/]projects[\\/][^\s"']*memory/i,
  /~[\\/]\.claude[\\/]CLAUDE\.md/i,
  /CLAUDE\.local\.md/i,
];
// Read-only commands are allowed to inspect these locations (e.g. to verify they're empty).
const READ_ONLY = /^\s*(ls|dir|cat|type|head|tail|test|stat|Get-ChildItem|Get-Content|Test-Path)\b/i;

function block(reason) {
  process.stderr.write(
    `Blocked by .claude/hooks/guard-memory.mjs: ${reason}\n` +
      "All project knowledge must be written to files in this repository (see AGENTS.md, ADR 0001).\n"
  );
  process.exit(2);
}

if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
  const p = ti.file_path ?? ti.notebook_path ?? "";
  if (FORBIDDEN.some((re) => re.test(p))) block(`${tool} to ${p}`);
} else if (["Bash", "PowerShell"].includes(tool)) {
  const cmd = ti.command ?? "";
  if (!READ_ONLY.test(cmd) && FORBIDDEN_IN_COMMAND.some((re) => re.test(cmd))) {
    block(`${tool} command touching a memory location`);
  }
}

process.exit(0);
