---
title: No second run of tested browser tests - test-only changes run none, and tests run by hand count
summary: pnpm check plans no browser tests for a change under apps/web/e2e/ that isn't a spec (helpers, setup, fixtures; CI runs them), and pnpm check --tests <filter> runs given browser tests the way the check does and records each passed test on its snapshot (refs/check/passed-e2e), so a later pnpm check leaves out every recorded test that the files changed since don't reach through the area map. An ADR 0023 amendment.
status: approved
date: 2026-10-26
---

# No second run of tested browser tests

Design from a brainstorming session with the owner on 2026-10-26, for
[backlog 0007](../../backlog/0007-no-second-run-of-tested-tests.md). "Owner" marks what the owner decided; "my call"
marks what the designer decided and the owner may overturn. Changes the rules of
[ADR 0023](../../decisions/0023-faster-checks.md) (an amendment, below).

## Why

After PR #5, a fix to `apps/web/e2e/support.ts` was verified on the 7 failing tests (both variants). Then `pnpm check`
before the commit ran all ~390 browser tests again (418 s), and CI's `pnpm check:full` on the pull request ran them a
third time. Owner: "We don't need to do a run on already ran tests just because it's the process. That is exactly what
multiplies wait times."

## Goals

1. **Test-only changes run no browser tests locally** (owner). A changed file under `apps/web/e2e/` that isn't a spec
   (`*.spec.ts`) or the review capture (`*.capture.ts`, already none) plans no browser tests: helpers (`support.ts`),
   setup (`prepare.ts`, `global-setup.ts`) and data (`fixtures/**`). Typecheck and lint still run as for any other
   changed file. Whoever changes such a file runs the tests it is for with `--tests`; CI runs the rest.
2. **`pnpm check --tests <filter>`** (owner) runs the given browser tests through the check and records each test that
   passed, on the snapshot it ran on. A later `pnpm check` leaves those tests out of its browser plan, unless a file
   changed since that snapshot reaches them through the area map.

## Non-goals and anti-goals

- No change to CI, `E2E_AXE`, the variants, `E2E_SERVERS`, `scripts/agent-lib.mjs` (owner).
- No retries; CI's `pnpm check:full` stays the only full check and the gate (owner).
- Not "no browser tests before a commit" (owner): product code keeps the area map.
- Anti-goal: a recorded pass that hides a test the map says a later change reaches. The record may only ever leave
  out what the map would also leave out from the snapshot it passed on.

## Design

### Part 1: test-only changes (`planTestSupport` in `scripts/check-lib.mjs`)

- `apps/web/e2e/**` except `*.spec.ts` and `*.capture.ts`: `plan.e2e` is untouched (stays `none` unless another file
  asks for more). One note per file:
  `<path> is browser test setup or data: no browser tests run for it; run the tests it is for with pnpm check --tests <filter> (CI runs them all)`,
  with `steps: ['e2e']`.
- **The six fixture entries in `AREAS`** (`deletable-computer.fit`, `mergeable-(main|backup).fit`,
  `assessed-computer.fit`, `suunto-d5.json`, `account-export.zip`) are removed, so fixtures follow the same rule
  (my call, recommended to the owner: one rule; a fixture change that breaks an unexpected test is caught by CI,
  as with a helper).
- typecheck and lint: unchanged. `planFor` already sets `typecheck` and `lint: 'changed'` before `planTestSupport`.
- A spec changed together with a helper still runs itself: specs are planned by their own path (my call; the backlog's
  open question).
- Unchanged: server test helpers that the e2e server loads (`apps/server/test/…`, `e2eServerLoads`) still run every
  browser test. They are not under `apps/web/e2e/`, and they change what the server does.

### Part 2: `pnpm check --tests <filter>` (`scripts/check.mjs`)

**Arguments.** Every argument after `--tests` goes to Playwright as given: files, `file:line`, `--grep "…"` (my call:
the rest of the command line, so a filter with several parts needs no quoting rules of our own). At least one argument
is required; without one, the script prints a usage line and exits 1. `--tests` can't be combined with `--failed`,
`--full`, `--dry`, `--base` or `--files`; any of them before `--tests` exits 1 with a message.

**How it runs** (my call: "through the check" means the check's local settings):
- `E2E_AXE=once`, as `check.mjs` already sets for every run without `--full`.
- `--grep-invert` as `pnpm check` would set it now: `browserGrepInvert({ full: false, variants })`, where `variants`
  comes from `variantsRun` on the browser step's changed files since its counting base (`countingBase('e2e', tree)`).
  If the filter already contains `--grep-invert`, none is added: the person's choice wins.
- It takes the check lock, takes the snapshot before running (an edit during the run counts as changed next time),
  runs `pnpm --filter @dive-hub/web test:e2e <filter> [--grep-invert …]` with inherited output (like `--failed`), and
  exits with Playwright's status.
- It appends a run-log line: one step `e2e`, `from: '--tests'`, `plan: '<filter as text>'`, `changed: 0`, seconds and
  status; `browserSince` set so the slowest tests are logged.

**What it records.** Only from a JSON report written during the run (`REPORT`'s mtime ≥ start; otherwise nothing is
recorded and one line says why, like `keptFailures`):
- `passedTestsFromReport(report)` (new, pure, in `check-lib.mjs`): each spec whose every test has a last result with
  status `passed` → `{ line, file, tags }`. `line` is the `--test-list` line as `failedTestsFromReport` builds it
  (`<file> › <describe> › … › <title>`). `file` is `spec.file`. `tags` are `spec.tags` with `@` added (the report
  stores them without). Skipped, failed, timed-out and flaky-then-passed tests are not counted. For flaky tests the
  last result is `passed`, so they count (my call: Playwright reports them green too; no retries are configured, so
  this doesn't come up today).
- The record is merged with the one already kept (below), and a status-0 Playwright run is not required: the passed
  tests of a run with failures count too (my call: a failed test simply isn't recorded, so the map still plans it when
  reached). `--tests` changes only `refs/check/passed-e2e`, never the failed-run record (`refs/check/failed-e2e`):
  its ids must keep matching `.last-run.json` for `--failed`, and its owed tests keep their weight in `countingBase`.
  Owed tests become paid only when `pnpm check` plans (Part 3). A `--tests` run overwrites Playwright's `.last-run.json`
  and report, so a `--failed` afterwards reruns the failures of `--tests` and, as today for any other Playwright run in
  between, renews nothing and says "Playwright's last run is not the failed run of pnpm check" (my call: accepted).
- It prints `check: N browser test(s) recorded as passed on these files; pnpm check leaves them out until a change reaches them`.

**The record** (`refs/check/passed-e2e`, beside `refs/check/failed-e2e`): a commit of the snapshot, made like
`recordFailed`, message `e2e: passed by hand` and a JSON body `{ tests: [{ line, file, tags }] }`, sorted by `line`.
New functions in `check-lib.mjs`:
- `recordPassed(tree, tests, cwd)` and `passedRun(cwd)` → `{ tree, base, at, tests }` or null; `clearPassed(cwd)`.
- **Carrying a record forward:** when `--tests` records on snapshot T and a record is kept on S ≠ T, the old tests that
  the files changed from S to T don't reach (`stillPassed`, below) are kept, then this run's passes are added. A test
  that this run ran and that didn't pass is removed. So there is always one record, on the newest snapshot. This keeps
  the passes of an earlier `--tests` across an edit that doesn't touch them.

**Which recorded tests are still good** (`stillPassed(tests, plan)`, new, pure): a recorded test is reached, and so no
longer counts, when the browser plan of the files changed since the record's snapshot
- is `all`, or
- names its spec (`plan.specs` has `basename(file)`), or
- has an area among its tags (`plan.areas` ∩ `tags`).

That plan is `planFor(forBrowserTests(changedSince(S, T), S, T).changed, { e2eServerLoads })`, the same map
`pnpm check` uses. The variant leave-out is not part of "reached": a recorded variant test is its own test-list line
(its describe names the variant), so it is only ever left out of a plan that would run that same line.

### Part 3: `pnpm check` uses the record (`browserSteps` in `check.mjs`)

Only when the run records (`records`: no `--dry`, `--files`, `--base`; and not `--full`), as for owed tests:
1. Base and plan: unchanged (`countingBase`, `planSteps`). The record doesn't change the base's score (my call: the
   score counts files; the record works on tests after the plan is made).
2. `credited = stillPassed(passedRun().tests, planFor(changes since the record's snapshot))`. If `credited` is empty,
   everything behaves as today.
3. If `credited` isn't empty and the browser step would run anything (plan or owed): the step takes the test-list path
   (`browserOwedStep`, renamed `browserListStep`). The lines are `browserTestList({ all, planned, owed })` minus the
   credited lines. Owed tests that are credited count as paid (my call: they passed by hand on files the fix didn't
   reach since). One line says
   `check: N browser test(s) passed by hand on <at> (pnpm check --tests) and not reached since; not run again`.
4. If nothing is left to run, it's the same as today's "nothing to run": clear the failed record and record the step
   green on this snapshot.
5. **A green browser step clears the record** (`clearPassed`), wherever `recordGreen('e2e', …)` happens in a run that
   records: a passing step, a step not planned (the loop that records unplanned steps green, also in a docs-only or
   quiet run), the list path with nothing left, and a passing `--failed` that renews. Nothing is lost: once the step is
   green on T, a later check plans only tests reached from T, and a recorded test not reached from T would not be
   planned anyway. A failed step keeps the record.
6. `--dry` reads the record and prints how many recorded tests would be left out, without listing (my call: reading is
   cheap; listing takes seconds, and `--dry` today doesn't list). With `--files`, `--base` or `--full` the record is
   neither used nor shown, as for owed tests.

### PR #5 replayed

Change `apps/web/e2e/support.ts` only, then `pnpm check --tests ui-quality.spec.ts:…`, then `pnpm check`. The plan has
typecheck and lint, and no browser tests (Part 1 alone already gives this). The browser step, not planned, records
green on this snapshot and so clears the record from `--tests`.

## Tests (in `scripts/check-lib.test.mjs`, test-first)

- `planFor(['apps/web/e2e/support.ts'])`: `e2e: 'none'`, `typecheck: true`, the note. The same for `prepare.ts`,
  `global-setup.ts`, `fixtures/mergeable-main.fit`. With a spec beside it, that spec is planned.
- Replay of PR #5 (`planSteps` with only `support.ts` changed for every step): no browser tests.
- `passedTestsFromReport`: passed counted; failed, timed-out and skipped not; tags get `@`; lines as
  `failedTestsFromReport`.
- `stillPassed`: plan `all` → none; spec named → its tests out; area hit → tagged tests out; unrelated change → all kept.
- `recordPassed`/`passedRun`/`clearPassed` in a temporary repository (as the failed-record tests do), and the carry-over
  across two snapshots.
- The list arithmetic: planned + owed − credited (extend or wrap `browserTestList`; a pure function).

Existing tests that expect a fixture to plan `@dives`, or `support.ts` to plan everything, change with the amendment.

## Documents

- **ADR 0023 amendment** (protected path: the owner approves the text), appended after the amendment "2026-10-26: a
  rerun after a fix, …"; the heading's title tells the two of 2026-10-26 apart. In code comments it is "the amendment
  of 2026-10-26 (no second run)". Draft:
  > ## Amendment 2026-10-26: no second run of tested browser tests
  > Why: the owner, 2026-10-26, after PR #5: a helper fix verified on its 7 tests was followed by all ~390 browser tests
  > in `pnpm check` (418 s) and again in CI. Decided with the owner; [design](../superpowers/specs/2026-10-26-check-credit-by-hand-design.md).
  > - **Browser test setup and data run no browser tests locally.** A changed file under `apps/web/e2e/` that isn't a
  >   spec (helpers, setup, fixtures) plans none; typecheck and lint run. Whoever changes it runs the tests it is for
  >   with `--tests`; CI runs them all. This replaces, in the amendment of 2026-10-24, "Browser test setup and data
  >   (`apps/web/e2e/`, not specs) run every browser test", and the fixtures' entries in the area map go.
  > - **`pnpm check --tests <filter>`** runs the given browser tests as `pnpm check` would (axe once, the same variants
  >   left out) and records each passed test on its snapshot (`refs/check/passed-e2e`). `pnpm check` leaves out every
  >   recorded test that the files changed since don't reach through the map (all browser tests, its spec or one of its
  >   areas); owed tests among them count as paid. A green browser step clears the record.
  > - *What is given up:* a helper or fixture change that breaks a test its author didn't run is found by CI, not
  >   before the push.
- **AGENTS.md**, Checks bullet: add "a change to browser test helpers runs no browser tests; `pnpm check --tests <filter>`
  runs the tests it is for and records them".
- **docs/development.md**, "Checks while working": the same two sentences.
- **Backlog 0007**: `status: done` once the PR is open.

## Left to the builder

- Function names and where the list arithmetic lives.
- The exact wording of output lines, in the style of the existing ones.
- Whether `check.mjs`'s `--tests` branch lives in a function like `--failed` or in its own small module (the module
  rules of ADR 0053 don't cover `scripts/`).
