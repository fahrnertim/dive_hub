---
title: A faster local check - implementation plan
summary: Eight tasks: Playwright's JSON report and failed tests by title, a failed browser run as a base, one test list for "failed plus areas", the check using it, two lanes where every step runs to its end, one check at a time, the run log with pnpm check:log, and docs plus a closing measurement.
status: approved
date: 2026-10-26
---

# A faster local check: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm check` reruns only the failed browser tests plus what a fix touched, runs the browser step beside the other steps with every step running to its end, and logs every run locally.

**Architecture:** Planning stays in `scripts/check-lib.mjs` (pure functions and git records, tested with Node's test
runner). Running moves into a new `scripts/check-run.mjs` (lanes, lock, step output files), and the log into a new
`scripts/check-log.mjs` (append, summarise, `pnpm check:log`). `scripts/check.mjs` wires them together.

**Tech Stack:** Node 24 ESM scripts, `node:test`, git plumbing (`commit-tree`, `update-ref`), Playwright 1.63
(`--list`, `--test-list`, JSON reporter), pnpm.

**Spec:** [docs/superpowers/specs/2026-10-26-faster-local-check-design.md](../specs/2026-10-26-faster-local-check-design.md)

## Global Constraints

- ADR 0023 with all amendments, including the amendment of 2026-10-26 this plan implements. CI's `pnpm check:full` stays the only full check; no retries.
- ADR 0039: only problems are printed; a passing step prints one summary line.
- ADR 0053 and the lint gates: no new ESLint suppressions or dependency-cruiser exceptions; `sonarjs/cognitive-complexity` 15 holds, so split `check.mjs` logic into functions rather than growing its top level.
- Tests first: every new function in `check-lib.mjs`, `check-run.mjs`, `check-log.mjs` gets its `node:test` test before its code.
- `pnpm`, never `npm`. Windows command lines stay under ~8000 characters (pass long lists through files).
- Never touch `scripts/agent-lib.mjs` (protected, ADR 0054). Edits under `docs/decisions/` ask the owner.
- No change to any spec file or e2e helper; the only Playwright change is the reporter in `apps/web/playwright.config.ts`.
- Unchanged: `E2E_SERVERS` 2, `E2E_AXE=once` locally, the variant tags, the green records `refs/check/green-<step>`.
- `pnpm check` before each commit (the pre-commit hook runs it). This plan changes the check itself; if a task leaves
  the check unable to run, fix it within that task.

## Review Focus

1. **Ctrl-C while both lanes run**: every child process tree stops (Windows: `taskkill /T /F`), no step is recorded green or failed, the lock is released, the log line says `interrupted`. Test in Task 5.
2. **Test titles with curly quotes, `›`, `%` and `'`** (ui-quality has "a diver’s certifications"): a failed test's title must round-trip through the record and `--test-list` exactly. Test in Task 1.
3. **A failed run kept, then a branch switch**: the failed run is only a candidate; a base with fewer changed files plus owed tests wins, and nothing is dropped silently. Test in Task 2.
4. **A lock left by a crashed check**: a lock whose pid no longer runs is taken over. Test in Task 6.
5. **The log can't be written** (read-only `.git`, disk full): the check's result and exit code are unchanged; one line says the log was skipped. Test in Task 7.

---

### Task 1: Playwright's JSON report, and failed tests recorded by title

**Files:**
- Modify: `apps/web/playwright.config.ts` (reporter), `scripts/check-lib.mjs` (`recordFailed`, `failedRun`, new `failedTestsFromReport`), `scripts/check.mjs` (where `recordFailed` is called)
- Test: `scripts/check-lib.test.mjs`

**Interfaces:**
- Produces: `REPORT = 'apps/web/test-results/report.json'` (exported from `check-lib.mjs`); `failedTestsFromReport(report: object) -> string[]` (test-list lines of the tests whose last result is `failed` or `timedOut`); `recordFailed(step, tree, { ids: string[], tests: string[] }, cwd)`; `failedRun(step, cwd) -> { tree, base, at, failedTests: string[] /* ids */, owed: string[] /* test-list lines */ } | null`. A record in the old format (a bare JSON array) reads as `owed: []`.

- [ ] **Step 1: Probe the `--test-list` line format.** Run `pnpm --filter @dive-hub/web exec playwright test --list e2e/navigation.spec.ts` and write one listed test into a scratch file in the form the [docs](https://playwright.dev/docs/test-cli) give (`<file relative to testDir> › <describe> › <title>`). Run `... playwright test --list --test-list <scratch file>`. Expected: `Total: 1 test`. Note in the test file's comment whether tags appear in the line (they must not, if `--test-list` doesn't match them).
- [ ] **Step 2: Write the failing tests**
  - `'a failed browser run keeps its failed tests by id and by title, and an old record still reads'`: `recordFailed('e2e', tree, { ids: ['b-id', 'a-id'], tests: ['ui-quality.spec.ts › English, light, desktop › Divers, a diver’s certifications'] })` → `failedRun` deep-equals `{ tree, base: <40 hex>, at: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, failedTests: ['a-id', 'b-id'], owed: [that line] }`; a ref written with the old body `["a-id"]` gives `owed: []`.
  - `'the failed tests of a report are named as test-list lines, curly quotes and all'`: a hand-built report object (`suites` → `suites` → `specs` with `file`, `title`, `tests[].results[].status`) with one passed, one failed and one timed-out test under a describe `English, light, desktop` → the two lines `'<file> › English, light, desktop › <title>'`, titles with `’`, `›`-free, `%` and `'` unchanged.
  - Update the existing test `'a failed browser run is kept with its snapshot…'` to the new argument shape.
- [ ] **Step 3: Run them to see them fail.** Run: `node --test scripts/check-lib.test.mjs`. Expected: the new tests fail (`failedTestsFromReport` is not exported).
- [ ] **Step 4: Implement.** Reporter in `playwright.config.ts`: `[['list'], ['json', { outputFile: 'test-results/report.json' }]]`. The ref body becomes `JSON.stringify({ ids, tests })`, sorted; `failedRun` adds `base` (the ref's commit) and `at` (its date, the format `greenRun` uses). In `check.mjs`, where a failed browser step is kept, read `REPORT` (only if written after the step started, like `.last-run.json`) and pass `{ ids: kept.failedTests, tests: failedTestsFromReport(report) }`; with no fresh report, keep nothing (as today).
- [ ] **Step 5: Run the tests.** `node --test scripts/check-lib.test.mjs` → all pass. `pnpm check` → green.
- [ ] **Step 6: Commit.** `git commit -m "Check script: Playwright's JSON report; a failed browser run keeps its failed tests by title"`

### Task 2: A failed browser run as a base for counting

**Files:**
- Modify: `scripts/check-lib.mjs` (`baseCandidates`, `chooseBase`, `countingBase`)
- Test: `scripts/check-lib.test.mjs`

**Interfaces:**
- Consumes: `failedRun` (Task 1).
- Produces: candidates `{ from, base, owed? }`; for `e2e` a kept failed run comes first: `{ from: 'the failed run of <at> (<n> failed test(s) owed)', base, owed }`. `chooseBase` scores `changed.length + (owed?.length ?? 0)`, a tie keeps the earlier candidate. `countingBase(step, tree, cwd) -> { from, base, changed, owed: string[] }` (`owed` is `[]` unless the failed run won).

- [ ] **Step 1: Write the failing tests**
  - `'after a failed browser run and a fix, the browser step counts from the failed run with its failed tests owed'`: repo, record green on S0, edit `a.ts`, `recordFailed('e2e', S1, { ids: ['x'], tests: ['t › one'] })`, edit `b.ts` → `countingBase('e2e', S2)` has `changed: ['b.ts']`, `owed: ['t › one']`, `from` matching `/^the failed run of .+ \(1 failed test\(s\) owed\)$/`.
  - `'only the browser step counts from a failed run'`: same repo → `countingBase('server', S2).owed` is `[]` and its `from` is the green run.
  - `'a failed run loses to a base with fewer changed files and owed tests together'` (Review Focus 3): failed run on S1 with 3 owed tests, then the working tree changed back to S0 (green) → the green run wins with `changed: []`.
- [ ] **Step 2: Run them to see them fail.** `node --test scripts/check-lib.test.mjs` → the three fail.
- [ ] **Step 3: Implement** the candidate in `baseCandidates` (only when `step === 'e2e'` and `failedRun` returns one with `owed.length > 0`) and the score in `chooseBase`; update `chooseBase`'s doc comment and the existing tie test if its expectation names the order.
- [ ] **Step 4: Run the tests.** All pass; `pnpm check` green.
- [ ] **Step 5: Commit.** `git commit -m "Check script: a failed browser run is a base for counting, its failed tests owed"`

### Task 3: One test list for "the failed tests plus the planned areas"

**Files:**
- Modify: `scripts/check-lib.mjs` (new `listedTests`, `browserTestList`)
- Test: `scripts/check-lib.test.mjs`

**Interfaces:**
- Produces: `listedTests(stdout: string) -> string[]` (Playwright `--list` output → test-list lines, in the format Task 1's probe fixed); `browserTestList({ all: string[], planned: string[], owed: string[] }) -> { lines: string[], dropped: string[] }` where `lines` = `planned` ∪ (`owed` ∩ `all`), order of `all`, no duplicates; `dropped` = `owed` not in `all`.

- [ ] **Step 1: Write the failing tests**
  - `'a Playwright listing becomes test-list lines'`: a captured `--list` text with the `Listing tests:` header, two lines like `  [e2e] › ui-quality.spec.ts:91:5 › English, light, desktop › logbook @dives` and the `Total: 2 tests in 1 file` footer → the two lines without project, position and tags.
  - `'the test list is the planned tests plus the owed ones that still exist'`: `all` [a, b, c, d], `planned` [b], `owed` [d, gone] → `{ lines: [b, d], dropped: [gone] }`; owed already planned appears once.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement** both functions.
- [ ] **Step 4: Run the tests.** All pass.
- [ ] **Step 5: Commit.** `git commit -m "Check script: the browser test list of failed tests plus planned areas"`

### Task 4: The check runs the browser step from a failed run

**Files:**
- Modify: `scripts/check.mjs` (browser step command when `since.e2e.owed.length > 0`)

**Interfaces:**
- Consumes: `countingBase` with `owed` (Task 2), `listedTests`, `browserTestList` (Task 3).
- Produces: when owed tests exist, the browser step runs `pnpm --filter @dive-hub/web test:e2e --test-list <abs path>` with the list written to `node_modules/.cache/check/e2e-tests.txt`; the step's name reads `browser tests (N failed test(s) owed + <areas or "none">)`; each dropped test prints `check: <line> no longer exists; dropped from the owed tests`.

- [ ] **Step 1: Implement.** Get `all` from `playwright test --project=e2e --list` (no filters) and `planned` from the same with the step's `--grep`/`--grep-invert` (skip the second call when the plan is `none`: `planned = []`; when `all`, only `--grep-invert`). If `lines` is empty (every owed test dropped, nothing planned), the step records green and says so. `pnpm check --failed` stays unchanged.
- [ ] **Step 2: Try it by hand.** In the source of one `@tools` page under `apps/web/src/` (find it in the path map in `check-lib.mjs`) change its h1 text so one ui-quality test fails; `pnpm check` → the browser step fails, "pnpm check: failed run kept" shows. Change it back; `pnpm check --dry` → the base reads `the failed run of … (N failed test(s) owed)` and the step lists the owed count plus `@tools`/`@layout`. `pnpm check` → only those run, green, and `git for-each-ref refs/check` shows `failed-e2e` gone. Note the browser step's time for Task 8.
- [ ] **Step 3: Commit.** `git commit -m "Check script: after a fix the browser step runs the failed tests plus what the fix touched"`

### Task 5: Two lanes, and every step runs to its end

**Files:**
- Create: `scripts/check-run.mjs`, `scripts/check-run.test.mjs`
- Modify: `scripts/check.mjs` (steps become lane steps; final summary), `scripts/check-lint.mjs` (CLI `--files-from <path>`), `scripts/check-lib.mjs` (the `scripts` step runs `check-run.test.mjs` and `check-log.test.mjs` too; check that the path map counts `scripts/check-run.mjs` and `scripts/check-log.mjs` like the other `scripts/check*` files)

**Interfaces:**
- Produces: `runLanes(lanes: Array<Array<LaneStep>>, { sequential: boolean, outDir: string, onEnd: (result) => void }) -> Promise<Array<{ name, step, status, seconds, log }>>`, where `LaneStep = { name, command: string, step: string | null }`; `status` is the exit code, or `null` when interrupted. Every step of a lane runs whatever the earlier ones returned. Output of each step goes to `<outDir>/<step or name>.log`; `onEnd` is called as each step ends (the caller prints a failure's log right then, and records green or failed).
- `sequential: true` (when `process.env.CI` is set) runs the lanes' steps one after another in lane order.
- On SIGINT: kill every running child tree, resolve with the unfinished steps at `status: null`.

- [ ] **Step 1: Write the failing tests** in `scripts/check-run.test.mjs`, with commands like `node -e "setTimeout(() => process.exit(1), 300)"`:
  - `'the lanes run side by side'`: lane A one 600 ms step, lane B two 300 ms steps → total under 1000 ms, three results.
  - `'a failing step does not stop the steps after it'`: lane B's first step exits 1 → its second still runs; results `[1, 0]` in order; `onEnd` called three times.
  - `'with sequential the steps run one after another'`: same lanes → total at least 1200 ms.
  - `'each step's output goes to its own file'`: a step printing `hello` → its `log` file contains `hello`; nothing on the test's stdout.
  - `'an interrupted run leaves unfinished steps without a status'` (Review Focus 1): start, send the runner's abort (expose an `AbortSignal` option `signal`) after 100 ms → the long step's `status` is `null`, and its process is gone (`process.kill(pid, 0)` throws).
- [ ] **Step 2: Run them to see them fail.** `node --test scripts/check-run.test.mjs`.
- [ ] **Step 3: Implement** `runLanes` with `child_process.spawn` (`shell: true`, stdout/stderr to the log file's fd); on Windows kill trees with `taskkill /PID <pid> /T /F`.
- [ ] **Step 4: Move `check.mjs` onto it.** Lane A: the browser test tags check (now `playwright test --list --grep-invert …` as a command whose failure output names the untagged tests), then the browser step. Lane B: typecheck, lint (`node scripts/check-lint.mjs --files-from node_modules/.cache/check/lint-files.txt`, or `--all`), check script tests, server tests, web unit tests. `onEnd`: record green on 0; for `e2e` on a failure keep the failed run (Task 1); print `✗ <name> failed` and the log on a failure, one line `✓ <name> (<s> s)` on success. At the end: every step's time and the failures; exit 1 if any failed. The `--failed` path stays as it is.
- [ ] **Step 5: Run.** `node --test scripts/check-run.test.mjs scripts/check-lib.test.mjs` → pass. `pnpm check --files package.json` (everything, records nothing) → both lanes start together, all green; note the wall time for Task 8.
- [ ] **Step 6: Commit.** `git commit -m "Check script: the browser step runs beside the other steps, and every step runs to its end"`

### Task 6: One check at a time

**Files:**
- Modify: `scripts/check-run.mjs` (`takeLock`), `scripts/check.mjs` (take it first, release on exit), `scripts/check-run.test.mjs`

**Interfaces:**
- Produces: `takeLock(path: string) -> { release: () => void } | { heldBy: number }`. The lock file holds the pid; a pid that no longer runs counts as free. Path: `check.lock` in `git rev-parse --git-common-dir`.

- [ ] **Step 1: Write the failing tests**: `'a second check finds the lock held'` (take, take again → `{ heldBy: process.pid }`); `'a lock left by a process that is gone is taken over'` (Review Focus 4: write a lock with a pid of a finished child → taken); `'release frees it'`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**, and in `check.mjs` exit 1 with `check: another pnpm check is running (pid N)` when held (also for `--failed`; `--dry` takes no lock).
- [ ] **Step 4: Run the tests**; `pnpm check` green.
- [ ] **Step 5: Commit.** `git commit -m "Check script: one check at a time per clone"`

### Task 7: The run log and `pnpm check:log`

**Files:**
- Create: `scripts/check-log.mjs`, `scripts/check-log.test.mjs`
- Modify: `scripts/check.mjs` (append a line at the end, also when interrupted), `package.json` (`"check:log": "node scripts/check-log.mjs"`), `.githooks/pre-commit` (`CHECK_FROM_HOOK=1 exec pnpm check`)

**Interfaces:**
- Produces: `appendRun(entry: RunEntry, path: string) -> boolean` (false when it couldn't write; never throws); `browserStats(report: object) -> { tests, workerSeconds, failed: string[], slowest: Array<{ test, seconds }> /* 5 */ }`; `summarise(entries: RunEntry[], { last = 20, branch } = {}) -> string`.
- `RunEntry = { at, branch /* null when detached */, head, by: 'hook' | 'person', args: string[], wall, result: 'passed' | 'failed' | 'interrupted', steps: Array<{ step, from, changed, plan, seconds, status }>, browser?: browserStats }`. File: `check-runs.jsonl` in git's common directory.

- [ ] **Step 1: Write the failing tests**:
  - `'a run is one JSON line appended'`: two `appendRun` → two parseable lines in order.
  - `'a log that cannot be written leaves the check alone'` (Review Focus 5): path in a directory that doesn't exist → returns `false`, no throw.
  - `'the browser stats come from the report'`: report with 3 tests (1.0, 2.5, 0.5 s, one failed) → `{ tests: 3, workerSeconds: 4, failed: [its line], slowest` first `2.5 }`.
  - `'the summary lists the last runs and sums each branch'`: 3 entries on 2 branches → lines per run (time, branch, by, result, wall, slowest step) and per branch `runs, failed, total wall`; `{ branch }` narrows.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**; `check.mjs` builds the entry from `since` (from, changed count), the plan per step, `runLanes`' results and `browserStats(REPORT)` when the browser step ran; prints `check: run log skipped (<reason>)` when `appendRun` returns false; writes nothing when `CI` is set. `check-log.mjs` as CLI: `--last N`, `--branch <name>`; with no log yet: `no check runs logged yet`.
- [ ] **Step 4: Run** the tests; `pnpm check` green; `pnpm check:log` shows that run.
- [ ] **Step 5: Commit.** `git commit -m "Check script: a local run log and pnpm check:log"`

### Task 8: Docs and the closing measurement

**Files:**
- Modify: `AGENTS.md` (the Checks bullet: after a fix, `pnpm check`; `pnpm check:log`), `docs/development.md` (the check section), `docs/superpowers/specs/2026-10-26-faster-local-check-design.md` (a "Result" section), `docs/decisions/0023-faster-checks.md` (one result line in the 2026-10-26 amendment; asks the owner)

- [ ] **Step 1: Measure** on the owner's laptop, nothing else heavy running: (a) `pnpm check --files package.json` → wall time (design: 443 s side by side, 550 s before); (b) the fix-and-rerun of Task 4's Step 2 → the rerun's browser step time and test count. Copy both `pnpm check:log` lines.
- [ ] **Step 2: Write** the numbers into the design's "Result" and the amendment; update AGENTS.md (keep it short) and development.md.
- [ ] **Step 3: Commit** (docs only, no check needed): `git commit -m "Faster local check: docs and measurements"`
- [ ] **Step 4:** Run the `architecture-review` subagent on the branch; fix findings with `path:line` and a rule.
