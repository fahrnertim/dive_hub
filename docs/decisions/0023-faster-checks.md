---
title: "ADR 0023: Checks by what changed, and a faster full check"
summary: pnpm check runs typecheck, the unit tests whose imports changed and the browser tests of the areas touched (tags); pnpm check:full runs everything before a commit. Browser tests run on 2 workers with a server and database each, prepared once; no trace recording by default; axe in 2 of 4 ui-quality variants; server tests share modules. Full check 10.5 → 3 min.
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
