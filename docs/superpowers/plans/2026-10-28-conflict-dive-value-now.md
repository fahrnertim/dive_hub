---
title: "Plan: a Conflict waits only while its two sides differ"
summary: Stored Conflict fields keep the Provider's comparable value; one read side in the conflict service says Dive Hub's side as the Dive is now and leaves out fields whose sides became equal, for the Dive's page, "Needs your decision" and a Push run's count. changedSinceSent does no Conflict work; a test pins a Recording's max depth when the Provider's isn't imported.
status: done
date: 2026-10-28
---

# A Conflict waits only while its two sides differ: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Conflict counts and shows only while a field still differs between the Dive now and the Provider's value as
the run found it, the same everywhere; plus PR #11's two other deferred minors.

**Architecture:** All in `apps/server/src/providers/`. The stored field gains `compared` (the Provider's `Comparable`
value and the site Source), written by the send and the import through one builder in `dive-changes.ts`. The read side
moves into `createConflictService` (`hubNow` from `push-service.ts`, `waitingByRun` from a bare function); push-service
and push-run-service take the service from `layer.ts`.

**Tech Stack:** TypeScript, Fastify + TypeBox, Drizzle on PostgreSQL, Vitest against a real PostgreSQL.

**Spec:** [docs/superpowers/specs/2026-10-28-conflict-dive-value-now-design.md](../specs/2026-10-28-conflict-dive-value-now-design.md)
(decisions 1–8). Background: [ADR 0056](../../decisions/0056-two-way-exchange-and-automation.md), PR #11.

## Global Constraints

- [ADR 0053](../../decisions/0053-module-boundaries.md): everything stays in the `providers` module; no new import across modules.
- [ADR 0056](../../decisions/0056-two-way-exchange-and-automation.md): how entries are written, closed and chosen, and the send's and import's comparison (`planSend`, `threeWay`, `held`) don't change.
- No migration, no `db/schema.ts` change: `provider_conflict.fields` is `jsonb`; only the TypeScript type of what goes in it grows.
- The API's field shape stays `{ field, hub, provider }`: `compared` never leaves the server (routes, `status.conflicts`, the send's `outcome: conflicts`).
- Tests against a real PostgreSQL, at most one `vi.fn`, no `vi.mock`.
- `pnpm check` green before each commit (`pnpm`, never `npm`).
- `karpathy-guidelines` (load it before Task 1): every changed line traces to a task; no extra abstraction or option.

## Review Focus

1. An entry stored before this change (no `compared`): still listed, compared by shown values (Task 2 test).
2. A Dive whose value field is no longer compared (it has a primary Recording): the field keeps waiting with the Dive's value now (Task 2: the existing `maxDepthM` entries in `provider-conflicts.test.ts` on a FIT Dive are this case).
3. The site, compared by its ID at the Source, not by name (Task 2 test in `ssi-target.test.ts`).
4. A run's count and "Needs your decision" agree after an edit to the Provider's value (Task 2 test in `push-runs.test.ts`).
5. `compared` leaking into an API answer (Task 1: `status.conflicts` and `outcome: conflicts` asserted with `toEqual`).

---

### Task 1: Stored fields carry the Provider's comparable value

**Files:**
- Modify: `apps/server/src/providers/conflicts.ts` (types; `record`, `entryOf` take and give the stored shape)
- Modify: `apps/server/src/providers/dive-changes.ts` (`hubOf` returns its `siteSource`; new `conflictFields`)
- Modify: `apps/server/src/providers/push-service.ts` (`shownOf` → `conflictFields`; the send's `outcome: conflicts` answer without `compared`)
- Modify: `apps/server/src/providers/dive-import.ts` (`waitForUser` builds with `conflictFields`)
- Test: `apps/server/test/ssi-target.test.ts` (the run's-conflict test, ~:405)

**Interfaces:**
- Produces, in `conflicts.ts`:
  ```ts
  /** A stored field: the shown values and, from 2026-10-28 on, the Provider's value as the comparison sees it. */
  export interface StoredConflictField extends ConflictField {
    compared?: { provider: Comparable[SyncedField]; siteSource: SiteSource | null };
  }
  ```
  `ConflictEntry.fields: StoredConflictField[]`; `entryOf` answers `fields: StoredConflictField[]`.
- Produces, in `dive-changes.ts`: `hubOf(...)` also returns `siteSource: SiteSource | null` (its parameter);
  `conflictFields(run: ProviderRun, fields: SyncedField[], here: { hub: Comparable; row: { siteId: string | null }; siteSource: SiteSource | null }, provider: Comparable): Promise<StoredConflictField[]>`
  (`hub`/`provider` shown as `shown` says them today; `compared.provider = provider[field]`), returned by `createDiveChanges`.

- [ ] **Step 1: Write the failing test.** In the run's-conflict test of `ssi-target.test.ts`, after the deferred send:
  ```ts
  const [stored] = await t.db.select().from(providerConflict).where(eq(providerConflict.diveId, id));
  expect(stored!.fields).toEqual([{ field: 'notes', hub: 'Reef here', provider: 'Reef in SSI', compared: { provider: 'Reef in SSI', siteSource: expect.anything() } }]);
  ```
  (`siteSource` is whatever the SSI dive's site Source is, e.g. `'ssi'`; pin the literal once known.) Keep the existing
  `toEqual` on `status(id).conflicts` and the `toMatchObject` on `outcome: 'conflicts'`; change the latter to `toEqual`
  on its `conflicts` (`[{ field: 'notes', hub: 'Reef changed', provider: 'Reef in SSI' }]`) so a leaked `compared` fails.
- [ ] **Step 2:** `pnpm --filter @dive-hub/server exec vitest run test/ssi-target.test.ts` — FAIL: no `compared`.
- [ ] **Step 3: Implement** the interfaces above; push-service's `shownOf` and `settle` use `conflictFields`, the
  `outcome: conflicts` answer maps to `{ field, hub, provider }`; `waitForUser` uses `conflictFields` (its merge with
  `isDeepStrictEqual` stays; an old entry without `compared` is rewritten once, which is fine). The import preview
  (~:584) is unchanged.
- [ ] **Step 4:** Same command — PASS; then `pnpm check`.
- [ ] **Step 5: Commit** `Conflicts: a stored field keeps the Provider's comparable value (design 2026-10-28, decision 2)`.

### Task 2: One read side: the Dive's value now, fields still differing

**Files:**
- Modify: `apps/server/src/providers/conflicts.ts` (service deps, `waitingByRun` into the service, the new check, header)
- Modify: `apps/server/src/providers/push-service.ts` (drop `hubNow`; `statusAt` asks the service)
- Modify: `apps/server/src/providers/push-run-service.ts` (`conflictsOf` uses the service)
- Modify: `apps/server/src/providers/layer.ts` (build the conflict service first; pass it on)
- Test: `apps/server/test/provider-conflicts.test.ts`, `apps/server/test/push-runs.test.ts`, `apps/server/test/ssi-target.test.ts`

**Interfaces:**
- Consumes: `StoredConflictField`, `conflictFields`, `hubOf(...).siteSource` (Task 1).
- Produces:
  ```ts
  createConflictService(deps: { db: Db; connections: ConnectionService; registry: ProviderRegistry; blobs: BlobStore }) => {
    waiting(userId: string): /* as today; entries' fields as below; an entry with no field left is not listed */;
    /** Per run id: how many entries carrying it still wait (the same check as `waiting`). */
    waitingByRun(runIds: string[]): Promise<Map<string, number>>;
    /** The Dive's entry about this remote dive at the adapter's Provider, its fields as below; null without one or with none left. */
    ofDive(userId: string, adapter: ProviderAdapter, conn: ConnectionRow | null, diverId: string, diveId: string, remoteId: string): Promise<ConflictField[] | null>;
  }
  createPushService(deps: { ...as today; conflicts: ConflictService })
  createPushRunService(deps: { ...as today; conflicts: ConflictService })
  ```
  The bare `waitingByRun` export goes away. `layer.ts`: `conflicts` is built before `pushes` and `pushRuns`.
- **The check (one private function, used by all three):** given the comparison's run and an entry that passed
  `stillWaits`, read the Dive once with `changes.hubOf(db, run, diveId, source, remoteSiteId)` where `source` and
  `remoteSiteId` come from the entry's `site` field's `compared` (else `null`). Per stored field: `hub` = `shown(...)` of
  the Dive now; drop it when
  - it has `compared` and the field is in `here.fields` and `same(field, { ...here.hub, [field]: compared.provider }, here.hub)`;
  - it has no `compared` and `JSON.stringify(hubShownNow) === JSON.stringify(stored.provider)`.
  A field not in `here.fields` stays (design decision 4). `hubOf` answering null: the stored fields stay as they are.
  Answer `{ field, hub, provider }` only. The run (`changes.runOf`) is built once per Connection (`waiting`, and per
  Connection in `waitingByRun`, which reads the connection rows of its entries); an entry whose Provider this instance
  no longer offers keeps today's cheap-check result.

- [ ] **Step 1: Write the failing tests.**
  - `provider-conflicts.test.ts`, new `it('says Dive Hub\'s value as the Dive is now, and leaves out a field whose sides became equal')`:
    record an entry with `[{ field: 'notes', hub: 'Turtle', provider: 'Manta', compared: { provider: 'Manta', siteSource: null } }]`;
    PATCH the Dive's notes to `'Reef'` → listed `fields: [{ field: 'notes', hub: 'Reef', provider: 'Manta' }]` (`toEqual`);
    PATCH to `'Manta'` → `connections` is `[]`; `GET /api/connections` shows that Connection's `conflicts: 0`.
  - same file, `it('an entry stored without comparable values compares the shown ones')`: the existing `fields('Manta')`
    entry (no `compared`); notes `'Manta'` on the Dive → the `notes` field is gone, `maxDepthM` stays (not compared:
    the FIT Dive has a Recording) with `hub` the Dive's max depth now.
  - Existing tests in this file that assert `hub: 'Turtle'` / `hub: 18`: they now get the Dive's values now; update the
    expectations to those (the Dive's notes and max depth), not the code.
  - `push-runs.test.ts`, new `it("an edit to the Provider's value ends the Conflict: not listed, its run counts 0")`:
    `runWithConflict()`, then edit the Dive's notes to `'Reef in SSI'` → the run's `conflicts` is 0 (both `run(second.id)`
    and `GET /api/push-runs`), and `/api/provider-conflicts` has no entry for the Dive.
  - `ssi-target.test.ts`, in the run's-conflict test after "Edited again here": `patch(id, { notes: 'Reef in SSI' })` →
    `status(id).conflicts` is `null`; then set it back to `'Reef changed'` so the rest of the test runs as before.
  - `ssi-target.test.ts`, new `it('a site Conflict ends when the Dive is moved to the site with the Provider\'s ID')`: a
    deferred run send whose stored entry has a `site` field (provoke it as the notes one is, with two SSI sites known to
    the test's fake SSI); move the Dive to the site whose SSI ID is the Provider's → `status(id).conflicts` is `null` and
    the entry isn't listed; to another site → listed with that site's name under `hub`.
- [ ] **Step 2:** `pnpm --filter @dive-hub/server exec vitest run test/provider-conflicts.test.ts test/push-runs.test.ts test/ssi-target.test.ts` — the new tests FAIL (old fields shown, entries still counted).
- [ ] **Step 3: Implement** the interfaces and the check. `statusAt` calls `conflicts.ofDive(...)` when there is a
  current remote dive; `push-run-service`'s `conflictsOf` calls `conflicts.waitingByRun`. Rewrite `conflicts.ts`'s
  header: whether an entry waits is worked out on reading from three checks (Dive live, remote dive current, a field
  still differs); the send and import write through the bare functions; the service is the one read side.
- [ ] **Step 4:** Run the three files — PASS; `pnpm check`.
- [ ] **Step 5: Commit** `Conflicts: one read side says the Dive's value now and waits only while a field differs (design 2026-10-28, decisions 1, 3-5)`.

### Task 3: changedSinceSent does no Conflict work

**Files:**
- Modify: `apps/server/src/providers/push-service.ts` (`statusAt`, `changedSinceSent`)
- Test: `apps/server/test/changed-since-sent.test.ts` (existing; unchanged)

- [ ] **Step 1:** `statusAt(userId, provider, loaded, { conflicts: false })` skips `conflicts.ofDive` (answers
  `conflicts: null`); `changedSinceSent` passes it. No other caller changes. (Refactor without new behaviour: the
  existing tests are the check; no new test.)
- [ ] **Step 2:** `changed-since-sent.test.ts`, `dive-list-rows.test.ts`, `ssi-target.test.ts` — PASS; `pnpm check`.
- [ ] **Step 3: Commit** `changedSinceSent: no Conflict work per Dive (PR #11 deferred minor)`.

### Task 4: A Recording's max depth when the Provider's isn't imported

**Files:**
- Test: `apps/server/test/ssi-dive-import.test.ts` ("a field the Provider does not import, on a new Dive")

- [ ] **Step 1: Write the test** `it("takes the profile's deepest point when the Provider's max depth isn't imported but its profile is")`:
  `importedWithout('ssi_no_max_depth', ['maxDepthM'], (base) => ({ ...base, odin_user_log_depth_m: 30 }))` (the
  profile's samples stay as `computerDive` makes them, deepest 22 m); assert `rec.maxDepthM` equals the deepest value of
  the Recording's stored `depth` series and is not 30. Extend `importedWithout`'s answer with the series values if needed.
- [ ] **Step 2:** Run it — PASS expected (the code is from PR #11). If it fails, stop and report: the code is wrong, not the test.
- [ ] **Step 3: Commit** `Test: a Recording takes the profile's max depth when the Provider's isn't imported (PR #11 deferred minor)`.

### Task 5: API text, client contract, the design's status

**Files:**
- Modify: `apps/server/src/providers/routes.ts` (~:281 `status.conflicts`, ~:821 `fields` of `GET /api/provider-conflicts`)
- Modify: `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts` (`pnpm --filter @dive-hub/api-client generate`)
- Modify: `docs/spec/clients.md` (~:544 `status.conflicts`, ~:717 "Conflicts with a Provider")
- Modify: this plan's and the design's frontmatter `status` (`done`)

- [ ] **Step 1:** Both descriptions and both contract paragraphs say: `hub` is the Dive's value now, `provider` the
  Provider's as the run found it; a field whose two values became equal is left out, and an entry with none left is
  neither listed nor counted (in the Connection's and the run's `conflicts`). Remove "both as the run found them".
- [ ] **Step 2:** Regenerate the API client; `pnpm check`.
- [ ] **Step 3: Commit** `API and contract: a Conflict shows the Dive's value now and ends when both sides agree (design 2026-10-28, decision 8)`.

### Finish

- [ ] Final whole-branch review, then the `architecture-review` subagent; fixes per the fix loop (cap 5 rounds).
- [ ] Push and open the PR (override 5); its body lists the rulings parked at the cap, if any.
