---
title: No second run of tested browser tests - implementation plan
summary: Five tasks - browser test setup and fixtures plan no browser tests; the passed-tests record and its pure helpers in check-lib.mjs; pnpm check --tests <filter> in check.mjs; pnpm check leaves out recorded passes the map doesn't reach; the ADR 0023 amendment and docs, then pnpm check, the architecture review and a PR.
status: draft
date: 2026-10-26
---

# No second run of tested browser tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm check` runs no browser tests for a change to browser test setup, helpers or fixtures, and
`pnpm check --tests <filter>` records the browser tests it ran as passed so a later `pnpm check` doesn't run them again
unless a change reaches them.

**Architecture:** Pure planning and record helpers go into `scripts/check-lib.mjs` next to the failed-run record
(`refs/check/failed-e2e`); the new record is `refs/check/passed-e2e`, a commit of the snapshot with a JSON body. The
command-line wiring goes into `scripts/check.mjs`: a `--tests` branch like the `--failed` one, and the browser lane
subtracting recorded passes through the existing `--test-list` path.

**Tech Stack:** Node.js ESM scripts, `node:test`, git plumbing (`commit-tree`, `update-ref`), Playwright's JSON report.

**Spec:** [docs/superpowers/specs/2026-10-26-check-credit-by-hand-design.md](../specs/2026-10-26-check-credit-by-hand-design.md)
(approved by the owner 2026-10-26, together with its ADR amendment text).

## Global Constraints

- Don't change CI (`.github/`), `E2E_AXE`, the variants (`@full`, `@variants`, `VARIANT_TRIGGERS`), `E2E_SERVERS`;
  don't touch `scripts/agent-lib.mjs`.
- No retries; CI's `pnpm check:full` stays the only full check (ADR 0023).
- The record may only leave out what the map would also leave out from the snapshot it passed on (spec, anti-goal).
- `--tests` changes only `refs/check/passed-e2e`, never `refs/check/failed-e2e`.
- Tests: `node:test` with `node:assert/strict` in `scripts/check-lib.test.mjs`, test-first; temporary repositories through
  the file's `repository()` helper.
- Checks: `pnpm check` before each commit (the pre-commit hook runs it); a docs-only commit needs none. Fix what lint
  reports; never grow a baseline.
- `docs/decisions/**` is protected: the amendment text below is the owner-approved text; write it as given.
- Code comments cite "ADR 0023, amendment of 2026-10-26 (no second run)".
- ADR 0053's module rules don't cover `scripts/`; keep new pure helpers in `check-lib.mjs`, which already holds the
  failed-run record.

## Review Focus

1. A `--tests` filter with spaces or `|` (`--grep "@sites|@layout"`) must reach Playwright as one argument through the
   Windows shell → `shellArgs` test in Task 3.
2. A `--tests` run whose report wasn't written during the run (server didn't start, setup crash, Ctrl-C) records
   nothing and says why → `passedToRecord` test in Task 3.
3. A test title with curly quotes, `›`, `%` or `"` survives the record's JSON body → record round-trip test in Task 2.
4. A report spec without `tags` (or with an empty list) is reached only by `all` or its spec → `stillPassed` test in Task 2.
5. A recorded test that no longer exists, or that the plan doesn't list, must not add itself to the run → `browserTestList`
   test in Task 2.

---

### Task 1: Browser test setup, helpers and fixtures plan no browser tests

**Files:**
- Modify: `scripts/check-lib.mjs` (`AREAS`: remove the six `apps/web/e2e/fixtures/…` entries, lines 22–31;
  `planTestSupport`: the `apps/web/e2e/` branch, lines 119–125, and its doc comment)
- Test: `scripts/check-lib.test.mjs` (replace the test at lines 351–358)

**Interfaces:**
- Produces: `planFor` unchanged in signature; for `apps/web/e2e/**` that is neither `*.spec.ts` nor `*.capture.ts`,
  `plan.e2e` is not raised and a note `{ text, steps: ['e2e'] }` is pushed.

- [ ] **Step 1: Replace the test at lines 351–358 with these two tests**

```js
test('browser test setup, helpers and fixtures run no browser tests; typecheck and lint run; the review capture runs none', () => {
  for (const path of ['apps/web/e2e/support.ts', 'apps/web/e2e/global-setup.ts', 'apps/web/e2e/prepare.ts',
    'apps/web/e2e/fixtures/main-computer.fit', 'apps/web/e2e/fixtures/mergeable-main.fit', 'apps/web/e2e/fixtures/suunto-d5.json']) {
    const plan = planFor([path]);
    assert.deepEqual([plan.typecheck, plan.lint, plan.server, plan.web, plan.e2e, plan.areas.size], [true, 'changed', 'none', 'none', 'none', 0], path);
    assert.match(plan.notes.map((note) => note.text).join('\n'), /no browser tests run for it; run the tests it is for with pnpm check --tests/, path);
  }
  const capture = planFor(['apps/web/e2e/review-material.capture.ts']);
  assert.deepEqual([capture.typecheck, capture.server, capture.web, capture.e2e], [true, 'none', 'none', 'none']);
  // A spec changed beside a helper still runs itself.
  const both = planFor(['apps/web/e2e/support.ts', 'apps/web/e2e/sites.spec.ts']);
  assert.deepEqual([both.e2e, [...both.specs]], ['some', ['sites.spec.ts']]);
});

test('PR #5 replayed: a change to e2e/support.ts alone plans no browser tests in pnpm check', () => {
  const changed = ['apps/web/e2e/support.ts'];
  const plan = planSteps(Object.fromEntries(['typecheck', 'lint', 'scripts', 'server', 'web', 'e2e'].map((step) => [step, changed])));
  assert.deepEqual([plan.typecheck, plan.lint, plan.e2e], [true, 'changed', 'none']);
  assert.ok(plan.notes.some((note) => note.includes('apps/web/e2e/support.ts is browser test setup or data')));
});
```

- [ ] **Step 2: Run** `node --test scripts/check-lib.test.mjs` — expected: both new tests FAIL (`e2e` is `'all'`;
  the fixtures plan `@dives`).

- [ ] **Step 3: Implement.** Remove the six fixture entries from `AREAS` (with their comments). In `planTestSupport`'s
  `apps/web/e2e/` branch, for a non-capture file push exactly this note and leave `plan.e2e` alone:
  `` `${path} is browser test setup or data: no browser tests run for it; run the tests it is for with pnpm check --tests <filter> (CI runs them all)` ``,
  `steps: ['e2e']`. Update the doc comment of `planTestSupport` ("Under apps/web/e2e (setup, helpers, fixtures): no
  browser tests; ADR 0023, amendment of 2026-10-26 (no second run)").

- [ ] **Step 4: Run** `node --test scripts/check-lib.test.mjs` — expected: all pass.

- [ ] **Step 5: Commit** (`pnpm check` runs from the hook: check script tests and lint)

```bash
git add scripts/check-lib.mjs scripts/check-lib.test.mjs
git commit -m "Check: browser test setup, helpers and fixtures run no browser tests locally (backlog 0007)"
```

---

### Task 2: The passed-tests record and its pure helpers

**Files:**
- Modify: `scripts/check-lib.mjs` (after `clearFailed`, and `browserTestList` at the end)
- Test: `scripts/check-lib.test.mjs`

**Interfaces:**
- Consumes: `planFor`, `forBrowserTests`, `changedSince`, `e2eServerLoads`, `snapshot` (existing).
- Produces (all exported from `scripts/check-lib.mjs`):
  - `reportedTests(report) → Array<{ line: string, file: string, tags: string[], status: 'passed'|'failed'|'skipped' }>`.
    `line` as `failedTestsFromReport` builds it; `tags` = `spec.tags ?? []` each prefixed with `@`; `status` `passed`
    when every test's last result is `passed`, `skipped` when every one is `skipped`, else `failed`.
  - `recordPassed(tree, tests, cwd = process.cwd())`: ref `refs/check/passed-e2e`, commit message
    `e2e: passed by hand\n\n${JSON.stringify({ tests })}`, `tests` sorted by `line`, each `{ line, file, tags }`.
  - `passedRun(cwd = process.cwd()) → { tree, base, at, tests } | null` (like `failedRun`).
  - `clearPassed(cwd = process.cwd())`: deletes the ref; no error when absent.
  - `stillPassed(tests, plan) → tests`: those not reached: none when `plan.e2e === 'all'`; drops a test whose `file`
    is in `plan.specs` or whose `tags` meet `plan.areas`.
  - `passedSince(tree, cwd = process.cwd()) → { at, tests } | null`: `passedRun`, then `stillPassed` against
    `planFor(forBrowserTests(changedSince(run.tree, tree, cwd), run.tree, tree, cwd).changed, { e2eServerLoads: e2eServerLoads(cwd) })`;
    null when there is no record.
  - `carryPassed(still, reported) → tests`: `still` without any line that `reported` names, plus the `reported` tests
    with status `passed` (as `{ line, file, tags }`), sorted by `line`.
  - `browserTestList({ all, planned, owed, credited = [] }) → { lines, dropped, left }`: as today, then without the
    `credited` lines; `left` = how many lines were removed for being credited.

- [ ] **Step 1: Write the failing tests** (section comment `// Amendment of 2026-10-26 (no second run): tests run by hand count.`)

```js
const spec = (file, title, tags, ...statuses) => ({ file, title, tags, tests: statuses.map((status) => ({ results: [{ status }] })) });

test('a report names each test with its line, file, tags and whether it passed', () => {
  const report = { suites: [{ title: 'sites.spec.ts', file: 'sites.spec.ts', suites: [{ title: 'Sites', specs: [
    spec('sites.spec.ts', 'adds a “Shark’s” site', ['sites'], 'passed'),
    spec('sites.spec.ts', 'fails', ['sites', 'layout'], 'failed'),
    spec('sites.spec.ts', 'times out', ['sites'], 'timedOut'),
    spec('sites.spec.ts', 'is skipped', ['sites'], 'skipped'),
    spec('sites.spec.ts', 'has no tags', undefined, 'passed'),
  ] }] }] };
  assert.deepEqual(reportedTests(report), [
    { line: 'sites.spec.ts › Sites › adds a “Shark’s” site', file: 'sites.spec.ts', tags: ['@sites'], status: 'passed' },
    { line: 'sites.spec.ts › Sites › fails', file: 'sites.spec.ts', tags: ['@sites', '@layout'], status: 'failed' },
    { line: 'sites.spec.ts › Sites › times out', file: 'sites.spec.ts', tags: ['@sites'], status: 'failed' },
    { line: 'sites.spec.ts › Sites › is skipped', file: 'sites.spec.ts', tags: ['@sites'], status: 'skipped' },
    { line: 'sites.spec.ts › Sites › has no tags', file: 'sites.spec.ts', tags: [], status: 'passed' },
  ]);
});

test('the passed-tests record keeps its snapshot and tests, odd titles and all, and can be cleared', (t) => {
  const repo = repository({ 'a.ts': 'a' });
  t.after(repo.drop);
  assert.equal(passedRun(repo.cwd), null);
  const tree = snapshot(repo.cwd);
  const odd = { line: "tools.spec.ts › 16 % of the “Shark’s” sites: it's \"quoted\"", file: 'tools.spec.ts', tags: ['@tools'] };
  const plain = { line: 'a.spec.ts › one', file: 'a.spec.ts', tags: [] };
  recordPassed(tree, [odd, plain], repo.cwd);
  const { base, at, ...rest } = passedRun(repo.cwd);
  assert.deepEqual(rest, { tree, tests: [plain, odd] });
  assert.match(at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  clearPassed(repo.cwd);
  assert.equal(passedRun(repo.cwd), null);
  clearPassed(repo.cwd);
});

test('a recorded test stays passed until the map reaches it: every test, its spec or one of its areas', () => {
  const sites = { line: 'sites.spec.ts › adds', file: 'sites.spec.ts', tags: ['@sites'] };
  const tools = { line: 'tools.spec.ts › plans', file: 'tools.spec.ts', tags: ['@tools'] };
  const untagged = { line: 'misc.spec.ts › x', file: 'misc.spec.ts', tags: [] };
  const all = [sites, tools, untagged];
  assert.deepEqual(stillPassed(all, planFor([])), all);
  assert.deepEqual(stillPassed(all, planFor(['apps/web/e2e/support.ts'])), all);
  assert.deepEqual(stillPassed(all, planFor(['apps/web/src/SitesPage.tsx'])), [tools, untagged]);
  assert.deepEqual(stillPassed(all, planFor(['apps/web/e2e/tools.spec.ts'])), [sites, untagged]);
  assert.deepEqual(stillPassed(all, planFor(['package.json'])), []);
});

test('passes recorded on an earlier snapshot carry over unless a change reaches them', (t) => {
  const repo = repository({ 'apps/web/src/SitesPage.tsx': 'a', 'apps/web/src/ToolsPage.tsx': 't' });
  t.after(repo.drop);
  const sites = { line: 'sites.spec.ts › adds', file: 'sites.spec.ts', tags: ['@sites'] };
  const tools = { line: 'tools.spec.ts › plans', file: 'tools.spec.ts', tags: ['@tools'] };
  recordPassed(snapshot(repo.cwd), [sites, tools], repo.cwd);
  repo.write('apps/web/src/SitesPage.tsx', 'b');
  const now = passedSince(snapshot(repo.cwd), repo.cwd);
  assert.deepEqual(now.tests, [tools]);
  const reported = [{ ...sites, status: 'passed' }, { line: 'tools.spec.ts › plans', file: 'tools.spec.ts', tags: ['@tools'], status: 'failed' }];
  assert.deepEqual(carryPassed(now.tests, reported), [sites]);
  const empty = repository({ 'x': 'x' });
  t.after(empty.drop);
  assert.equal(passedSince(snapshot(empty.cwd), empty.cwd), null);
});

test('the browser test list leaves out credited tests, and a credited test is never added by itself', () => {
  const all = ['a › 1', 'a › 2', 'b › 1', 'c › 1'];
  assert.deepEqual(browserTestList({ all, planned: ['a › 1', 'a › 2'], owed: ['b › 1', 'gone › 1'], credited: ['a › 2', 'b › 1', 'c › 1', 'gone › 2'] }),
    { lines: ['a › 1'], dropped: ['gone › 1'], left: 2 });
  assert.deepEqual(browserTestList({ all, planned: ['a › 1'], owed: [] }), { lines: ['a › 1'], dropped: [], left: 0 });
});
```

- [ ] **Step 2: Run** `node --test scripts/check-lib.test.mjs` — expected: FAIL, the new names aren't exported.

- [ ] **Step 3: Implement** the Interfaces above in `scripts/check-lib.mjs`. `reportedTests` walks suites like
  `failedTestsFromReport` (share the walk; `failedTestsFromReport` keeps its output). The record functions follow
  `recordFailed`/`failedRun`/`clearFailed` (same committer config, `%b` body). Existing callers of `browserTestList`
  keep working (`credited` defaults to `[]`; `left` is new).

- [ ] **Step 4: Run** `node --test scripts/check-lib.test.mjs` — expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-lib.mjs scripts/check-lib.test.mjs
git commit -m "Check: a record of browser tests passed by hand, and which of them a change since reaches (backlog 0007)"
```

---

### Task 3: `pnpm check --tests <filter>`

**Files:**
- Modify: `scripts/check-lib.mjs` (two small pure helpers), `scripts/check.mjs` (header comment, a `--tests` branch
  after the `--failed` branch)
- Test: `scripts/check-lib.test.mjs`

**Interfaces:**
- Consumes: `reportedTests`, `passedSince`, `carryPassed`, `recordPassed` (Task 2); `countingBase`, `variantsRun`,
  `browserGrepInvert`, `snapshot`, `REPORT` (existing).
- Produces:
  - `testsFilter(args) → { filter: string[] } | { error: string }` (check-lib): the arguments after `--tests`. Error
    when there are none (`'pnpm check --tests <files, file:line or --grep "…">: name the browser tests to run'`), or
    when `--failed`, `--full`, `--dry`, `--base` or `--files` is among the arguments before `--tests`
    (`` `--tests can't be combined with ${flag}` ``, first such flag); after `--tests` everything is Playwright's.
  - `shellArgs(args) → string` (check-lib): joins for `spawnSync(…, { shell: true })`; an argument with whitespace or
    any of `"|&<>^%` is wrapped in double quotes, inner `"` doubled to `\"`.
  - `passedToRecord({ report, writtenAt, startedAt }) → { reported, why }` (check-lib): `reportedTests(report)`, or
    `reported: null` with `why: "Playwright's report is from an earlier run"` when `report` is null or
    `writtenAt === null || writtenAt < startedAt`.

- [ ] **Step 1: Write the failing tests**

```js
test('--tests takes everything after it as the filter, and refuses other modes or an empty filter', () => {
  assert.deepEqual(testsFilter(['--tests', 'sites.spec.ts:12', '--grep', '@sites|@layout']), { filter: ['sites.spec.ts:12', '--grep', '@sites|@layout'] });
  assert.match(testsFilter(['--tests']).error, /name the browser tests to run/);
  assert.match(testsFilter(['--dry', '--tests', 'a.spec.ts']).error, /--tests can't be combined with --dry/);
  assert.match(testsFilter(['--failed', '--tests', 'a.spec.ts']).error, /--failed/);
});

test('a filter reaches the shell as Playwright arguments, quoted where the shell would split or pipe', () => {
  assert.equal(shellArgs(['sites.spec.ts:12', '--grep', '@sites|@layout', 'a "b" c']), 'sites.spec.ts:12 --grep "@sites|@layout" "a \\"b\\" c"');
});

test('--tests records only from a report written during its run', () => {
  const report = { suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [spec('a.spec.ts', 'one', ['tools'], 'passed')] }] };
  assert.equal(passedToRecord({ report, writtenAt: 2000, startedAt: 1000 }).reported.length, 1);
  assert.equal(passedToRecord({ report, writtenAt: 500, startedAt: 1000 }).reported, null);
  assert.match(passedToRecord({ report: null, writtenAt: null, startedAt: 1000 }).why, /earlier run/);
});
```

- [ ] **Step 2: Run** `node --test scripts/check-lib.test.mjs` — expected: FAIL (not exported).

- [ ] **Step 3: Implement the three helpers** in `check-lib.mjs`; run the tests — expected: PASS.

- [ ] **Step 4: Wire `--tests` into `check.mjs`**, right before the `--failed` branch (so a `--failed` inside the
  filter is Playwright's, not a mode), in this order:
  1. `testsFilter(args)`; on `error`, print `check: <error>` and `process.exit(1)`.
  2. `tree = snapshot()`; `variants = variantsRun(countingBase('e2e', tree).changed)`; unless the filter contains
     `--grep-invert`, add `--grep-invert "<browserGrepInvert({ full: false, variants: variants.run })>"`.
  3. Print `check: browser tests by hand (<filter>); those that pass count as passed on these files` and, as
     `browserSteps` does, the variants line and the axe-once line.
  4. `startedAt = Date.now()`; `spawnSync(\`pnpm --filter @dive-hub/web test:e2e ${shellArgs([...filter, ...invert])}\`, { stdio: 'inherit', shell: true })`.
  5. `passedToRecord` with the parsed `REPORT` (null when missing or unreadable) and its mtime. When `reported` is null,
     print `check: nothing recorded: <why>`. Else `tests = carryPassed(passedSince(tree)?.tests ?? [], reported)`,
     `recordPassed(tree, tests)`, and print `check: <n> browser test(s) passed and recorded on these files; pnpm check
     leaves them out until a change reaches them` (n = reported with status `passed`).
  6. `logRun({ steps: [{ step: 'e2e', from: '--tests', changed: 0, plan: filter.join(' '), seconds, status }], results: [{ status: ran.status }], browserSince: startedAt })`;
     `process.exit(ran.status ?? 1)`.
  Add `--tests` to the usage lines of the header comment:
  `pnpm check --tests <filter>   only the given browser tests (files, file:line, --grep); those that pass are recorded on these files, and pnpm check leaves them out until a change reaches them`.

- [ ] **Step 5: Verify by hand** (needs PostgreSQL, as any browser run):
  `pnpm check --tests tools.spec.ts` → Playwright runs only `tools.spec.ts` in the e2e project without `@full|@variants`
  tests, and the last line names the recorded count; then
  `git log -1 --format=%b refs/check/passed-e2e` → JSON with `tools.spec.ts` lines, tags with `@`.
  `pnpm check --tests` → the usage error, exit 1. `pnpm check --dry --tests x` → the combination error.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-lib.mjs scripts/check-lib.test.mjs scripts/check.mjs
git commit -m "Check: pnpm check --tests runs given browser tests and records those that pass (backlog 0007)"
```

---

### Task 4: `pnpm check` leaves out recorded passes

**Files:**
- Modify: `scripts/check.mjs` (`browserOwedStep` → `browserListStep`, `browserSteps`, the unplanned-green loop,
  `stepEnded`, the `--failed` renew branch, imports)

**Interfaces:**
- Consumes: `passedSince`, `clearPassed`, `browserTestList({ …, credited })` with `left` (Task 2).

- [ ] **Step 1: Read the record once.** After `plan` is made: `const credit = (records || dry) && !full ? passedSince(tree) : null;`
  (`given` and `givenBase` already make `records` false; with `dry`, skip it when `given` or `givenBase` is set).
  `const credited = credit?.tests.map(({ line }) => line) ?? [];`

- [ ] **Step 2: `--dry`.** When `dry` and `credited.length > 0`, print
  `check: <n> browser test(s) passed by hand on <credit.at> (pnpm check --tests) and not reached since; left out of what is planned`.

- [ ] **Step 3: The list path.** Rename `browserOwedStep` to `browserListStep(name, { owed, filters, planned, credited })`.
  In `browserSteps`, take it when `owedTests.length > 0 || (credited.length > 0 && plan.e2e !== 'none')` (only when
  `records`; with `dry` keep today's single step). Pass `credited` to `browserTestList`; when `left > 0` print
  `check: <left> browser test(s) passed by hand on <credit.at> (pnpm check --tests) and not reached since; not run again`.
  Name the step `browser tests (<owed part if any><which>, <left> passed by hand left out)`. Nothing left to run:
  as today (`clearFailed`), and the step counts as not planned (green below).

- [ ] **Step 4: Clear the record wherever the browser step records green**: in the loop that records unplanned steps
  (`if (records) … recordGreen(step, tree)` → also `clearPassed()` when `step === 'e2e'`), in `stepEnded` next to
  `clearFailed('e2e')`, and in the `--failed` renew branch next to `clearFailed('e2e')`. A failed step keeps it.

- [ ] **Step 5: Verify by hand**, continuing from Task 3's record on `tools.spec.ts`:
  - `pnpm check --dry --files apps/web/src/ToolsPage.tsx` prints no credit line (`--files` ignores the record).
  - Touch a file the map sends to `@tools` (e.g. a comment in `apps/web/src/ToolsPage.tsx`), then `pnpm check --dry`:
    no credit line (reached). Revert it; `pnpm check --dry` with only the check scripts changed: the credit line shows
    and the browser step is not planned.
  - Make an `@sites`-only change (a comment in `apps/web/src/SitesPage.tsx`), run `pnpm check --tests sites.spec.ts`,
    then `pnpm check`: the "not run again" line names the sites tests, the browser step runs the rest of
    `@sites|@layout`, and when it passes `git rev-parse -q --verify refs/check/passed-e2e` prints nothing (cleared).
    Revert the comment.

- [ ] **Step 6: Run** `node --test scripts/check-lib.test.mjs` — expected: all pass. **Commit**

```bash
git add scripts/check.mjs
git commit -m "Check: pnpm check leaves out browser tests passed by hand that no change since reaches (backlog 0007)"
```

---

### Task 5: ADR 0023 amendment, docs, check, review, PR

**Files:**
- Modify: `docs/decisions/0023-faster-checks.md` (append; protected path: the hook asks the owner, who approved the
  text), `AGENTS.md` (Checks bullet), `docs/development.md` ("Checks while working" row),
  `docs/backlog/0007-no-second-run-of-tested-tests.md` (`status: done`), `docs/index.md` only if it lists backlog
  status.

- [ ] **Step 1: Append to ADR 0023**, after the amendment "2026-10-26: a rerun after a fix, …", exactly:

```markdown
## Amendment 2026-10-26: no second run of tested browser tests
Why: the owner, 2026-10-26, after PR #5: a helper fix verified on its 7 tests was followed by all ~390 browser tests
in `pnpm check` (418 s) and again in CI. Decided with the owner; [design](../superpowers/specs/2026-10-26-check-credit-by-hand-design.md).
- **Browser test setup and data run no browser tests locally.** A changed file under `apps/web/e2e/` that isn't a
  spec (helpers, setup, fixtures) plans none; typecheck and lint run. Whoever changes it runs the tests it is for
  with `--tests`; CI runs them all. This replaces, in the amendment of 2026-10-24, "Browser test setup and data
  (`apps/web/e2e/`, not specs) run every browser test", and the fixtures' entries in the area map go.
- **`pnpm check --tests <filter>`** runs the given browser tests as `pnpm check` would (axe once, the same variants
  left out) and records each passed test on its snapshot (`refs/check/passed-e2e`). `pnpm check` leaves out every
  recorded test that the files changed since don't reach through the map (all browser tests, its spec or one of its
  areas); owed tests among them count as paid. A green browser step clears the record.
- *What is given up:* a helper or fixture change that breaks a test its author didn't run is found by CI, not
  before the push.
```

- [ ] **Step 2: AGENTS.md**, in the Checks bullet after "`pnpm check --failed` reruns failed browser tests (green there
  renews the record);" add: "a change to browser test helpers or fixtures runs no browser tests: `pnpm check --tests
  <filter>` runs the ones it is for and records them as passed;". Keep the file short.

- [ ] **Step 3: docs/development.md**, "Checks while working": after the `--failed` sentence add "A change under
  `apps/web/e2e/` that isn't a spec runs no browser tests (CI runs them); `--tests <filter>` runs given browser tests
  the way the check does and records those that pass, and `pnpm check` leaves them out until a change reaches them."

- [ ] **Step 4: Backlog 0007** `status: done`.

- [ ] **Step 5: Run** `pnpm check` — expected: green (scripts tests and lint; no browser tests). Commit:

```bash
git add docs/ AGENTS.md
git commit -m "ADR 0023: no second run of tested browser tests (amendment, docs; backlog 0007 done)"
```

- [ ] **Step 6:** run the `architecture-review` subagent on the branch; fix findings with `path:line` and a rule (fix
  loop cap 5), `pnpm check` again, commit.

- [ ] **Step 7:** push the branch and open a PR to `main` (title "Check: no second run of tested browser tests
  (backlog 0007)"), body: what changed, the PR #5 replay, the manual verification of Tasks 3–4, the attribution line.
