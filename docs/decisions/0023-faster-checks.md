---
title: "ADR 0023: Checks by what changed, and a faster full check"
summary: pnpm check runs typecheck, the unit tests whose imports changed and the browser tests of the areas touched (tags); pnpm check:full runs everything, before a commit as decided, since the amendment of 2026-10-08 before a push or a release. pnpm check counts each step from its last green run (amendment of 2026-10-08) or from where the branch left main, whichever leaves fewer files (amendment of 2026-10-24) and leaves two ui-quality variants to the full check; changed texts run the pages that use them; --failed reruns the failed browser tests. Browser tests run on 2 workers with a server and database each, prepared once; no trace recording by default; axe in 2 of 4 ui-quality variants; server tests share modules. Full check 10.5 → 3 min. Amendment of 2026-10-24: test helpers no longer run everything, a passing --failed renews the browser record, one ui-quality variant in pnpm check, and CI's full check on the pull request is the gate (no full check before a push). Amendment of 2026-10-26: a check after a fix counts from the failed browser run, every step runs to its end with the browser step beside the others, and a local run log (pnpm check:log). Amendment of 2026-10-26 (second): browser test setup and fixtures run no browser tests locally, and --tests <filter> records passed browser tests that a later check leaves out.
status: accepted
date: 2026-10-04
---

# ADR 0023: Checks by what changed, and a faster full check

## Status
Accepted – 2026-10-04. Amends the browser test setup of [ADR 0015](0015-overrides-vocabulary-and-browser-tests.md).

## Context
After slice 9 a full check took about 10½ minutes on the owner's laptop (i7-12700H, 14 cores, Windows 11),
and it ran after every change:

| Part | Time | |
|---|---|---|
| Browser tests | 6:20 | 80 % in `ui-quality.spec.ts`: 4 variants × 17 pages with an axe scan each, plus the width sweep. One worker. |
| Review capture | 3:00 | Screenshots for review, run every slice. |
| Server tests | 0:56 | Setup was 1.5 s per file; most of the time was loading modules again for every file. |
| Typecheck, web unit tests | ~0:10 | |

Measured while deciding (2026-10-04):
- **Trace recording** (`trace: 'retain-on-failure'` records every test and discards the passing ones) cost
  about 13 % per test.
- **Parallel browser tests:** the full suite took 285 s on 1 worker, 215 s on 2, 222 s on 3 and 229 s on 4
  (tracing off).
  - Four servers starting together take 18 s instead of 8.6 s, and each worker launches its own browser.
  - Simple tests run at nearly the same speed in parallel. axe-heavy tests slow down, probably because
    Windows places background browsers on the efficiency cores.
- **Hidden dependencies between specs.** Serial order hid them: ui-quality relied on data that earlier specs
  created, and its `beforeAll` runs more than once in parallel mode. They showed up as failures and were removed.
- **Server tests without isolation per file:** 54 s → 35 s at 4 workers; 6 and 8 workers were slower.

The owner chose on 2026-10-04: the fast check by changed area, parallel browser tests, a leaner ui-quality,
the review capture by area, and the full check before every commit.

## Decision
- **Two checks:**
  - **`pnpm check`** while working (`scripts/check.mjs`). From git's changed and new files it runs:
    - the typecheck;
    - the server and web unit tests whose imports changed (`vitest --changed`);
    - the browser tests of the areas touched.

    Documentation alone runs nothing. Shared code of one app (web: `ui/`, `design/`, `i18n/`, `App`, `api`;
    server: app, schema, migrations) runs that app's tests and all browser tests. The test setup, packages,
    configuration and any path the script doesn't know run everything.
  - **`pnpm check:full`** runs everything. It runs before every commit.
  - `--dry` shows what would run; `--files a,b` asks it for given paths.
- **Browser test areas are tags** on every test: `@dives` (logbook, dive page, imports, decisions), `@divers`,
  `@sites`, `@account`, `@admin`, and `@layout` (checks across pages, run with any page change). The script maps
  source paths to tags. A changed spec file runs itself.
- **Browser tests run on 2 workers** (`E2E_SERVERS`, default 2). Each worker has its own e2e server and database
  on ports 3300, 3301, …
  - The global setup signs in on each server and prepares it once (`e2e/prepare.ts`): a crowd of long names,
    links to pass on, an Egypt site import. `ui-quality` reads the ids from `e2e/.state/data-<slot>.json`.
  - Spec files run whole in one worker. `ui-quality.spec.ts` spreads its tests over the workers, and its width
    sweep is one test per page.
  - Specs must not rely on what another spec did. Each runs on a server where any other spec may or may not
    have run before it.
- **No trace recording by default.** A failing test is run again with `--trace=on`.
- **Expectations wait 10 s** (was 5 s): pages answer more slowly while the other worker runs.
- **axe in two of ui-quality's four variants:** English light desktop and German dark phone, which covers both
  colour schemes and both languages. The 320 px and tablet variants keep the other page checks (one h1,
  title, nothing scrolling sideways, unique button names). The width sweep (320–1440 px) stays.
- **The review capture runs when a slice changes UI,** for the areas changed (`REVIEW_AREAS=sites,admin`).
  It uses one server without the preparation, so its screenshots stay as before.
- **Server tests share loaded modules** (`isolate: false`, 4 workers, 30 s hook timeout). Each file still has
  its own database. Module-level state must stay harmless to share.

Result (measured 2026-10-04):
- **Full check:** 3:06. Typecheck 4 s, server tests 25 s, web unit tests 2 s, browser tests 153 s
  including the build.
- **A change to the Dive sites page:** 1:37.
- **Review capture:** admin 29 s, sites 2:24.
- **Review capture, 2026-10-05** (after the SSI slices added pages: 4:03 for all areas): 2:04 for all areas.
  axe took 110 s of the 4:03 and a fixed 400 ms wait before every capture 52 s. Now the site pages run axe in the same two
  variants as ui-quality; the capture emulates reduced motion (the duration tokens drop to 0) and waits until no request
  is in flight, which also fixed screenshots taken before the data had arrived. Screenshots otherwise match pixel for pixel,
  apart from times and tokens.
  Setup takes only about 2 s; a run for some areas was slow because it still visited every page. Now it visits only
  the pages of those areas: dives 40 s, divers 25 s, account 30 s, admin 23 s, sites 1:24 (build not included).
  Splitting the capture over 2 workers would save perhaps 30–40 s of a full run; not done (one server, one run).

## Considered options
- **Option 2 (owner's fallback):** one browser worker, with the leaner ui-quality and the fast check.
  `E2E_SERVERS=1` still runs it that way. It would have given a full check of about 5–6 minutes.
- **4 workers:** no faster than 2 on this machine (startup, browser launches, efficiency cores). CI may differ;
  `E2E_SERVERS` sets it there.
- **One process hosting all e2e servers** (one module load instead of N): about 10 s at 4 servers (18 s against
  8.6 s), but at the chosen 2 only 1–4 s (11.5–12 s against 8–10.7 s, within run-to-run noise). Not worth
  30–45 minutes now. It becomes worth doing if CI runs 4 or more workers.
- **Retries with traces on the first retry:** cheaper debugging, but retries would hide flaky tests.

## Consequences
- A change can pass `pnpm check` and still break another area through a path the map gets wrong.
  `pnpm check:full` before every commit catches that. When a new page or module is added, its path goes into
  the map in `scripts/check.mjs` (unknown paths run everything until then).
- A new browser test needs an area tag. Untagged tests run only in the full check (`--grep-invert` lists them).
- Specs set up the data they need and assert only what holds whatever ran before them on the same server.
- The review capture no longer runs automatically. Whoever builds a UI slice runs it for that slice's areas.

## Amendment 2026-10-08: no check for a commit of documentation only
Why: `pnpm check` already runs nothing for documentation, and no check reads Markdown. `pnpm check:full` doesn't look
at what changed, so before a commit of documentation it tested again, for three minutes, code that had not changed.
Decided with the owner on 2026-10-08.

- **A commit that touches only documentation needs no check**: files under `docs/`, `AGENTS.md`, `CLAUDE.md` and
  `README.md`. "It runs before every commit" above now means every other commit.
- **Narrower than what `pnpm check` keeps quiet about.** `.claude/`, `samples/`, the compose files, the Dockerfile and
  the fixture scripts run nothing in `pnpm check` either, but they can break something, so a commit with any of them
  keeps the full check.
- **One other file in the commit and the full check runs**, as before.
- The message that hands over the commit says that no check ran and why, and which commit the last full check passed on.

## Amendment 2026-10-08: the check by what changed before a commit, the full check before a push or a release
Why: the suite grew. The full check, 3 minutes when this was decided, took about 10 minutes on 2026-10-08 (typecheck
8 s, server tests 79 s, web unit tests 4 s, browser tests 516 s), and it ran before every commit. For a slice that
touches the schema, the texts or several pages, `pnpm check` had already run exactly the same tests, so the full check
repeated them. Asked by the owner and decided with them on 2026-10-08.

- **Before a commit: `pnpm check`, green on the commit's final state.** "It runs before every commit" above no longer
  holds for `pnpm check:full`. The rule for a commit of documentation only stays.
- **`pnpm check:full` runs before a push and before a release.** Nothing else runs the whole suite: there is no CI.
  Once something runs it unattended (CI on push, or a nightly run), the full check by hand can go to releases only.
- **What made the full check necessary, and what stands in for it now:**
  - *A path the map gets wrong.* Unknown paths and shared code already run everything (texts, `api.ts`, `ui/`, the
    schema, migrations, packages, configuration). The map was read through for this amendment; one entry was too
    narrow and is widened: `apps/server/src/divers/` now also runs `@dives` and `@account` (a Dive shows its
    Participants and their codes, the account page imports buddies).
  - *Browser tests without an area tag* ran only in the full check. Now `pnpm check` fails when one exists: a step
    "browser test tags" lists the tests that have none of the tags (`TAGS` in `scripts/check.mjs`) whenever browser
    tests run. A new area's tag is added there.
- **What is given up:** a break in another area through a path the map gets wrong is found at the next push, not at
  the commit. It is then at most a few commits old.
- **Still quiet in `pnpm check`, so covered only by the full check:** `.claude/`, `samples/`, the compose files, the
  Dockerfile and the fixture scripts. A commit with one of them and nothing else runs no test; the push does.
- The message that hands over a commit says which check ran and what it ran (by area, or everything).
- *Considered:* the full check only before releases (with no CI a break could be many commits old and slow to trace);
  a git pre-push hook that runs the full check (it needs a setting in every clone and makes every push wait ten
  minutes; not installed, the rule is in AGENTS.md); keeping the rule and making the suite faster (worth doing
  anyway: `ui-quality.spec.ts` is most of the time).

## Amendment 2026-10-08: the check counts from its last green run
Why: `pnpm check` planned from the files changed since the last commit. Inside a slice that list only grows, so every
rerun repeated everything the slice had touched so far: after one failing browser test was fixed, the server tests
(79 s) and every area of the slice ran again, although they had passed on the same files. Asked by the owner on
2026-10-08: testing times slow development down.

- **A step that passes records the state it passed on.** The steps are the typecheck, the check script's tests, the
  server tests, the web unit tests and the browser tests. The state is the working tree as a git tree (tracked files
  with their edits, and new files that aren't ignored), held by a local ref `refs/check/green-<step>`. Nothing is
  committed to a branch, the index is not touched, and git pushes and fetches no such ref.
- **The next run plans each step from the files that differ from that step's record**, committed or not. Without a
  record it counts from the last commit, as before. A step with nothing to run takes the new state as its record.
  - After a failure, the steps that passed before it don't repeat for the files they passed on; the failed step and
    those after it count from their older records.
  - A file changed back to what passed doesn't count. A commit of the state that passed changes nothing: the check
    then says "nothing changed". A pull or a branch switch counts like any other change.
- **`--dry` says which base it used**: "N changed file(s) since the green run of …" or "… since the last commit (no
  green run recorded)", per step when the steps differ.
- **`--base <commit>` and `--files` record nothing**, and neither does `--dry`: only a run that started from the
  record can say the new state is green. `pnpm check --base HEAD` is the check as it was (all uncommitted changes).
  `pnpm check:full` runs everything and records each step that passes.
- **The unit tests get their files from the script** (`vitest related <files>`, which is what `vitest --changed` runs
  from its own list): vitest's list can only start at a commit. When the list is too long for one command line, all
  of that app's unit tests run.
- **The planning moved to `scripts/check-lib.mjs`** (the path map, the plan, the record) with tests in
  `scripts/check-lib.test.mjs` (Node's test runner). They run as a step when a `scripts/check*` file changed, and in
  the full check. A new page or module still gets its path in the map, now in `check-lib.mjs`.
- **What is given up:** the record is trusted. A test that passed by luck (a flaky one) is not run again until its
  files change or the full check runs; before, the next rerun in the same slice would have run it again.
  "Green on the commit's final state" above now means: `pnpm check` exits green on that state, whether it ran steps
  or found every step already recorded on it.
- **To forget the records:** `git for-each-ref --format="%(refname)" refs/check` lists them, `git update-ref -d` removes one.
- *Considered:* a file under `node_modules/.cache` naming the tree (git removes an unreferenced tree after two weeks,
  and a second place to keep in step with git); one record for the whole run (a failure in the last step would repeat
  all earlier ones, which is the common case); recording per browser test area (the areas overlap through `@layout`,
  and Playwright's `--last-failed` does this better, see the next amendment).

## Amendment 2026-10-08: fewer browser tests in `pnpm check`
Why: the browser tests are nine tenths of a check. Measured on the full run of 2026-10-08 (285 tests, 540 s on
2 workers, 871 s of worker time):

| Part | Tests | Worker time |
|---|---|---|
| `ui-quality.spec.ts`, every page in 4 variants | 184 | 544 s |
| – English, light, desktop (axe) | 46 | 208 s |
| – German, dark, phone (axe) | 46 | 149 s |
| – German, light, tablet | 46 | 99 s |
| – English, light, small phone | 46 | 88 s |
| `ui-quality.spec.ts`, "behaviour" (the width sweep is 22 s of it) | 29 | 66 s |
| The 18 other spec files | 72 | 261 s |

Decided with the owner on 2026-10-08. `pnpm check:full` runs everything, as before; all four points change only
what `pnpm check` runs.

- **`pnpm check --failed`** runs only the browser tests that failed in the last browser run (Playwright's
  `--last-failed`, from `apps/web/test-results/.last-run.json`). It records nothing, because it says nothing about
  the other tests: once they pass, `pnpm check` runs the browser plan whole, and that run is the one a commit needs.
- **ui-quality's two variants without axe run only in the full check** (tag `@full`: English light small phone,
  German light tablet; 92 of the 285 tests, 187 s of worker time). `pnpm check` passes `--grep-invert "@full"`.
  - Still in `pnpm check`: both variants with axe (both languages, both colour schemes, desktop and phone) and the
    width sweep from 320 to 1440 px.
  - Given up until the push: German at tablet width, and one h1, the title and unique button names at 320 and 768 px.
- **Changed texts run the browser tests of the pages that use them.** A changed `i18n/locales/*.json` ran every
  browser test, and nearly every slice changes texts.
  - For the browser tests the script compares the texts with the step's base, takes the top-level groups that
    differ (`sites`, `diverCodes`, …) and counts the source files under `apps/web/src` that name a key of them
    (`'sites.title'`, `` `import.status.${…}` ``) as changed. Those files then go through the path map like any
    other: a page runs its areas, shared code runs everything.
  - So nothing is kept by hand. On 2026-10-08, 24 of the 33 groups narrow to areas; `common`, `nav`, `form`,
    `errors`, `logbook`, `geo`, `provider` and `providers` still run everything (named in `App.tsx`, `ui/`,
    `lib/display.ts` or the texts' type file).
  - A group that no source file names keeps the texts file as the change, which runs everything. So does
    `--files`, which has no base to compare with.
  - The web unit tests still all run for a changed texts file (4 s).
  - Given up until the push: a text shown on a page of an area that none of the files naming its key belongs to
    (a key passed on in a variable from a file of another area).
- **`pages.css` runs `ui-quality.spec.ts`, not every browser test** (every page with axe, the width sweep and the
  behaviour checks). Given up until the push: a style that hides or covers a control and so breaks one of the 18
  other spec files.
- *Dropped after measuring:* taking `@layout` off the width sweep (the sweep is 22 s of worker time), and not
  building the web client when no web file changed (`vite build` takes 0.6 s).

## Amendment 2026-10-22: lint, module boundaries, CI and a git hook
Why: the rules for code quality and module boundaries lived in prose, and nothing failed when they were broken
([guardrails research](../research/2026-10-22-agent-guardrails.md)). Asked by the owner on 2026-10-22, without
refactoring code yet.

- **A new step, "lint and module boundaries"** (`lint` in `STEPS`, after the typecheck), run by
  `scripts/check-lint.mjs`:
  - ESLint (`eslint.config.mjs`): typescript-eslint's recommended rules and `sonarjs/cognitive-complexity` at 15.
  - dependency-cruiser (`.dependency-cruiser.cjs`): no cycles (type imports count), `db/` imports no domain module,
    route files don't import `drizzle-orm`, `ui/` imports no page ([ADR 0053](0053-module-boundaries.md); accepted the
    same day, which added the allow-list of imports between domain modules).
  - `pnpm check` lints the changed files (dependency-cruiser follows their imports, so a new cycle through them is
    found); `pnpm check:full` and `pnpm lint` lint everything. Like the other steps it records its green run.
  - Changed lint configuration or baselines lint everything and run no test. `.github/` and `.githooks/` are quiet.
- **Baselines; only new problems fail.** The problems of 2026-10-22 are in `eslint-suppressions.json` (ESLint's bulk
  suppressions, 84: 50 functions over the complexity budget, 34 others) and `.dependency-cruiser-known-violations.json`
  (23). **A baseline may only shrink:**
  - ESLint fails when a suppressed problem no longer occurs; dependency-cruiser's run over everything does the same
    for a known violation. `pnpm lint:baseline` takes fixed problems out and never adds one.
  - A baseline with an entry that is new or counts more than at `HEAD` fails, also when another entry went at the same
    time (a fixed problem can't be swapped for a new one). In CI the comparison is with the base of the pull request
    or the commit before a push (`BASELINE_REF`; after a force-push, the commit before `HEAD`).
  - A change to `.claude/hooks/lint-file.mjs` runs the check script's tests and lints everything (the rest of
    `.claude/` stays quiet).
  - Thresholds are not raised to make something pass.
- **Only problems are printed** ([ADR 0039](0039-working-economically.md)): nothing when all is well, no full reports.
- **CI** (`.github/workflows/check.yml`) runs `pnpm check:full` on every push to `main` and every pull request,
  with PostgreSQL 18 as a service and Playwright's Chromium, cached by Playwright's version
  (`PLAYWRIGHT_CHANNEL=chromium`; on a laptop the tests keep using the installed Edge). This is the "something that
  runs it unattended" the amendment of 2026-10-08 waited for; whether the full check by hand before a push can now go
  is left to the owner once CI has run green for a while.
- **A pre-commit git hook** (`.githooks/pre-commit`) runs `pnpm check`. Installed per clone with `pnpm hooks:install`
  (`core.hooksPath`); not with `prepare`, because the Docker build has no `.git`. The pre-push hook considered on
  2026-10-08 stays rejected: CI runs the full check instead.
- **After every edit by an agent**, a Claude Code PostToolUse hook (`.claude/hooks/lint-file.mjs`) runs the same lint on
  the edited file (about 5 s) and returns problems to the agent.
- *Considered:* Biome (faster, but no cognitive-complexity rule with SonarJS's definition and no bulk suppressions);
  eslint-plugin-boundaries instead of dependency-cruiser (see ADR 0053); type-aware ESLint rules (slower on every
  edit; can come later).

## Amendment 2026-10-24: main counts as green
Why: a fresh branch off main inherited a stale green record (the records are one per repository, not per branch), so
everything main had gained since, merged pull requests included, counted as changed and the full browser suite ran.
Asked by the owner on 2026-10-24: what branches off main counts as green, because CI runs `pnpm check:full` on every
push to main and every pull request.

- **Per step, without `--base` or `--files`, there are up to three bases:** the step's green record, `git merge-base
  HEAD main` (when a `main` exists) and `git merge-base HEAD origin/main` (when `origin/main` exists). The step counts
  from the one that leaves the fewest changed files; a tie prefers the green record. With none, from the last commit
  as before. Changed texts are mapped to the source files that use them against the chosen base.
- **This replaces one sentence of the amendment of 2026-10-08**, "A pull or a branch switch counts like any other
  change": a pull or a branch switch now counts only what differs from main or from the green record, whichever is closer.
- **`--dry` names the base:** "its green run of <date>" or "main (where this branch left it, <short sha>)".
- **Recording is unchanged:** a step that passes records the snapshot as its green run.
- **What is given up:** the check trusts that main is green. CI checks it; but a red main would hide its own failures
  from the branch's check until the failing files change or `pnpm check:full` runs.

## Amendment 2026-10-24: a faster `pnpm check`, and CI as the only full check
Why: the owner, 2026-10-24: "It feels like 80+ percent of our development time is wasted in testing." One `pnpm check`
browser run took 1126 s (280 tests, 2 workers), several times a day: a one-off owner script under
`apps/server/test/fixtures/` was an unknown path, so every check ran everything, and a flaky failure made the next
check run the whole suite again. Decided with the owner on 2026-10-24.

Measured 2026-10-24 on the owner's laptop (i7-12700H, 14 cores / 20 threads, Windows 11; the owner's dev servers on
ports 3000 and 5173 were running, no collision with 3300+), the browser suite as `pnpm check` ran it (without `@full`):

| Workers | Wall | Server start and preparation | Tests (span) | Worker time in tests | Failed |
|---|---|---|---|---|---|
| 2 | 1136 s | 37 s | 1093 s | 2044 s | 1 (push-run.spec.ts:53, fixed: the live announcer repeated the text) |
| 4 | 1307 s | 173 s | 1116 s | 3278 s | 14 (timeouts at 30 s) |
| 2, without `@variants` (below) | 877 s | 33 s | 810 s | 1439 s | 2 flaky (ui-quality.spec.ts:327 and :1369) |

- No contention at 2 workers: four spec files took 52 s alone on 1 worker and 46 s inside the 2-worker run. The tests
  are slow themselves: 7.3 s on average (3.1 s on 2026-10-08), mostly setup through the API and navigation.
- `ui-quality.spec.ts` is 1231 s of the 2044 s. In its English variant (57 tests, 526 s) axe takes 246 s: 104 page
  checks at 2.4 s each. The slowest tests (`:825` 29 s, `:244` 22 s, `:679` 21 s, `:73` 20 s) run axe 3–6 times each.
- 6 workers were not measured (owner): 4 was already slower, as on 2026-10-04.

Decided:
- **Unknown files don't run everything.** Files under `apps/server/test/` that aren't tests (helpers, fixtures, one-off
  scripts) run the server tests that import them (`vitest related`); the server test setup (`support.ts`) and fixture
  data (any file there that isn't `.ts`: read, not imported, so its readers can't be traced) all server tests and
  every browser test. Helpers run every browser test only when the e2e server loads them: the check script follows the
  relative imports from `apps/server/test/e2e-server.ts` within `apps/server/test/`, with `.js`, without an extension
  and through a folder's `index.ts` (so a new import there counts at once, with no list to keep). Browser test setup and data (`apps/web/e2e/`, not specs) run
  every browser test and nothing else; the review capture none. The check scripts run their own tests (`check-lint.mjs`
  also lints everything; ESLint covers TypeScript only, so the check scripts were never linted). `LICENSE`, `NOTICE` and `scripts/fit-compressibility.mjs` are quiet. Packages, the lockfile,
  configuration and paths the script doesn't know still run everything; shared app code still runs that app's tests and
  every browser test.
- **A passing `--failed` renews the browser record.** A browser step that fails in a run that records keeps its snapshot
  and Playwright's failed tests (`refs/check/failed-e2e`), but only from a report Playwright wrote during that step, with
  status failed and a list of failed tests, and only while the config sets no `maxFailures` (tests a stopped run never
  started would otherwise count as passed); otherwise nothing is kept and the output says why. `pnpm check --failed` that passes on the same snapshot, with
  Playwright's last run still that run, records the browser step green there: every test the step planned has then
  passed on those files. Changed files, or another Playwright run in between, record nothing, as before. The output
  says which. This replaces "It records nothing" in the amendment of 2026-10-08 for that case.
- **One ui-quality variant locally.** `pnpm check` runs ui-quality in English, light, desktop only; German, dark,
  phone (tag `@variants`, 57 tests, about 460 s of worker time) runs when texts (`i18n/`), shared styles (`pages.css`,
  `design/`) or shared UI (`ui/`, `App.tsx`, `main.tsx`) changed, and then for the areas touched. The two variants
  without axe stay `@full`. CI runs all four. Measured: the whole local browser plan went from 1136 s to 877 s.
- **axe once per ui-quality test locally.** `pnpm check` sets `E2E_AXE=once`: a ui-quality test checks each page as
  before but runs axe once, on its final page, after it passed. `pnpm check:full` and CI leave it unset and run axe at
  every page check, as before. What is given up locally: an accessibility fault on an intermediate page of a test (a
  dialog closed again, a page navigated away from) waits for CI. The saving was not measured (owner); axe took 246 s of
  the English variant's 526 s of worker time, 2.4 s per page check.
- **No full check by hand before a push.** `pnpm check` before each commit (the pre-commit hook stays); CI's
  `pnpm check:full` on the pull request is the gate, and the owner merges only on green CI. This replaces "`pnpm
  check:full` runs before a push and before a release" of the amendment of 2026-10-08. `pnpm check:full` stays available.
- **Check escapes are logged.** When CI fails on a pull request whose commits had a green local `pnpm check`, whoever
  pushed it adds a line to [check escapes](../agents/check-escapes.md); CI's job summary names the failed browser tests.
  The log measures how certain the local check is and where the map needs widening.
- **`E2E_SERVERS` stays 2.**
- **Main and origin/main** at the same merge base count once; on main itself `--dry` names the base "main (<sha>)".

Not done, with numbers:
- Per-test setup through the API (resetting the seeded Dive, buddies, SSI connections) is most of the remaining time;
  shared fixtures per worker would cut it but bring back hidden dependencies between tests (see Context).
- Flaky: ui-quality.spec.ts:327 (a centre's code image not found), in one run of three; :1369 was not flaky but
  depended on other tests leaving a deleted dive (fixed: it asserts the part's own link and its heading or empty text); ui-quality.spec.ts:679 and "German, dark, phone › signed out › invitation" did not fail in
  these runs. Coverage-based test selection is a separate design.
- *What is given up:* German, dark, phone checks of a page change wait for CI (dark-mode contrast and German overflow
  on pages whose own files changed); a change that breaks another area through a wrong map entry is found at the pull
  request, not before the push.

## Amendment 2026-10-26: a rerun after a fix, steps side by side, and a run log
Why: the owner, 2026-10-26: a check takes almost 20 minutes and runs several times per feature (a failed test is rerun
until it passes, then the whole plan runs again, for each task), against about 10 minutes of implementation. Target: a
local `pnpm check` of about 5 minutes. Decided with the owner on 2026-10-26; the
[design](../superpowers/specs/2026-10-26-faster-local-check-design.md) has the details and takes effect with its plan.

Measured 2026-10-26 on the same laptop (plugged in, nothing else heavy running; numbers in the design): the local browser
plan took 334 s wall, 229 tests, **2.6 s a test, not 7.3 s**; ui-quality 42 % of its worker time; axe at every page
check instead of once +33 s; the owner's dev servers running alongside made no difference; 4 workers 284 s without
timeouts but each test 1.6× slower. A `pnpm check` that plans everything: about 550 s with the steps one after another,
443 s with the browser step beside the others. What made 2026-10-24 three times slower is unknown.

Decided:
- **A failed browser run is a base for counting.** The next `pnpm check` plans the browser step as the failed tests plus
  what the area map picks for the files changed since the failed snapshot; it is a candidate beside the green record and
  main, its failed tests always planned. A test that no longer exists is dropped and named. A step that fails without
  a fresh Playwright report keeps nothing, as before; the old failed run stays when the browser test listing fails or the step is stopped with Ctrl-C. The owed tests of a failed run count as one unit when the base is chosen (its score is the changed files + 1). Only the browser step; `pnpm check --failed` stays. This replaces,
  in the amendment of 2026-10-24, "Changed files … record nothing, as before" for a check after a fix.
- **Every step runs to its end**: a failing step no longer stops the others; each passing step records green. This
  replaces, in the amendment of 2026-10-08, "the failed step and those after it count from their older records": only
  the failed steps do.
- **The browser step runs beside the other steps** (two lanes) locally; with `CI` set the steps run one after another.
  Output goes to files and only problems are printed ([ADR 0039](0039-working-economically.md)). One check at a time per
  clone (a lock).
- **A local run log**: each `pnpm check` that runs steps appends a line to `check-runs.jsonl` in git's common directory
  (bases, plans, times, results, the browser step's slowest tests); `pnpm check:log` sums it per branch. Never committed;
  what it teaches goes into `docs/`.
- **Unchanged:** `E2E_SERVERS` 2, axe once per ui-quality test locally, the variants as on 2026-10-24, CI's
  `pnpm check:full` as the only full check, no retries.
- *What is given up:* a failed run is trusted like a green record (the map decides what the fix touched); a failing
  typecheck no longer stops the browser tests, so its error arrives after the slowest step.
- *Considered:* fewer axe passes and fewer variants (little left to gain after measuring); stopping the browser tests
  when a fast step fails (sooner answer, but the browser tests run again after the fix; owner chose to let them finish).
- *Result (2026-10-26):* a check that plans everything 473 s (550 s before; target 443 s); the rerun after a fix 82 s for
  the browser step (the failed tests plus `@tools|@layout`), 90 s for the whole check. See the [design's Result](../superpowers/specs/2026-10-26-faster-local-check-design.md#result).

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
