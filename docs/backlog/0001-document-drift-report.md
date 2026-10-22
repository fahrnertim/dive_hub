---
title: Document the drift report in the development guide
summary: Add the "Common tasks" row for scripts/drift-report.mjs to docs/development.md and list the first report in the index - the test task for the first unattended run.
status: ready
risk: low
budget_tokens: 1000000
date: 2026-10-23
---

# Document the drift report in the development guide

## Goal
`docs/development.md` has a row in its "Common tasks" table for every script a developer runs, except
`scripts/drift-report.mjs`. Add it, so a person finds the script without knowing it exists. Done: the row is in the
table, next to the row for `scripts/token-report.mjs`, in the same style, and says in one or two sentences what
the script measures, that it writes a dated note to `docs/research/`, and when to run it (weekly, or before moving up
the ladder of ADR 0054). Every link in the row resolves.

## Read first
- The head of `scripts/drift-report.mjs` (its comment says what it measures and how to run it).
- The `token-report.mjs` row in the "Common tasks" table of `docs/development.md` (search for it): the pattern.
- `docs/research/2026-10-23-drift-report.md`: what the script writes.

## Decided
- [ADR 0054](../decisions/0054-unattended-implementation.md): the drift report is part of how the owner decides on
  moving up or down the ladder.
- [ADR 0039](../decisions/0039-working-economically.md): short output. The row is short too.

## State
`main`. The script and the first report exist; nothing else needs to change. This is a documentation-only task, so
no `pnpm check` is needed ([ADR 0023](../decisions/0023-faster-checks.md), amendment of 2026-10-08).

## Open
Where exactly in the table the row goes, if "next to `token-report.mjs`" reads badly.

## Skills to load
None.

## Don't
Change the script, the report or any other row. Touch `docs/decisions/`, `AGENTS.md` or anything outside `docs/`.
