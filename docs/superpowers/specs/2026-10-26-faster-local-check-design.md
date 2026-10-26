---
title: A faster local check - rerun after a fix, steps side by side, and a run log
summary: Measured 2026-10-26, the browser tests are 2.6 s each (not 7.3 s) and a pnpm check that plans everything takes about 9 minutes; the owner's ~20 minutes come from how often the check runs, from steps running one after another and from unexplained slow days. So pnpm check counts the browser step from a failed run (the failed tests plus what the fix touched), runs the browser step beside the other steps and lets every step finish, and writes a local run log with pnpm check:log. Target 5 minutes per local check. ui-quality, axe, workers and variants stay as they are.
status: approved
date: 2026-10-26
---

# A faster local check: rerun after a fix, steps side by side, and a run log

Design from a brainstorming session with the owner on 2026-10-26, for [backlog 0004](../../backlog/0004-coverage-based-test-selection.md),
step 1 of the ranking in the [testing strategies research](../../research/2026-10-26-testing-strategies.md). "Owner"
marks what the owner decided; "my call" marks what the designer decided and the owner may overturn. Changes the rules of
[ADR 0023](../../decisions/0023-faster-checks.md): see its [amendment of 2026-10-26](../../decisions/0023-faster-checks.md#amendment-2026-10-26-a-rerun-after-a-fix-steps-side-by-side-and-a-run-log).

## Why
The owner, 2026-10-26: a check takes almost 20 minutes and runs several times per feature, "way too much for probably
10 minutes of implementation". A failed test is rerun until it passes, then the whole suite runs again, and that happens
for each task of a feature. **Target (owner): a local `pnpm check` of about 5 minutes.**

## What was measured (2026-10-26)
Owner's laptop (i7-12700H, 20 threads, Windows 11, plugged in, power plan "Ultimate"), branch
`testing-strategies-research` at 6624f7e, browser tests on Edge, `E2E_AXE=once` unless said otherwise. The raw reports
were working files; the numbers are kept here.

| Run | Wall | Worker time | Result |
|---|---|---|---|
| 1. ui-quality as `pnpm check` runs it (English variant and "behaviour", 108 tests) | 210 s | 236 s, 2.2 s a test | all passed |
| 2. The same with axe at every page check | 191 s | 269 s (+33 s) | 2 failed: axe `color-contrast` on intermediate pages (below) |
| 3. The whole local browser plan (`--grep-invert "@full\|@variants"`, 229 tests) | 334 s | 589 s, 2.6 s a test | all passed |
| 4. Run 3 with the owner's dev servers running (`pnpm dev`) | 339 s | 597 s | all passed |
| 5. Run 3 on 4 workers (`E2E_SERVERS=4`) | 284 s | 906 s, each test 1.6× slower | all passed, no timeouts |
| 6. Run 3 while typecheck, lint and server tests run beside it | 443 s for everything | 766 s | all passed |

The other steps, run on everything and one after another: typecheck 11 s, lint 67 s (8 s with ESLint's cache warm),
check script tests 10 s, server tests 123 s (217 s beside the browser tests), web unit tests 3 s. **A `pnpm check` that
plans everything takes about 550 s one step after another, 443 s side by side.**

What this says:
- **The 7.3 s a test of 2026-10-24 does not reproduce**: today it is 2.6 s, and the same ui-quality tests take the same
  time alone or among the other spec files (ratio 1.0–1.1 over the whole run). Idle dev servers don't explain it. What
  made 2026-10-24 three times slower is unknown, and the check keeps no record that could say.
- **ui-quality is 42 % of the browser worker time (249 of 589 s), not 60 %, and axe is not the bottleneck**: axe at
  every page check instead of once costs 33 s. Cutting more axe passes would save little and lose checks.
- **So the time goes to how often the check runs** (a fix reruns the whole plan; every task commit checks again),
  **to steps waiting for each other**, and to slow days nobody can explain.
- *Not measured:* where a test's 2.6 s go (setup, navigation, waits; traces were planned but no longer worth it), and
  the German, dark, phone variant (`@variants`, 57 tests; at today's speed about 140 s of worker time).

**Found while measuring:** run 2 failed twice on axe `color-contrast`, on pages a test passes through and `E2E_AXE=once`
never checks locally: the link "Add body weight on the Divers page" on the lead calculator (`ui-quality.spec.ts:289`) and
the link "Show them" on the Review page (`:919`). Either real contrast faults that CI should catch, or axe catching a
transition. Not part of this design: a backlog task, if the owner wants one.

## Goals
1. **A rerun after a fix runs what failed and what the fix touched**, not the whole plan again.
2. **The steps run side by side**: the browser step beside the others, and every step runs to its end.
3. **A run log** says what each `pnpm check` cost, so slow days can be explained and the 5-minute target checked.

## Non-goals
- Shrinking ui-quality or cutting axe passes (owner, 2026-10-26, after the measurements). Workers stay 2, axe stays once
  per ui-quality test locally, the variants stay as the amendment of 2026-10-24 set them.
- Selection by coverage, the coverage map and the "test inside another test" report (later steps of 0004).
- A rerun after a fix for the server step (my call: the browser step first; the server step gets the same if the log
  shows its reruns matter).
- Changing CI's gate: CI's `pnpm check:full` stays the only full check, retries stay rejected (ADR 0023).

## Anti-goals
- A check that is faster because it checks less without saying so. Every narrowing has to be one the area map already
  trusts, and the output says what it planned and from which base.
- A flaky test hidden: a test that failed must pass again before the step is green.

## Part 1: a rerun after a fix counts from the failed run
Today a failed browser step keeps its snapshot and failed tests (`refs/check/failed-e2e`), but they only help when no
file changed (`pnpm check --failed`). A fix always changes a file, so the next check counts from the older green record
and runs the whole plan again.

**The design:** a kept failed run of the browser step is a base for counting, like a green record, with its failed
tests owed.
- On the failed snapshot, every test of the failed run's plan passed except the failed ones; tests outside the plan
  were green there because the map says the changes didn't touch them. So the snapshot is green except for the failed
  tests.
- The next `pnpm check` plans the browser step as **the failed tests plus what the area map picks for the files changed
  since the failed snapshot** (texts mapped to the files that use them, `@variants` by the same rules as today).
- **The failed run is a candidate base among the others** (green record, `main`, `origin/main`). It is counted with its
  failed tests owed; the choice keeps the rule "the base that leaves the fewest changed files", the failed tests counting
  on top (my call; the builder may refine the score, but never choose a base that drops owed failed tests).
- **Why this holds whatever base the failed run counted from:** a failed run that counted from `main` trusts main as
  green, as every base from main already does (amendment of 2026-10-24); one that counted from an earlier failed run had
  that run's owed tests in its plan. So no failed run needs to remember its own base: after any run, the snapshot is
  green except for the tests that failed in that run.
- **When the browser step passes** on the new snapshot, it records green and forgets the failed run, as today.
  **When it fails again**, the new failed run replaces the old one, its failed tests being those that failed now (owed
  tests that passed now are settled).
- **An owed test that no longer exists** (the fix deleted or renamed it) is dropped from the plan, and the output says
  so (my call): a deleted test can't fail, and a renamed one sits in a changed spec file, which runs itself. Owed tests
  are matched against Playwright's `--list` before the run, so an empty match never reaches Playwright.
- **A browser step that fails without a fresh report** (the build fails, a server doesn't start, Ctrl-C) forgets the
  failed run, as today: the next check counts from the green record and runs more, never less (my call).
- **Only the browser step** has a failed-run base; `pnpm check --failed` still runs only the failed browser tests and no
  other step.
- **The guards stay:** a failed run is kept only from a report Playwright wrote during the step, with status failed and
  a list, without `maxFailures`, and only from a run that records (not `--base`, `--files`, `--dry`).
- **`pnpm check --failed` keeps working** (same files: only the failed tests). The guidance in AGENTS.md and
  development.md becomes "after a fix, run `pnpm check`".
- The output names the base: "the failed run of <date> (N failed test(s) owed)".

Left to the builder: how Playwright runs "these failed tests plus these tags" in one invocation (one server start).
Candidates: Playwright's `--test-list` file (check the installed version), or a `--grep` built from the failed tests'
titles out of the JSON report. Two invocations (cost: a second server start, about 20 s) only if neither works.

## Part 2: the steps side by side, and every step runs to its end
**The design (my call on the lanes):**
- **Two lanes.** Lane A: the browser test tags check, then the browser step (build, servers, tests). Lane B, one after
  another: typecheck, lint, check script tests, server tests, web unit tests. Both start at once.
- **Every step runs to its end (owner, 2026-10-26)**: a failing step no longer stops the others, also in its own lane.
  A failure prints as soon as its step ends; the summary at the end lists every step's time and every failure.
  Each passing step records green as today; each failed browser step keeps its failed run (Part 1).
- This replaces, from the amendment of 2026-10-08, "the failed step and those after it count from their older records":
  only the failed steps do.
- **Output:** each step's output goes to a file under `node_modules/.cache/check/` (my call: ignored, per clone) and is
  printed when the step fails; a passing step prints its one summary line ([ADR 0039](../../decisions/0039-working-economically.md):
  only problems). The pre-commit hook's output follows the same rule.
- **CI:** `pnpm check:full` runs the steps one after another when `CI` is set (my call: a GitHub runner has few cores,
  and CI time is not the problem); every step still runs to its end there.
- Ctrl-C stops both lanes and records nothing for unfinished steps.
- **One check at a time per clone** (my call): the browser servers' ports (3300+), `test-results/` and the step output
  files are shared, which was already true before this design. A second `pnpm check` (the pre-commit hook while a
  check by hand still runs) stops at once with "another pnpm check is running (pid N)", from a lock file beside the run
  log that a dead process doesn't hold.
- Measured: 550 s → 443 s for a check that plans everything; the browser tests were about 1.3× slower each beside the
  server tests, with no timeouts (expectations wait 10 s).

## Part 3: the run log
**The design (my calls, agreed by the owner):**
- Every `pnpm check` that runs steps appends one JSON line to `check-runs.jsonl` in git's common directory
  (`git rev-parse --git-common-dir`, so a worktree would share it; worktrees are declined for now anyway): per clone,
  never committed, like the green records (Rule #1: raw machine data, not project knowledge). A detached `HEAD` is
  logged as its commit with no branch.
- A line holds: start time, branch, `HEAD`, who started it (the pre-commit hook or a person; the hook sets an
  environment variable), the arguments (`--full`, `--failed`, …), per step the base it counted from (green run, failed
  run, `main`), the number of changed files, the plan (all, or the tags / number of test files), its time and result,
  and the run's wall time.
- The browser step adds its worker time, number of tests, failed tests and the five slowest tests, from a JSON report
  Playwright writes beside the list output (`test-results/report.json`).
- **`pnpm check:log`** prints the last runs (default 20) and a sum per branch: runs, failures, total wall time, so "what
  did this feature cost in checks" has an answer. `--branch <name>` narrows it.
- What the log teaches (a slow day explained, the target met or missed) goes into `docs/` as usual; the log itself stays
  local. CI doesn't write it.

## Constraints
- [ADR 0023](../../decisions/0023-faster-checks.md) with its amendments; this design's amendment of 2026-10-26 changes it.
- [ADR 0039](../../decisions/0039-working-economically.md): only problems are printed.
- [ADR 0053](../../decisions/0053-module-boundaries.md) and the lint baselines: `scripts/check.mjs` and
  `check-lib.mjs` get no new suppressions; new planning logic goes into `check-lib.mjs` with tests in
  `check-lib.test.mjs` (tests first).
- Windows: the check runs in Git Bash, PowerShell and the git hook; command lines stay under ~8000 characters.
- No test or spec file changes for this design, except a Playwright reporter in `playwright.config.ts`.

## How we'll know it worked
- The plan ends with a measurement: a check that plans everything (target ≈ 443 s), and a fix-and-rerun of one failed
  browser test (target: the failed test plus the fix's areas, well under a minute of browser tests).
- After a week of slices the run log says the median wall time of a `pnpm check` and the sum per feature; that goes into
  a short note in `docs/research/` and decides whether the next step of 0004 (or 4 workers, 15 % faster but contended)
  is needed for the 5 minutes.
