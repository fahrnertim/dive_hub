---
title: "Plan: tidy piece 6's automation, server and tests (backlog 0010, points 1-11)"
summary: Cheaper queue writes on a Revision or a site change, the Clock everywhere, the queue's races and leftovers, two Conflict gaps, the scheduled fetch's log, tick and summary, batched list queries, the queue's reads moved to WaitingPushService, and the flaky, missing and untidy tests. The web points (12-14) are a second plan.
status: draft
date: 2026-10-29
---

# Tidy piece 6's automation, server and tests: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Points 1-11 of backlog 0010 fixed, each with a test where it changes behaviour; `pnpm check` green, then the PR.

**Architecture:** Almost all in `apps/server/src/providers/` (the queue `waiting-push-queue.ts`, the worker's side
`waiting-push-service.ts`, `scheduled-fetch.ts`, `conflicts.ts`, `push-service.ts`, `dive-import.ts`), plus the callers
that pass a time (`dives/revisions.ts`, `sites/site-service.ts`, `sites/import/site-import-service.ts`), the route
wiring (`app.ts`, `routes.ts`, `dives/routes.ts`, `worker.ts`, `main.ts`) and tests. No new module.

**Tech Stack:** TypeScript, Fastify + TypeBox, Drizzle on PostgreSQL, Graphile Worker, Vitest against a real PostgreSQL, Playwright.

**Spec:** [docs/backlog/0010-provider-automation-follow-ups.md](../../backlog/0010-provider-automation-follow-ups.md)
(points 1-11). Background: [ADR 0056](../../decisions/0056-two-way-exchange-and-automation.md) (amendment of
2026-10-27), the [piece 6 plan](2026-10-27-provider-automation.md)'s Global Constraints, the "Sending by itself" part of
the [client contract](../../spec/clients.md).

## Global Constraints

- [ADR 0053](../../decisions/0053-module-boundaries.md): no new import across modules. `waiting-push-queue.ts` imports
  only the database layer (it is called from `dives/revisions.ts`; a `dives/` import there is a cycle).
- [ADR 0056](../../decisions/0056-two-way-exchange-and-automation.md): the quiet periods (30 s, 5 min), the retries
  (5 min, 30 min, 2 h, 6 h until 24 h), `OFFER_ABOVE = 20` and the fetch intervals don't change; nor how entries are
  written, closed and chosen.
- No migration, no `db/schema.ts` change, nothing in `docs/decisions/` (backlog "Don't"). Live updates (backlog 0009) are out of scope.
- API shapes stay; only descriptions and the contract text change (Task 6).
- Tests against a real PostgreSQL, at most one `vi.fn` per test file, no `vi.mock`; every browser test keeps an area tag.
- `pnpm check` green before each commit (`pnpm`, never `npm`).
- `karpathy-guidelines` (load it before Task 1): every changed line traces to a point of the backlog task.
- Skills: `postgres-drizzle`, `fastify-best-practices`, `vitest`, and `playwright-cli` for the browser tests of Tasks 8-10, each with its override in [skills.md](../../skills.md#overrides).

## Rulings (made while planning; the owner may overrule)

- **Point 3, PATCH `/connections/:id` in one transaction: struck.** The checks are the Provider's capabilities and the
  Connection's owner; the only concurrent change that matters is the Connection being deleted, and then the next part's
  own lookup answers `connection_not_found` for a row that is gone. A transaction across `connections` and
  `diveImports` would need a `Tx` through three service functions for no change a User could see. The backlog file
  says so (Task 11).
- **Point 6, a running or failed Import as the last fetch:** `lastFetchImportId` means "the last fetch whose Import
  finished". `fetch()` no longer writes it; the worker, when an Import finishes `done` with `plan.unattended`, sets it on
  the Import's Connection unless the one there is newer. A running or failed fetch leaves the previous summary.
- **Point 4, `queued`:** an entry is `queued` when the Dive's send entry carries a choice made after the Conflict was
  found, in any state (waiting, held, stopped): the logbook row shows a held or stopped one.
- **Point 5, "keep Dive Hub's" without a Connection to send through:** the field stays open (not closed), so the
  choice isn't lost silently.

## Review Focus

1. A Diver whose Connections all have the sending settings off: a Revision writes nothing to the queue and makes one
   query at most (Task 1 test asserts no entry; the review checks the early return).
2. A site rename with Dives of several Divers, some sent, some not, one deleted: only the sent live Dives of Connections
   with "send changes" on are queued (Task 1 test).
3. Two decisions for the same Dive at once (two tabs): both choices end in the entry's `options` (Task 3 test).
4. A delete waiting when a decision comes: the delete stays and its `options` don't change (Task 3 test).
5. A fetch whose Import fails after an earlier one finished: the summary still shows the earlier one (Task 5 test).

---

### Task 1: Queue writes cost no queries without a sending setting; a site change in a few queries (point 1)

**Files:**
- Modify: `apps/server/src/providers/waiting-push-queue.ts` (`noteDiveChange`, `noteSiteChange`, `Note`)
- Test: `apps/server/test/waiting-pushes.test.ts`

**Interfaces:**
- Produces: `noteDiveChange(tx, diveId, cause, at, actor?)` and `noteSiteChange(tx, siteId, at)`, signatures unchanged.
  Inside: `noteDives(tx, dives: { id: string; diverId: string; deletedAt: Date | null; startsAt: Date }[], cause, at, from: string | null)`,
  which loads the Diver's Connections with any of `sendChanges`, `sendNewDives`, `deleteAtProvider` on and the Dives'
  pushes once each, then decides per Dive and Provider with `noteSent` / `noteNew` as today.

- [ ] **Step 1: Write the failing tests** in the queue's describe of `waiting-pushes.test.ts`:
  - `it('a site rename queues the sent live Dives there, of Connections with send changes on')`: two Divers' Dives at one
    site; Ann's Connection with `sendChanges`, one Dive sent, one not, one sent and deleted; Bob's Connection all off,
    one Dive sent. Rename the site through `PATCH /api/sites/:id`. Expect exactly one entry: Ann's sent live Dive,
    `action: 'send'`, `state: 'waiting'`.
  - `it('a Revision of a Diver without a sending setting writes nothing, and a restore still cancels a waiting delete')`:
    settings off, edit the Dive: no entry. Then a delete entry waiting (setting on, delete, setting off), restore: no entry.
- [ ] **Step 2:** `pnpm --filter @dive-hub/server exec vitest run test/waiting-pushes.test.ts` — the first may already
  pass (behaviour kept); the point is the queries. Note which fails.
- [ ] **Step 3: Implement.** `noteDiveChange`: the `restore` delete first (as today), then one query of the Dive joined
  with the Diver's Connections that have a setting on; return when none. `importedFrom` only when the cause is `fill`
  or `update`. `noteSiteChange`: one query of the site's live Dives with their Diver, then `noteDives` with cause `edit`.
- [ ] **Step 4:** Same command — PASS; `pnpm check`.
- [ ] **Step 5: Commit** `Queue: no queries for a Diver without a sending setting; a site change in a few queries (backlog 0010, point 1)`.

### Task 2: The Clock, and the Revision's time for a site change (point 2)

**Files:**
- Modify: `apps/server/src/providers/waiting-push-queue.ts` (`queueNow`), `conflicts.ts` (`record`, `ConflictEntry`),
  `push-service.ts`, `dive-import.ts`, `waiting-push-service.ts` (`decide`), `layer.ts`, `dives/revisions.ts`,
  `sites/site-service.ts`, `sites/import/site-import-service.ts`
- Test: `apps/server/test/provider-conflicts.test.ts`, `waiting-pushes.test.ts`

**Interfaces:**
- Produces: `queueNow(q, diveId, provider, connectionId, options, at: Date)`; `ConflictEntry` gains `foundAt: Date`
  (`record` writes it); `createPushService` and `createDiveImportService` take `clock?: Clock` (layer passes `...clock`);
  `writeRevision(...)` returns `Promise<{ at: Date }>`.
- Consumes: Task 1's `noteSiteChange`.

- [ ] **Step 1: Write the failing tests.** In `provider-conflicts.test.ts`, remove the line that moves `changedAt` back
  by a second (`:97`) and instead `ctx.clock.skip(1_000)` before the choice; the test must pass on the Clock alone. In
  `waiting-pushes.test.ts`: `it('a decision is due at the Clock\'s now')` — `ctx.clock.skip(3_600_000)`, decide, expect
  the entry's `dueAt` and `changedAt` within a second of `ctx.clock.now()` (not of `Date.now()`); and
  `it('a site change queues at the time of the site\'s Revision')` — the entry's `changedAt` equals the `dive_site`
  Revision's `at`.
- [ ] **Step 2:** Run both files — the new assertions FAIL.
- [ ] **Step 3: Implement.** Every caller passes the time: `decide` its `now()`, `queueKept` and `record` in the import
  and the send `new Date(clock.now())`, the site callers the `at` their own `writeRevision` returned (for a merge, the
  kept site's Revision).
- [ ] **Step 4:** Run both files — PASS; `pnpm check`.
- [ ] **Step 5: Commit** `The Clock for decisions and Conflicts; a site change at its Revision's time (backlog 0010, point 2)`.

### Task 3: Races and errors (point 3)

**Files:**
- Modify: `apps/server/src/providers/waiting-push-queue.ts` (`queueNow`), `push-service.ts` (`send`, deps),
  `waiting-push-service.ts` (`afterImport`, `queueOrOffer`), `layer.ts`
- Test: `apps/server/test/waiting-pushes.test.ts`

**Interfaces:**
- Produces: `createPushService` takes `log?: WaitingPushLog` (layer passes `deps.log`; default as in
  `waiting-push-service.ts`). `queueOrOffer(q: Tx, conn, diveIds, importId, at)`.

- [ ] **Step 1: Write the failing tests:**
  - `it('two decisions at once both end in the entry')`: `Promise.all` of `decide(..., { conflicts: { notes: 'hub' } })`
    and `decide(..., { conflicts: { site: 'provider' } })`; expect `options.conflicts` toEqual `{ notes: 'hub', site: 'provider' }`.
    Run it in a loop of 10 so the race shows.
  - `it('a decision leaves a waiting delete as it is')`: a delete waiting; decide; the entry is still the delete with `options: {}`.
- [ ] **Step 2:** Run — the first FAILS (one choice lost) at least once in the loop.
- [ ] **Step 3: Implement.** `queueNow` merges in the upsert, without reading first: `set.options` is
  `waiting_push.options || excluded.options`, with `conflicts` the merge of both sides' `conflicts` when either has it
  (a `case` on `?`); the insert writes `options` as given. `send`: the `settleWaitingPush` after a confirmed send is
  wrapped; a throw goes to `log.error({ err, diveId, provider }, 'a confirmed send could not settle its Waiting push')`
  and the send answers as confirmed (the worker's next step finds the Dive up to date and settles it). `afterImport`
  runs in one `db.transaction`; `queueOrOffer` and `upsertSend` take that `tx`.
- [ ] **Step 4:** Run — PASS (the loop too); `pnpm check`.
- [ ] **Step 5: Commit** `Queue: decisions merge in one statement; a send's settle never fails a confirmed send; an Import's queueing in one transaction (backlog 0010, point 3)`.

### Task 4: Leftovers in the queue, and the two Conflict gaps (points 4 and 5)

**Files:**
- Modify: `apps/server/src/providers/waiting-push-service.ts` (`hold`, `unsentDives`), `conflicts.ts` (`waiting`'s
  `chosen`), `dive-import.ts` (`held`, `sync`, `queueKept`)
- Test: `apps/server/test/waiting-pushes.test.ts`, `provider-conflicts.test.ts`

**Interfaces:**
- Produces: `held(...)` also returns `equal: SyncedField[]` (open fields whose two sides are now the same);
  `queueKept(...)` returns `Promise<boolean>` (queued or not).

- [ ] **Step 1: Write the failing tests:**
  - `it('a hold for another reason clears an earlier exists')`: an entry held `exists` with `detail`; Link chosen; the
    send finds the requirements unmet; expect `reason: 'requirements'`, `detail: null`.
  - `it('an offer drops the Imports whose Dives were all sent')`: an offer with two Imports; send all Dives of one;
    `unsentDives` (through `GET /api/connections`); expect `unsentImportIds` to hold only the other Import.
  - `it('a choice stays queued while its entry is held')`: a conflict choice queued, the entry then held for
    `requirements`; `GET /api/provider-conflicts` lists the entry with `queued: true`.
  - In `provider-conflicts.test.ts`: `it('an import closes an open field whose two sides became equal')`: an open
    `notes` entry; the Provider's notes set to Dive Hub's; an import; the entry is gone from `provider_conflict` (the
    row, not only the read side). And `it('keeping Dive Hub\'s value without a Connection to send through leaves the field open')`:
    the current remote's `connectionId` null; an import with `conflicts: { '<remote>:notes': 'hub' }`; the field is still stored.
- [ ] **Step 2:** Run both files — the five FAIL.
- [ ] **Step 3: Implement.** `hold` sets `detail: detail ?? null`. `unsentDives` writes back
  `unsentImportIds` without the Imports none of whose Dives is still unsent (only when that list shrank). `chosen` in
  `waiting` drops the `state = 'waiting'` condition (Ruling, point 4). `sync` closes `equal` fields that have no choice,
  closes `provider` choices, and closes `hub` choices only when `queueKept` answered true (Ruling, point 5).
- [ ] **Step 4:** Run both files — PASS; `pnpm check`.
- [ ] **Step 5: Commit** `Queue leftovers and Conflicts: holds clear an old exists, offers drop sent Imports, queued in any state, equal fields close (backlog 0010, points 4-5)`.

### Task 5: The scheduled fetch: its log, one tick query, the last finished fetch (point 6)

**Files:**
- Modify: `apps/server/src/providers/scheduled-fetch.ts`, `waiting-push-service.ts` (`WaitingPushLog`), `layer.ts`,
  `apps/server/src/worker.ts` (`processImportTask`), `apps/server/test/e2e-server.ts` if its fetch state needs it
- Test: `apps/server/test/scheduled-fetch.test.ts`, `waiting-push-api.test.ts`

**Interfaces:**
- Produces: `WaitingPushLog` gains `warn(detail: object, message: string): void`; `createScheduledFetch` takes
  `log?: WaitingPushLog`; `scheduledFetch.finished(importId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests** in `scheduled-fetch.test.ts`:
  - `it('a fetch the Provider refuses is logged for the operator')`: the Provider down; `fetch`; the one `vi.fn` of the
    file (`warn`) called once with `expect.objectContaining({ connectionId, code: 'provider_unavailable' })`.
  - `it('the tick asks about running Imports once, not per Connection')`: three due Connections, one with a running
    Import; `tick` queues the two others (behaviour; the review checks the single query).
  - `it('a running or failed fetch leaves the last finished one as the summary')`: a fetch whose Import finishes
    (`finished` sets `lastFetchImportId`); a second fetch whose Import fails: `lastFetchImportId` still the first;
    `finished` for an older Import than the one stored changes nothing. Update the existing tests that read
    `lastFetchImportId` right after `fetch` (`:63`, `:115`) to read the started Import instead.
- [ ] **Step 2:** `pnpm --filter @dive-hub/server exec vitest run test/scheduled-fetch.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `fetch`'s catch logs with `log.warn({ connectionId, provider, code }, 'a scheduled fetch failed')`
  before going on. `tick` loads the Connections with `pending` or `processing` Imports in one query and `due` takes that
  set instead of calling `blocked`'s query per Connection. `fetch` stops writing `lastFetchImportId`; `finished`
  writes it when the Import is `done`, its `plan.unattended`, and the stored one is null or older (by `createdAt`).
  `processImportTask` calls `scheduledFetch.finished(importId)` for every finished Import, before its
  `outcome.length === 0` return, inside its own try/catch like `afterImport`.
- [ ] **Step 4:** Run `scheduled-fetch.test.ts` and `waiting-push-api.test.ts` — PASS; `pnpm check`.
- [ ] **Step 5: Commit** `Scheduled fetch: a refused fetch is logged, one tick query, the summary is the last finished fetch (backlog 0010, point 6)`.

### Task 6: List queries without N+1 (point 7), and the contract's words

**Files:**
- Modify: `apps/server/src/providers/waiting-push-service.ts` (`overview`, `offersOf`, `unsentDives`, `createdBy`),
  `conflicts.ts` (`waiting`), `routes.ts` (the `lastFetch` description), `docs/spec/clients.md` ("The Connection shows")
- Test: `apps/server/test/waiting-push-api.test.ts`

**Interfaces:**
- Produces: inside the service, `unsentOf(conns: Connection[]): Promise<Map<string, string[]>>` (one query each for the
  Imports' outcomes, their live Dives and the pushes) used by `unsentDives`, `overview` and `offersOf`;
  `createdByMany(importIds: string[]): Promise<Map<string, { id: string; diverId: string }[]>>`.
  `conflicts.waiting(userId)` keeps its answer; it loads the entries, the held and chosen queue rows, the Dives and the
  pushes for all the User's Connections at once (the run per Connection stays, only for Connections with entries).

- [ ] **Step 1: Write the test** `it('lists two Connections with offers and Conflicts as one each would')`: two
  Connections of one User at two Providers (or two Divers), each with an offer of a different Import and one Conflict;
  `GET /api/connections` and `GET /api/imports` answer the same counts and Dives as asking per Connection did
  (assert the exact `unsentDives`, `lastFetch.conflicts` and offer `count`s).
- [ ] **Step 2:** Run — PASS expected (behaviour kept); it pins the answer before the rewrite.
- [ ] **Step 3: Implement** the batched loaders. The `lastFetch` description in `routes.ts` and the contract say: the
  last fetch whose Import finished; a fetch under way or failed doesn't replace it (Ruling, point 6). Regenerate the API
  client (`pnpm --filter @dive-hub/api-client generate`, as in [development.md](../../development.md)).
- [ ] **Step 4:** Run `waiting-push-api.test.ts`, `provider-conflicts.test.ts`, `push-runs.test.ts` — PASS; `pnpm check`.
- [ ] **Step 5: Commit** `Connections and Imports lists in a few queries; the last fetch is the last finished one (backlog 0010, point 7)`.

### Task 7: Module shape (point 8)

**Files:**
- Modify: `apps/server/src/providers/push-service.ts` (drop `waitingOf`, `deletingItself` from its answer),
  `waiting-push-service.ts` (add them), `apps/server/src/dives/routes.ts`, `apps/server/src/routes.ts`, `app.ts`,
  `worker.ts`, `main.ts`, any test that starts the worker
- Test: the existing ones

**Interfaces:**
- Produces: `waitingPushes.waitingOf(diveIds: string[])` and `waitingPushes.deletingItself(diveIds: string[])`, same
  answers as today's `pushes.*`; `DiveRouteDeps` gains `waitingPushes: WaitingPushService`;
  `startWorker(pool: pg.Pool, deps: { imports; siteImports; aiAccesses; assessments; pushRuns; waitingPushes; scheduledFetch; certifications; log })`.
  `push-service.ts`'s own `status` keeps calling the bare functions.

- [ ] **Step 1:** Move them; `grep -rn "pushes\.\(waitingOf\|deletingItself\)" apps/server` finds nothing.
- [ ] **Step 2:** `pnpm check` — green (no behaviour change; the existing route tests cover the answers).
- [ ] **Step 3: Commit** `WaitingPushService answers the queue's reads; startWorker takes one object (backlog 0010, point 8)`.

### Task 8: The order-dependent and flaky tests (point 9)

**Files:**
- Test: `apps/server/test/waiting-pushes.test.ts` (`:920`), `site-for-send.test.ts`, `apps/web/e2e/waiting-pushes.spec.ts` (`:321`)

- [ ] **Step 1:** `pnpm --filter @dive-hub/server exec vitest run test/waiting-pushes.test.ts -t "Retry makes a stopped entry due now"` —
  reproduce the failure alone. Find what it takes from earlier tests (use `superpowers:systematic-debugging`) and give
  the test its own setup; run it alone and with the file — PASS both.
- [ ] **Step 2:** `site-for-send.test.ts` (5 × `provider_busy`) and the e2e focus at `:321`: run each ten times
  (`--repeat-each=10` for Playwright, a shell loop for Vitest). A failure found: fix its cause (a lease or a focus wait
  the test doesn't await). None in ten: record that in the PR text and change nothing.
- [ ] **Step 3:** `pnpm check` (with `--tests waiting-pushes` for the browser test); commit
  `Tests: the Retry test stands alone; <what was found> (backlog 0010, point 9)`.

### Task 9: Missing tests (point 10)

**Files:**
- Test: `apps/server/test/waiting-pushes.test.ts`, `waiting-push-api.test.ts`, `apps/web/e2e/waiting-pushes.spec.ts`

- [ ] **Step 1: Write them.** Each should pass on today's code; one that fails is a bug: stop and report it.
  - `it('a refused create stops at once')` and `it('a refused update stops at once')` (a code outside `RETRIED`, as the
    refused-delete test does): `state: 'stopped'`, `attempts: 1`.
  - `decide`: `it('goes through the Connection of an open Conflict when there is no entry')` (the `open` branch),
    `it('falls back to the User\'s own Connection of the Diver')`, and a co-manager's decision `404 connection_not_found`
    (the API test, as `:203`).
  - Browser (`@dives`): `the logbook list shows a Dive as sent after its send` (no reload); `the row's fix link keeps
    from` (the URL after the link has `from=`). (`@account`): `the offer test starts the run` — extend
    `the offer of unsent new dives opens a Push run` (`:292`) to start it and see the run's page.
- [ ] **Step 2:** Run the files and `pnpm check --tests waiting-pushes` — PASS.
- [ ] **Step 3: Commit** `Tests: refused creates and updates, decide's branches, the logbook after a send, the fix link, the offer's run (backlog 0010, point 10)`.

### Task 10: Test nits (point 11)

**Files:**
- Test: `apps/server/test/provider-contract.ts` (`:110`), `migrations.test.ts`, `dive-deletion.test.ts`
  (`:334`, the cleanup in a test body), `dive-merging.test.ts` (`:349`), `waiting-pushes.test.ts` (`:542`, `:563`),
  the fetch-on-opening browser test (`waiting-pushes.spec.ts:360`)

- [ ] **Step 1:** Fix each as the backlog says: the contract test checks the dive import's `list` operation, not
  `!data.dives`; the migration test inserts through Drizzle or a full row; the clock moves forward only (no
  `Math.max(0, …)` skip that hides a negative; a test that needs an earlier time sets up its rows earlier); the cleanup
  moves to `afterEach`; the opening test navigates by a link or a reload, not only the hash.
- [ ] **Step 2:** Run the touched files and `pnpm check --tests waiting-pushes` — PASS.
- [ ] **Step 3: Commit** `Tests: tidy the contract, migration, clock, cleanup and opening tests (backlog 0010, point 11)`.

### Task 11: The backlog file, and finishing

**Files:**
- Modify: `docs/backlog/0010-provider-automation-follow-ups.md`, this plan's `status`

- [ ] **Step 1:** In the backlog file, strike point 3's PATCH item with the Ruling's reason, add the Rulings of points 4-6 under
  "Decided", and a line under "State": points 1-11 done on branch `automation-follow-ups`; 12-14 left (second plan). Status stays `draft`.
- [ ] **Step 2:** Final whole-branch review, then the `architecture-review` subagent; fixes per the fix loop (cap 5 rounds).
- [ ] **Step 3:** `pnpm check`; commit `Backlog 0010: points 1-11 done, the rulings`; push and open the PR (override 5).
  The PR body lists the Rulings and anything parked at the cap.
