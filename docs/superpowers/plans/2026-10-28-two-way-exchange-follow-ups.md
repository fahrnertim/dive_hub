---
title: "Plan: tidy the two-way exchange with a Provider (backlog 0002)"
summary: The seven follow-ups of backlog 0002 - a run counts only the Conflicts that still wait, the Dive's page shows the Dive's current value beside the Provider's as found, a Recording from a Provider honours the import directions of its depth and temperature values, the conflicts body is derived from SYNCED_FIELDS, provider_conflict gets an index on run_id and the run's report says an entry belongs to the latest run, two browser tests, and the conflicts module says why the send uses its bare functions.
status: active
date: 2026-10-28
---

# Tidy the two-way exchange: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every point of [backlog 0002](../../backlog/0002-two-way-exchange-follow-ups.md) is done, with a test where behaviour changes.

**Architecture:** Server changes stay inside `apps/server/src/providers/` (conflicts, push-run-service, push-service,
dive-import, routes) plus one index in `db/schema.ts` with its generated migration. The web gets one changed text and two
browser tests; the e2e server one optional parameter.

**Tech Stack:** TypeScript, Fastify + TypeBox, Drizzle 0.45 on PostgreSQL, Vitest against a real PostgreSQL, React, Playwright.

**Spec:** [backlog 0002](../../backlog/0002-two-way-exchange-follow-ups.md) (its "Decided" section holds the owner's
answers), [ADR 0056](../../decisions/0056-two-way-exchange-and-automation.md), [client contract](../../spec/clients.md).

## Global Constraints

- [ADR 0053](../../decisions/0053-module-boundaries.md): code stays in the `providers` module; no new import across modules.
- Don't change `three-way.ts`'s plan, the SSI adapter, or `docs/decisions/` (backlog "Don't").
- Point 2 (owner): recompute the Dive Hub side on read; the Provider side stays as the run found it.
- Point 5 (owner): keep the upsert; an entry belongs to the latest run that found it; the run's report says so in its text.
- Tests against a real PostgreSQL, at most one `vi.fn`, no `vi.mock`; browser tests carry an area tag (`@dives`).
- UI words in `apps/web/src/i18n/locales/en.json` and `de.json`. A new API duty updates `docs/spec/clients.md`.
- `db/schema.ts` and migrations are protected paths: the edit asks the owner (hook).
- `pnpm check` green before each commit.

## Review Focus

1. A Dive with a run's entry that the User edits again: the Dive's page shows the new value, the Provider's unchanged (Task 2 test).
2. A soft-deleted Dive with an entry: the run's count drops to 0 (Task 1 test).
3. An entry a later send closed: its run counts 0 (Task 1 test, point 5's missing test).
4. A Provider that imports a profile but not the max depth: the Recording's max depth comes from the profile, not the Provider's value (Task 3 note: the profile-derived fallback stays).
5. A Dive whose site was removed here while its entry is on `site`: the Dive Hub side shows null (covered by `shown` with no site; no extra test).

---

### Task 1: A run counts only the Conflicts that still wait (points 1, 5 test)

**Files:**
- Modify: `apps/server/src/providers/conflicts.ts` (a shared "still waits" check; a new export)
- Modify: `apps/server/src/providers/push-run-service.ts:230-238` (`conflictsOf` uses it)
- Test: `apps/server/test/push-runs.test.ts` (the test "a run sends a Dive with a conflict without that field…")

**Interfaces:**
- Produces: `export async function waitingByRun(q: Db | Tx, runIds: string[]): Promise<Map<string, number>>` in
  `conflicts.ts`: per run id, the entries carrying it whose Dive is not deleted and whose `remoteId` and `connectionId`
  are the Dive's current remote dive at that Provider (`currentRemote` of the Dive's pushes, newest first). The same
  check is used by `createConflictService().waiting` (one private function, e.g. `stillWaits(entry, dive, pushes)`).

- [ ] **Step 1: Extend the test.** After `expect(... second.id)!.conflicts).toBe(1)`, add two cases on the same run:
  - soft-delete the Dive (`DELETE /api/dives/{id}` as the test's `call` does), `expect((await run(second.id)).conflicts).toBe(0)`;
    restore it if the API offers it, otherwise put this case last.
  - In a second new test (`"an entry a later send closed counts 0 in its run"`): same setup up to the second run, then
    send the Dive from its page with `{ conflicts: { notes: 'hub' } }` and `expect((await run(second.id)).conflicts).toBe(0)`.
- [ ] **Step 2:** `pnpm --filter @dive-hub/server exec vitest run test/push-runs.test.ts -t conflict` → the deleted case FAILS (counts 1); the closed case passes already (it pins point 5's missing test).
- [ ] **Step 3:** Implement `waitingByRun` and use it in `conflictsOf` (keep `conflictsOf`'s name and map shape); `waiting` uses the shared check.
- [ ] **Step 4:** Rerun Step 2's command → PASS; then `test/provider-conflicts.test.ts` → PASS.
- [ ] **Step 5:** `pnpm check`, commit "Push runs: a run counts only the Conflicts that still wait (backlog 0002)".

### Task 2: The Dive's page shows the Dive's current value (point 2)

**Files:**
- Modify: `apps/server/src/providers/push-service.ts` (`statusAt`, ~:404)
- Modify: `apps/server/src/providers/routes.ts:283-286` (the `conflicts` description)
- Modify: `docs/spec/clients.md` (the `status.conflicts` bullet, ~:544)
- Test: `apps/server/test/ssi-target.test.ts` ("a run's conflict: sent without the field, an entry waits…")

**Interfaces:**
- Consumes: `changes.runOf`, `changes.hubOf(db, run, diveId, null)`, `changes.shown(run, field, here.hub, here.row.siteId)` (dive-changes.ts).
- Produces: `status.conflicts[i].hub` is the Dive's value now; `provider` stays the stored one.

- [ ] **Step 1: Extend the test.** After the first `status(id)` conflicts assertion, `await patch(id, { notes: 'Reef changed' })` and
  `expect((await status(id)).conflicts).toEqual([{ field: 'notes', hub: 'Reef changed', provider: 'Reef in SSI' }])`; the
  following send-and-choose steps then expect `hub: 'Reef changed'` where they named `'Reef here'` on the Dive's page.
- [ ] **Step 2:** `pnpm --filter @dive-hub/server exec vitest run test/ssi-target.test.ts -t "run's conflict"` → FAIL (hub `'Reef here'`).
- [ ] **Step 3:** In `statusAt`, when the entry is about the current remote dive, map its fields to
  `{ field, hub: await changes.shown(run, field, here.hub, here.row.siteId), provider }`, with `run` from `changes.runOf`
  (the Dive's Diver, the Connection's id/mode/window when there is one, else `null`/`'off'`/`0`; `choices: {}`; context
  `{ people: [], sites: {} }`: the hub side never reads it) and `here` from `changes.hubOf(db, run, row.id, null)`.
  A short private helper (`hubNow`) keeps `statusAt` readable.
- [ ] **Step 4:** Step 2's command → PASS; whole `ssi-target.test.ts` → PASS.
- [ ] **Step 5:** Description: "…Dive Hub's value (`hub`) is the Dive's now, the Provider's (`provider`) as the run found it…"; the contract bullet says the same.
- [ ] **Step 6:** `pnpm check`, commit "Dive's page: a waiting Conflict shows the Dive's value now (backlog 0002)".

### Task 3: A Provider's Recording honours its import directions (point 3)

**Files:**
- Modify: `apps/server/src/providers/dive-import.ts` (`asRecording`, ~:301-330)
- Test: `apps/server/test/ssi-dive-import.test.ts` (new test next to "a field the Provider does not import, on a new Dive")

- [ ] **Step 1: Write the failing test** `"leaves the Provider's depth and temperatures out of the Recording where it doesn't import them"`:
  as the neighbouring test, an `ssi_no_values` adapter importing every `DIVE_FIELDS` entry except `maxDepthM`, `avgDepthM`,
  `waterTemperatureC`, `maxTemperatureC` and `profile`; the computer dive with `odin_user_log_watertemp_c: 24`,
  `odin_user_log_watertemp_max_c: 26`, `odin_user_log_avg_depth_m: 12`. Assert on the Recording row:
  `summary` has no `minTemperatureC` nor `maxTemperatureC`, and `maxDepthM`, `avgDepthM` are null.
- [ ] **Step 2:** `pnpm --filter @dive-hub/server exec vitest run test/ssi-dive-import.test.ts -t "depth and temperatures"` → FAIL.
- [ ] **Step 3:** In `asRecording`, the Provider's `maxDepthM`, `avgDepthM`, `waterTemperatureC` (summary `minTemperatureC`)
  and `maxTemperatureC` count only when `importsField(run, <that field>)`; the profile-derived fallback (min/max of the
  temperature series, max of the depth series) stays, as those series are only there when `profile` imports.
  (`avgDepthM` has the same gap as the three named in the backlog; fixed alongside.)
- [ ] **Step 4:** Step 2's command → PASS; whole file → PASS.
- [ ] **Step 5:** `pnpm check`, commit "Provider import: a Recording's depth and temperatures follow the import directions (backlog 0002)".

### Task 4: The conflicts body from `SYNCED_FIELDS`, the run's index and text, the module's way in (points 4, 5, 7)

**Files:**
- Modify: `apps/server/src/providers/routes.ts:238-246` (`ConflictChoices`)
- Modify: `apps/server/src/db/schema.ts:1044` (index), generate `apps/server/drizzle/0043_*.sql` with `pnpm --filter @dive-hub/server db:generate`
- Modify: `apps/web/src/i18n/locales/en.json` / `de.json` (`pushRun.conflicts_one/_other`, :1194-1195), `docs/spec/clients.md` (~:594-597)
- Modify: `apps/server/src/providers/conflicts.ts` (header comment)

- [ ] **Step 1:** `ConflictChoices = Type.Object(Object.fromEntries(SYNCED_FIELDS.map((f) => [f, Type.Optional(ConflictChoice)])) as Record<SyncedField, TOptional<typeof ConflictChoice>>, { …same options })`; the existing tests that send `conflicts` stay green (no behaviour change; typecheck proves `request.body.conflicts` keeps its type).
- [ ] **Step 2:** `index('provider_conflict_run_idx').on(t.runId)`; generate; the SQL is one `CREATE INDEX "provider_conflict_run_idx" ON "provider_conflict" USING btree ("run_id");`.
- [ ] **Step 3:** Report text, en: `"{{count}} dive has values changed in both places: it waits in Needs your decision. A dive a later run finds again counts in that run."` (and `_other`: `"… they wait … A dive a later run finds again counts in that run."`); de: `"… Ein Tauchgang, den ein späterer Lauf wieder findet, zählt in jenem Lauf."`. Contract: replace "one another run found again …" wording with "an entry belongs to the latest run that found it, so an earlier run's count drops; say so in the report". `push-run-routes.ts:36` description says the same.
- [ ] **Step 4:** Header comment of `conflicts.ts`: the send uses the bare functions because it records and closes inside the send's own flow with any `Db | Tx` (a transaction where it has one); the service is the routes' read side, which needs the Connections.
- [ ] **Step 5:** `pnpm check` (runs the migration on the test database), commit "Conflicts: body from SYNCED_FIELDS, index on run_id, an entry belongs to its latest run (backlog 0002)".

### Task 5: Browser tests for the deferred notice and the Send while a send waits (point 6)

**Files:**
- Modify: `apps/server/test/e2e-server.ts` (`/e2e/fake-ssi/dive` takes an optional `site: FakeSsiSite`, pushed to `fakeSsi.sites` when its id is not there)
- Modify: `apps/web/e2e/support.ts` (`editAtSsi` passes an optional `site`), `apps/web/e2e/provider-conflicts.spec.ts`

- [ ] **Step 1:** Test `"a site changed in SSI's app to one Dive Hub doesn't know stays as SSI has it, and the page says so"` (`@dives`):
  `sentWithNotes(request, 'Reef')`, then `editAtSsi(request, id, { odin_user_log_dive_sites_id: 4410 }, { odin_dive_sites_id: 4410, odin_dive_sites_name: 'Elphinstone', odin_dive_sites_lat: 25.31, odin_dive_sites_lon: 34.86, odin_countries_code_iso: 'EG' })`,
  edit the notes here (`editElsewhere`) so an update is offered, press "Update in SSI", expect the text of `provider.deferred`
  with "site" visible in `#main`; `finally` `leaveConflict`.
- [ ] **Step 2:** Test `"while the choice is being sent, Send with these choices can't be pressed again"` (`@dives`):
  `conflictAtSsi`, hold the POST with `page.route('**/api/dives/*/providers/ssi', …)` until released, press "Update in SSI",
  then "Send with these choices"; expect that button `toBeDisabled()` (React Aria `isPending`), release the route, expect
  "Up to date"; exactly one more Push (`status().pushes`); `finally` `leaveConflict`.
- [ ] **Step 3:** `pnpm --filter @dive-hub/web test:e2e e2e/provider-conflicts.spec.ts` → both new tests PASS (they pin
  existing behaviour; if one fails, the behaviour is the bug: debug with superpowers:systematic-debugging).
- [ ] **Step 4:** `pnpm check`, commit "e2e: the deferred notice and the Send while a send waits (backlog 0002)".

### Finish

- [ ] Backlog 0002: `status: done`, each point marked done.
- [ ] `architecture-review` subagent on the branch; fix findings with `path:line` and a rule.
- [ ] `pnpm check` green, push, open a PR.
