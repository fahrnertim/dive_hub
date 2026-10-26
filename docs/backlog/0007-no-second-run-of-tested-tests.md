---
title: Don't run browser tests again that already passed, or that only test code reaches
summary: pnpm check runs no browser tests for a change to browser test setup or helpers (CI runs them), and pnpm check --tests <filter> runs given browser tests through the check and records them as passed, so a later check plans only what is left; an ADR 0023 amendment.
status: done
risk: medium
date: 2026-10-26
---

# Don't run browser tests again that already passed, or that only test code reaches

Asked by the owner on 2026-10-26, after PR #5: a fix to `apps/web/e2e/support.ts` was verified on the 7 failing tests
(both variants), and `pnpm check` before the commit then ran all ~390 browser tests again (418 s), although CI's
`pnpm check:full` on the pull request runs them anyway. "We don't need to do a run on already ran tests just because
it's the process. That is exactly what multiplies wait times."

## Goal
- **Test-only changes run no browser tests locally.** A change to browser test setup or helpers (`apps/web/e2e/`, not
  a spec file) plans no browser tests in `pnpm check`; typecheck and lint still run. Whoever changes a helper runs the
  tests it is for by hand (below); CI runs the rest. Product code keeps the area map.
- **`pnpm check --tests <filter>`** runs the given browser tests through the check (a Playwright filter: files, lines,
  `--grep`) and records them as passed on the snapshot they ran on. A later `pnpm check` on the same files plans the
  browser step without them; a changed file the map reaches plans them again.
- An amendment to [ADR 0023](../decisions/0023-faster-checks.md) (protected path: the owner approves it), AGENTS.md's
  Checks bullet and [development.md](../development.md) say both.
- Done: the two cases above as tests in `scripts/check-lib.test.mjs`; replaying the PR #5 case (a change to
  `e2e/support.ts`, its tests run with `--tests`) plans no browser tests.

## Read first
- [ADR 0023](../decisions/0023-faster-checks.md) in full, above all the amendments of 2026-10-24 (browser test setup
  runs every browser test; a passing `--failed` renews the record) and 2026-10-26 (a failed run is a base; owed tests).
- `scripts/check-lib.mjs`: the path map, `chooseBase`, `recordFailed`, `failedRun`; `scripts/check.mjs`: `--failed`.
- [check escapes](../agents/check-escapes.md): the entry of 2026-10-26 is the case that led here.

## Decided
- Owner, 2026-10-26: both parts above (option "also credit runs by hand"); not "no browser tests before a commit".
- No retries; CI's `pnpm check:full` stays the only full check and the gate (ADR 0023).

## State
- Base `main` after PR #5 (faster local check) is merged: it adds the failed-run record and Playwright's JSON report
  (`apps/web/test-results/report.json`), which a per-test record can build on.

## Open
- How the per-test record is kept (beside `refs/check/failed-e2e`, keyed by snapshot) and how it combines with a
  failed run and the green record.
- Whether a spec file changed together with a helper still runs itself (likely yes).

## Skills to load
- `superpowers:brainstorming`, then `superpowers:writing-plans`; read each override in
  [docs/skills.md](../skills.md#overrides) first.

## Don't
- Change CI, `E2E_AXE`, the variants or `E2E_SERVERS`; touch `scripts/agent-lib.mjs`.
