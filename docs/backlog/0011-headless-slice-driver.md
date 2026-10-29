---
title: A local driver that runs desloppify slices headless, one fresh session each, through usage limits
summary: A script that loops claude -p over hand-over prompts (one desloppify queue item per session), waits out a usage limit and resumes the interrupted slice; built with the owner present, since it touches the agent harness.
status: draft
risk: medium
date: 2026-10-30
---

# A local driver that runs desloppify slices headless

## Goal
The owner can start the desloppify cleanup in the evening and find it worked through overnight, each slice in a fresh
session, without a window that must stay open. Today a session orchestrates subagents, which stops at a usage limit (the
5-hour window) and when the window closes.

Done:
- A local script (for example `scripts/slice-run.mjs`) runs `claude -p "<hand-over>"` in a loop. Each session does one
  queue item: `python -m desloppify next`, fix it, `pnpm check`, commit, `plan resolve`, `plan commit-log record`. It ends by
  writing the next hand-over prompt to a file the script reads for the next round.
- **Usage limit:** the script detects that a session ended on the limit (exit code plus the message, or the result in
  `--output-format json`/`stream-json`), waits until the reset time if the output gives one, otherwise backs off (for example 30 min)
  and retries, then resumes the **same** slice.
- **Resuming is idempotent:** a session starts from `git status` and the desloppify state. It finishes or reverts a
  half-done change, records a commit that was made but not recorded, and never commits on a red check.
- **Stops:** the queue is empty; N slices in a row ended without a commit; the token budget for the night is spent; a protected
  path is needed. On a stop, the script writes a morning summary (commits, rulings, skipped items, next hand-over).
- Headless permissions: the run never waits on a prompt. The allowlist it needs is in the committed project settings, as narrow as
  works, and is documented.
- Tested with the owner present: one slice, one forced limit (or a simulated one through `AGENT_CLAUDE_BIN`, as
  `agent-run.mjs` allows), one resume after a half-done slice.

## Read first
- `scripts/agent-run.mjs`: how it starts `claude -p` with `stream-json` and enforces stops on the event stream. Reuse it, don't copy it.
- `scripts/agent-lib.mjs` (protected): the `PROTECTED` list and the budget weighting.
- [ADR 0054](../decisions/0054-unattended-implementation.md): stops, protected paths, budgets, and the ladder this sits on.
- [docs/agents/working-economically.md](../agents/working-economically.md): the hand-over prompt.
- [docs/skills.md](../skills.md): the desloppify row and its override.
- The Claude Code docs for headless mode (`-p`, `--output-format`, permission modes) and what a usage-limit exit looks like. Verify this; don't assume it.

## Decided
- One slice, one session ([ADR 0039](../decisions/0039-working-economically.md)).
- Desloppify's loop doesn't replace our checks: `pnpm check` before each commit, no baseline growth ([docs/skills.md](../skills.md) override).
- No push from the loop. The owner pushes and opens the PR.

## State
`main`, or the cleanup branch it serves. The orchestrated-subagent variant (one session spawning a fresh subagent per slice) works
today, but it dies at a usage limit. The limit message format and whether it carries the reset time are not yet verified.

## Open
- A new script, or a mode of `agent-run.mjs` (it runs one backlog task per run; this one runs many slices on one branch).
- Whether this needs an ADR 0054 amendment (local loop next to the Actions workflow) or its own ADR.
- How the next hand-over is passed: a file in the scratchpad (ephemeral), or a committed state the script derives from `desloppify next`.

## Skills to load
karpathy-guidelines, desloppify, pnpm. Read each override in [docs/skills.md](../skills.md#overrides) first.

## Don't
Run unattended: this task touches the agent harness (protected paths), so it is built in a session with the owner. No cloud
routine, no push, no change to the desloppify tool itself.
