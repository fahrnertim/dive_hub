---
title: "Plan: two-way with conflict handling (piece 3 of the SSI app alignment)"
summary: Piece 3 of the SSI app alignment design - the send to a Provider becomes three-way like the import (a change made only at the Provider comes back, a removal is a change both ways, tank and lead included), a Conflict on the Dive's page is asked there before anything is sent, a Conflict in a Push run is sent around and waits in "Needs your decision" as a stored entry per Dive and Connection; the Provider's per-field directions govern every direction; two checks on the owner's account (does SSI clear a key sent empty; a change made in SSI's app survives a send).
status: ready
date: 2026-10-24
---

# Two-way with conflict handling: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A send from Dive Hub never overwrites what the User changed in the Provider's app, and a removal reaches the
other side in both directions. Today an update puts Dive Hub's non-empty values over SSI's record, and an empty value
leaves SSI's (`ssi-record.ts`, "On an update, null leaves SSI's value").

**Architecture:** The pure comparison in `three-way.ts` learns removals and gets `planSend`, which turns base,
Provider, hub, the User's choices and the open entry into what to take, send, clear and leave. The import's database
helpers for that comparison (`baseOf`, `hubOf`, `takeChanges`, `fill`, `shown`) move out of `dive-import.ts` into
`dive-changes.ts`. The push service then calls them on an update without importing the import, so ADR 0053's no-cycles
rule holds. An adapter gets `current(remoteId)` (the record its update reads anyway) and `update(…, leave)`
(fields to keep as the Provider has them and fields to clear). Stored Conflicts live in a new table
`provider_conflict`, shown like gone dives.

**Tech Stack:** TypeScript (ESM, Node), Fastify + TypeBox, Drizzle on PostgreSQL, vitest against a real PostgreSQL,
the fake SSI (`apps/server/test/fake-ssi.ts`, and `/e2e/fake-ssi/*` in `test/e2e-server.ts`), React + React Aria,
Playwright, tsx for the check script.

**Spec:** [docs/superpowers/specs/2026-10-23-ssi-app-alignment-design.md](../specs/2026-10-23-ssi-app-alignment-design.md):
"Exchange", the Architecture row for piece 3, piece 3 in "The pieces, in order", and **"Piece 3, settled 2026-10-24"**
(this plan's main source). [ADR 0056](../../decisions/0056-two-way-exchange-and-automation.md) (proposed, amended
2026-10-24). Background: [ADR 0030](../../decisions/0030-importing-dives-from-providers.md) (the import's three-way),
[ADR 0051](../../decisions/0051-dives-gone-at-a-provider.md) (gone dives: the model for stored entries),
[ADR 0047](../../decisions/0047-push-runs.md), the [values checks](../../research/2026-10-24-ssi-values-checks.md).

## Global Constraints

- Module rules of [ADR 0053](../../decisions/0053-module-boundaries.md): routes → services → db, **no cycles (not even
  through a type import)**, imports between modules only as `MODULE_IMPORTS` in `.dependency-cruiser.cjs` allows. Today
  `dive-import.ts` imports `push-service.ts`. `push-service.ts` must therefore never import `dive-import.ts`. Task 2
  sets up the files that make that possible.
- No `odin_*` key outside `apps/server/src/providers/ssi/` and its tests ([ADR 0027](../../decisions/0027-providers-as-adapters.md)).
  Conflict handling is generic: nothing in `push-service.ts`, `dive-changes.ts`, `conflicts.ts` or `three-way.ts` names SSI.
- The User-Agent stays `Dart/3.12 (dart:io)` ([ADR 0049](../../decisions/0049-ssi-app-user-agent.md)). Nothing logs a URL, a token or a password.
- **Protected paths ask the owner:** migrations and `db/schema.ts` (Task 5), `docs/decisions/**` (none planned: ADR 0056's
  amendment is written). A task that would change an accepted ADR beyond ADR 0056's amendment stops with `STOP: <reason>`.
- ADR 0056's amendment changes ADRs 0031 and 0045's "never removes". Tests that pin "never removes" for tank and lead
  (`three-way.test.ts:65`, `:74`; `ssi-dive-import.test.ts:432`, `:472`) are rewritten to the new rule. They are not deleted,
  and their new names cite ADR 0056. The site's "never cleared by the Provider" (ADR 0030) stays and keeps its tests.
- Word: **Conflict** ([glossary](../../glossary.md)), in code (`conflicts`, `provider_conflict`), API and UI. The design's "clash" is the same thing.
- Tests never reach SSI. Tests come first. At most one `vi.fn` per test, no `vi.mock`. Database tests run against the
  real PostgreSQL, as `changed-since-sent.test.ts` does. Every browser test has an area tag (`@dives`).
- Commands: one server file with `pnpm --filter @dive-hub/server exec vitest run test/<file>.test.ts`; one browser file
  with `pnpm --filter @dive-hub/web test:e2e e2e/<file>.spec.ts`; before each commit `pnpm check` (green); before a push
  `pnpm check:full`; a migration with `pnpm --filter @dive-hub/server db:generate` (never `drizzle-kit push`).
- A new web component's file name goes into the `@dives` pattern in `scripts/check-lib.mjs` (`AREAS`). A new state gets
  a case in `e2e/ui-quality.spec.ts`. UI words in `apps/web/src/i18n/locales/en.json` and `de.json`. The client contract
  ([clients.md](../../spec/clients.md)) changes in the task that changes the API.
- The rules (from the design's "Piece 3" section):
  - Per field against the base (the newer of the last import's Original and the last sent payload, `baseOf`):
    changed only here → sent; changed only at the Provider → taken (Revision cause `update`, "Updated from its source");
    changed on both sides differently → a Conflict.
  - **A removal is a change.** Removed here, unchanged there → cleared at the Provider. Removed there, unchanged here →
    removed here. Removed on one side and changed on the other → a Conflict. Removed on both → nothing.
  - Exceptions: `site` is never cleared by the Provider. A Provider without a site leaves the site here, and the send
    sends it again. Values from a Recording (`VALUE_FIELDS` on a Dive with a Primary recording) are send-only.
    Tank and lead take a removal at the Provider: the Dive's one Cylinder or its one Lead entry is removed, unless a
    Recording brought it (a Cylinder with `recordingId`). A Dive with two or more Cylinders or Lead entries doesn't compare
    that field (as today).
  - **No base** (a Dive linked and never imported): Dive Hub's values go out as today, and a field empty here is filled
    from the Provider's record. No Conflict, no clear.
  - **Dive's page:** a Conflict without a choice → nothing is sent, the answer lists the Conflicts. The User chooses per
    field, "keep Dive Hub's" preselected as in the import preview, and sends again with `conflicts`.
  - **Push run:** a Conflict → the Dive is sent without that field (it stays as the Provider has it). One entry per Dive
    and Provider waits in "Needs your decision", and the run's report counts them.
  - **An open entry:** each of its fields is a Conflict while the two sides differ, whatever the base says. A
    successful send that settles them deletes the entry. A Push run leaves them out again.
  - Resolving on the Review page is the Dive page's send with choices (no route of its own).
  - The Provider's `dives.fields` governs every direction. A field without `import` is never taken or filled, and never
    becomes part of a Recording made from the Provider. A field without `export` is left as the Provider has it on an update.
- Owner's account: the token is kept in `samples/private/ssi/` (the owner signs in with `round-trip.ts read` in their own
  terminal). Before running a check mode, announce it in one line: the mode and what it writes. Test dives are dated in
  2000 and noted "Dive Hub test", and they are deleted afterwards. The password never reaches an agent.

## Review Focus

1. **A send retried after a sign-in** (`withAccess` reruns the action on `signed_out`) after it already took SSI's notes:
   the retry takes nothing twice and writes one Revision. The taken field now equals SSI's. Test in Task 6.
2. **SSI's own rounding** (duration kept in whole minutes, depth to 0.1 m, a text with trailing spaces) is neither a
   change, a removal nor a Conflict on the send, as on the import. Test in Task 1 (`planSend`).
3. **A stale choice:** `conflicts` naming a field that is no Conflict any more (the other side changed back) is ignored
   rather than overriding a change made only at the Provider. Test in Task 1.
4. **An entry that no longer applies:** its Dive is deleted, or its remote dive is not the Dive's current one any more
   (deleted at SSI, sent anew). It is not listed and blocks nothing, as gone dives are worked out on reading. Test in Task 5.
5. **Another User's Connection** or Dive: its entries are never listed, and a send with `conflicts` for it is refused
   as any send is. Test in Task 5.

Known consequence (my call, said in the finish summary): a Dive whose Conflict waits after a Push run shows as up to
date at SSI, because the run's Push records the fingerprint of what it sent. Its entry in "Needs your decision" and on
the Dive's panel says what still differs.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `apps/server/test/fixtures/ssi/round-trip.ts` | modify | modes `clear start/finish` (Task 0) and `twoway start/send/finish` (Task 9) |
| `apps/server/src/providers/three-way.ts` | modify | removals in `threeWay` (`clear`), `planSend`, `SendPlan` |
| `apps/server/src/providers/remote-state.ts` | create | `currentRemote`, `fingerprintNow`, `PushRow` (moved from push-service.ts) |
| `apps/server/src/providers/dive-changes.ts` | create | `ProviderRun`, `runOf`, `sitesOf`, `baseOf`, `hubOf`, `changesOf`, `takeChanges`, `fill`, `shown` (moved from dive-import.ts) |
| `apps/server/src/providers/dive-import.ts` | modify | uses dive-changes.ts; `fields` governs fill and `asRecording` |
| `apps/server/src/dives/cylinders.ts`, `dives/weighting.ts` | modify | `mergeProviderCylinder` / `mergeProviderLead` take `null` with `'take'` as a removal |
| `apps/server/src/providers/provider.ts` | modify | `DiveExportAction.current`, `update(…, leave)`, `Leave` |
| `apps/server/src/providers/ssi/ssi-record.ts`, `ssi-adapter.ts`, `ssi-dive-type.ts` | modify | keys per field, keep and clear on an update; `current`; one number parser |
| `apps/server/src/db/schema.ts`, `apps/server/drizzle/0039_provider_conflict.sql` | modify / create | table `provider_conflict` (protected) |
| `apps/server/src/providers/conflicts.ts` | create | the stored entries: `record`, `openFields`, `close`, `waiting` |
| `apps/server/src/providers/push-service.ts` | modify | the three-way update, `SendOptions`, result `conflicts`, `status.conflicts` |
| `apps/server/src/providers/push-run-service.ts` | modify | `onConflict: 'defer'`, the report's count |
| `apps/server/src/providers/routes.ts`, `push-run-routes.ts` | modify | send body `conflicts`, outcome `conflicts`, `GET /api/provider-conflicts`, run report `conflicts` |
| `apps/web/src/ProviderPanel.tsx`, `ProviderConflicts.tsx` (new), `ProviderConflictsSection.tsx` (new), `ReviewPage.tsx`, `ReviewStrip.tsx`, `PushRun.tsx`, `lib/providers.ts` | modify / create | asking on the Dive's page, the Review section and strip line, the run report line |
| `docs/spec/clients.md`, `docs/spec/architecture.md`, `docs/references/ssi-app-api.md`, `docs/glossary.md`, `docs/research/…` | modify / create | contract, behaviour, [T] results, the Conflict entry |

---

### Task 0: Check on the owner's account: does SSI clear a key sent empty?

Runs first: Task 4's encoding of a cleared field depends on it. Only the check script and docs change.

**Files:**
- Modify: `apps/server/test/fixtures/ssi/round-trip.ts` (mode `clear`, its line in the header comment)
- Create: `docs/research/<date of the run>-ssi-clearing-keys.md`; modify `docs/index.md` (research list)

**Interfaces:**
- Produces, for Task 4: per key, which empty value SSI stores as empty. The note's table is
  `key | sent null | sent "" | sent 0 | result`, for `odin_user_log_comment`, `_weight_kg`/`_lb`, `_tank_vol_l`/`_cuft`,
  `_pressure_start_bar`/`_end_bar`/`_psi`, `_var_tanktype_id`, `_avg_depth_m`/`_ft`, `_watertemp_c`/`_f`.

- [ ] **Step 1: Add `clear start | clear finish`.** `start` creates one dive dated 2000-01-03 10:00 at `SSI_SITE_ID`,
  noted "Dive Hub test", with lead 6 kg, a 12 L steel tank 200 → 50 bar, average depth 8 m and water 20 °C. It then makes
  up to three updates through the client's save, each taking SSI's current record (as `updateRecord` does):
  - first with the keys above set to `null`;
  - then, for keys still stored, with `""` for text and `0` for numbers.
  After each update it reads the logbook and prints, per key, what SSI stored. It never prints other dives. `finish`
  deletes the dive and confirms it is gone.
- [ ] **Step 2: Run** `pnpm check` (the script compiles in the typecheck).
- [ ] **Step 3: Announce and run** `clear start` with the kept token: "Check: creates one test dive dated 2000-01-03 at
  SSI, updates it up to three times to empty values, then deletes it". If the token has expired, the owner runs
  `round-trip.ts read` first. Then run `clear finish`. If the dive stays, give the owner its ID to delete in the app.
- [ ] **Step 4: Write the research note** (`status: done`), with [T] per key and app version 5.0.43, and link it from
  `docs/index.md`. If a key keeps its value whatever is sent, the note says so: Task 6's "not removable" path then applies to its field.
- [ ] **Step 5: Commit** "SSI check: which empty values clear a key on an update" (script and docs only).

### Task 1: The comparison learns removals and plans a send

**Files:**
- Modify: `apps/server/src/providers/three-way.ts`
- Test: `apps/server/test/three-way.test.ts`

**Interfaces:**
- Produces, in `three-way.ts`:
  - `threeWay(fields, base, provider, hub)` returns `{ take, conflicts, clear }: Record<'take' | 'conflicts' | 'clear', SyncedField[]>`.
    `clear` holds the fields removed here (hub empty, base not, Provider same as base). `take` now also holds removals
    at the Provider (Provider empty, base not, hub same as base), except `site`. "Empty" is `null`, or `[]` for `buddies`.
    The existing guard "where Dive Hub never saw a tank or weight there, the one here stays" stays (base `null`).
  - `type Choice = 'hub' | 'provider'`.
  - `interface SendPlan { take: SyncedField[]; clear: SyncedField[]; keep: SyncedField[]; conflicts: SyncedField[] }`.
    `keep` means left as the Provider has it in this send. `conflicts` is non-empty only with `onConflict: 'ask'`.
  - `planSend(input: { fields: readonly SyncedField[]; base: Comparable | null; provider: Comparable; hub: Comparable; choices: Partial<Record<SyncedField, Choice>>; open: readonly SyncedField[]; onConflict: 'ask' | 'defer' }): SendPlan`.
    Rules, in this order:
    - `base` null: `take` = fields empty here and not empty at the Provider; nothing else.
    - A field in `open`: nothing if `same(provider, hub)`. Otherwise the choice: `provider` → `take`, `hub` → `clear` if
      empty here, else sent (in no list). Without a choice: `conflicts` (ask) or `keep` (defer).
    - Other fields: `threeWay`'s `take` and `clear` as they are. Its `conflicts` are resolved by choice as above, else go
      to `conflicts`/`keep`. A choice for a field that is no Conflict is ignored.

- [ ] **Step 1: Write the failing tests** in `three-way.test.ts`:
  - "a note removed here is cleared at the Provider" (base `notes: 'X'`, Provider `'X'`, hub `null` → `clear: ['notes']`).
  - "a note removed at the Provider is removed here" (`take: ['notes']`); "removed on both sides is nothing";
    "removed here and changed there is a conflict".
  - "a tank or lead removed at the Provider is removed here (ADR 0056 amends 0031 and 0045)": these replace the two
    "never removes" tests at `:65` and `:74`. Their second half ("where Dive Hub never saw one there, the one here stays") is kept.
  - "the site is never cleared by the Provider" (Provider `site: null` → neither `take` nor `conflicts`).
  - `planSend`: "without a base, Dive Hub's values go out and empty ones are filled" (hub `notes: null`, Provider `'Y'` →
    `take: ['notes']`; hub `lead: 6`, Provider `8` → no list holds `lead`).
  - "a conflict without a choice is asked, or kept in a run" (`ask` → `conflicts: ['notes']`; `defer` → `keep: ['notes']`).
  - "choices settle a conflict: provider is taken, hub is sent or cleared".
  - "an open field is a conflict while the sides differ, whatever the base says" (base = Provider = `'Y'`, hub `'X'`,
    `open: ['notes']` → `conflicts: ['notes']`); "an open field whose sides agree is nothing".
  - Review Focus 2: "SSI's rounding is no change": Provider `durationSeconds` 3600 against base and hub 3630 gives every
    list empty; the same for notes `'X '` against `'X'`.
  - Review Focus 3: "a stale choice is ignored": `choices: { notes: 'hub' }` where only the Provider changed notes → `take: ['notes']`.
- [ ] **Step 2: Run** `three-way.test.ts`. Expected: FAIL (`planSend` undefined, `clear` missing, the rewritten tests fail).
- [ ] **Step 3: Implement** `threeWay`'s `clear` and removal-`take`, and `planSend`, in `three-way.ts` (pure, no database).
  Text compares trimmed (as `comparableOf` already trims notes).
- [ ] **Step 4: Run** `three-way.test.ts` and `ssi-dive-import.test.ts`. Expected: `three-way` PASS. `ssi-dive-import`
  may fail only at `:432` and `:472` (the import now gets `take: ['cylinder']` with no cylinder, which Task 3 handles).
  If so, mark those two `it.todo('… (Task 3)')` for one commit.
- [ ] **Step 5: `pnpm check`, commit** "Three-way: a removal is a change both ways; planSend decides what a send takes, sends, clears and keeps".

### Task 2: Shared exchange helpers out of the import (no behaviour change)

**Files:**
- Create: `apps/server/src/providers/remote-state.ts`, `apps/server/src/providers/dive-changes.ts`
- Modify: `apps/server/src/providers/push-service.ts`, `dive-import.ts`, `gone-dives.ts` (imports only); `.dependency-cruiser.cjs` only if it lists files

**Interfaces:**
- Produces, `remote-state.ts`: `currentRemote(pushes: PushRow[]): PushRow | null`, `fingerprintNow(adapter, loaded): string | null`,
  `type PushRow` (moved as they are). `push-service.ts` imports them from here and re-exports nothing.
- Produces, `dive-changes.ts`: `interface ProviderRun` (today's `Run` in dive-import.ts, renamed and exported), and
  `createDiveChanges(deps: { db: Db; blobs: BlobStore })` returning `{ runOf, sitesOf, baseOf, hubOf, changesOf, takeChanges, fill, shown }`.
  Their signatures stay as today, with `ProviderRun` for `Run`. `dive-import.ts` uses them. `dive-changes.ts` imports
  neither `dive-import.ts` nor `push-service.ts`.

- [ ] **Step 1: Move** the functions with their comments. No logic changes.
- [ ] **Step 2: Run** `pnpm check` (typecheck, lint, dependency rules and the full server suite for providers/). Expected:
  green, with no test changed.
- [ ] **Step 3: Commit** "Providers: the exchange helpers the send will share move out of the import".

### Task 3: A removal at the Provider reaches the Dive; directions govern fill and Recordings

**Files:**
- Modify: `apps/server/src/providers/dive-changes.ts` (`takeChanges`, `fill`), `dive-import.ts` (`asRecording`),
  `apps/server/src/dives/cylinders.ts` (`mergeProviderCylinder`), `apps/server/src/dives/weighting.ts` (`mergeProviderLead`)
- Test: `apps/server/test/ssi-dive-import.test.ts`

**Interfaces:**
- Consumes: Task 1's `threeWay`, Task 2's `takeChanges`.
- Produces: `mergeProviderCylinder(tx, diveId, cylinder: ProviderCylinder | null, mode: 'fill' | 'take')`. With `null`
  and `'take'` it removes the Dive's one Cylinder unless it has a `recordingId`, and returns the Revision's `cylinders`
  change. Likewise `mergeProviderLead(tx, diveId, kg: number | null, mode)` removes the one Lead entry. `takeChanges`
  passes `d.cylinder` / `d.leadKg` through even when `null`. Notes and the values already take `null`.
- Produces: a field whose `dives.fields` entry lacks `'import'` is never filled (site, notes, buddies, cylinder, lead in
  `fill`), and its value is not put into a Recording made by `asRecording` (`profile` → depth and temperature series,
  `tankPressure`, `heartRate`, `cns`, `diveType` → dive mode, `surfaceInterval`, `gas`, `device`).

- [ ] **Step 1: Write the failing tests** in `ssi-dive-import.test.ts`:
  - Rewrite `:432` as "a tank emptied at SSI removes the Dive's one Cylinder (ADR 0056 amends 0045); one a Recording brought stays".
  - Rewrite `:472` as "a weight emptied at SSI removes the Dive's one Lead entry (ADR 0056 amends 0031)". The "never saw one there" half stays.
  - "a Dive with two Cylinders keeps both when SSI empties its tank".
  - "a note emptied at SSI is emptied here, one Revision 'Updated from its source'".
  - "a field the Provider doesn't import is neither filled nor put into the Recording". Use a test adapter whose
    `fields` lacks `notes` and `heartRate`: a new Dive gets no notes, and its Recording no heart rate series.
- [ ] **Step 2: Run** the file. Expected: FAIL on those cases.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** the file, `three-way.test.ts` and `pnpm check`. Expected: PASS. No `it.todo` is left.
- [ ] **Step 5: Commit** "Import: a removal at the Provider reaches the Dive, tank and lead too; directions govern fill and Recordings".

### Task 4: The adapter reads the current record and leaves or clears fields on an update

**Files:**
- Modify: `apps/server/src/providers/provider.ts`, `ssi/ssi-adapter.ts`, `ssi/ssi-record.ts`, `ssi/ssi-dive-type.ts`
- Test: `apps/server/test/ssi-record.test.ts`, `ssi-adapter.test.ts`, `provider-contract.ts`

**Interfaces:**
- Produces, `provider.ts`:
  - `interface Leave { keep: DiveField[]; clear: DiveField[] }`.
  - `DiveExportAction.current?(remoteId: string): Promise<{ dive: ImportedDive; context: ImportContext; record: Record<string, unknown> } | null>`.
    It reads the record the update reads in the same action (no second read: SSI's `logbookOf(ctx).current()` is memoised per action).
  - `update?(remoteId, dive, previous, number?, leave?: Leave)`. Absent `leave` behaves as today.
- Produces, `ssi-record.ts`: `SSI_FIELD_KEYS: Record<SyncedField, readonly string[]>` (each key one of `SENT_KEYS` in `ssi-dive-row.ts`), the keys `ownFields`
  writes per field: `notes` → `odin_user_log_comment`, `lead` → `_weight_kg`, `_weight_lb`, `cylinder` → the tank,
  pressure and tank type keys, `site` → the site key, `startsAt` → date, time and entry time keys, the values → their
  metric and imperial keys. `buddies` is handled by the adapter's buddy list. Then
  `updateRecord(remote, dive, leave?: Leave)`: for `keep` fields the remote's keys stay; for `clear` fields each key gets
  the empty value Task 0 found for it.
- Produces, `ssi-dive-type.ts`: one `ssiInteger(v: unknown): number | null`, used by `diveModeOfSsi` and `keepTraining`.
  `ssi-adapter.ts` keeps its own `numberOf` (it takes decimals).
- Produces, `ssi-adapter.ts`: `current`, with `parseSsiDive` and `contextOf` on the logbook read. `update` with
  `leave.keep` containing `buddies` sends the remote's buddy IDs unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `ssi-record.test.ts`: "an update keeps the Provider's notes when asked to" (`keep: ['notes']` → the remote's comment);
    "an update clears the lead and the tank when asked to" (the encoding from Task 0); "every synced field but buddies
    names its keys, and each key is in the dive row" (against `ssi-dive-row.ts`).
  - `ssi-adapter.test.ts`: "current answers SSI's record as an ImportedDive from the same read the update uses". The fake
    counts one `get_divelog` for `current` then `update`.
  - `provider-contract.ts`: "an adapter that updates also answers current".
  - The existing `ssi-dive-type` tests stay green with the single parser.
- [ ] **Step 2: Run** those files. Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** the files and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** "SSI: the current record before an update, and an update that keeps or clears named fields".

### Task 5: Stored Conflicts (protected: schema and migration)

**Files:**
- Modify: `apps/server/src/db/schema.ts` (asks the owner); create `apps/server/drizzle/0039_provider_conflict.sql` (generated, asks the owner)
- Create: `apps/server/src/providers/conflicts.ts`; modify `apps/server/src/providers/routes.ts`, `layer.ts` (wiring)
- Test: create `apps/server/test/provider-conflicts.test.ts`

**Interfaces:**
- Produces, schema: `providerConflict = pgTable('provider_conflict', { diveId uuid → dive cascade, provider text,
  connectionId uuid → connection cascade, remoteId text, fields jsonb $type<ConflictField[]>, runId uuid null → push_run
  set null, foundAt timestamptz default now })`. Primary key `(diveId, provider)`, index on `connectionId`. The comment
  follows `providerGoneDive`'s: one per Dive and Provider, whether it still waits is worked out on reading.
- Produces, `conflicts.ts`:
  - `interface ConflictField { field: SyncedField; hub: ShownValue; provider: ShownValue }`. `ShownValue` is `shown`'s
    return type, so the values are said as in the import preview.
  - `record(q, entry: { diveId; provider; connectionId; remoteId; fields: ConflictField[]; runId: string | null })`: upsert.
  - `openFields(q, diveId, provider): Promise<SyncedField[]>`.
  - `close(q, diveId, provider)`.
  - `createConflictService({ db })` with `waiting(userId)`. Like `gone-dives.ts`'s `waiting`, per Connection of the User,
    each entry with the Dive's number, start, depth, duration, site name and `fields`. It leaves out a deleted Dive and an
    entry whose `remoteId` isn't the Dive's current remote dive.
- Produces, route: `GET /api/provider-conflicts` → `{ connections: [{ connectionId, provider, providerName, entries: [...] }] }`,
  documented in the OpenAPI as the gone dives route is.

- [ ] **Step 1: Write the failing tests** in `provider-conflicts.test.ts`: "a recorded conflict is listed for its User
  with both values"; "recording twice keeps one entry with the newer fields"; Review Focus 4 "a deleted Dive's entry
  and one whose remote dive changed are not listed"; Review Focus 5 "another User sees none of it".
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the table to `schema.ts` (the edit asks the owner), then `db:generate` (the file asks
  the owner; check that it only creates the table and index), then the service and route.
- [ ] **Step 4: Run** it and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** "Conflicts with a Provider: stored per Dive and Provider, listed for Needs your decision".

### Task 6: The send is three-way

**Files:**
- Modify: `apps/server/src/providers/push-service.ts`, `routes.ts` (send body, answer, status)
- Test: `apps/server/test/ssi-target.test.ts`, `outgoing-dive.test.ts`
- Docs: `docs/spec/clients.md` ("Sending a Dive to a Provider"), `docs/spec/architecture.md` (the send), `docs/glossary.md` (Conflict: "…such as in the hub and at the Source, found by an import or a send; one from a Push run waits in Needs your decision")

**Interfaces:**
- Consumes: Task 1 `planSend`, Task 2 `createDiveChanges`, Task 4 `current`/`update(…, leave)`, Task 5 `record`/`openFields`/`close`.
- Produces:
  - `send(userId, diveId, provider, options?: SendOptions)` with
    `interface SendOptions { onExisting?: 'link' | 'create'; conflicts?: Partial<Record<SyncedField, Choice>>; onConflict?: 'ask' | 'defer'; runId?: string }`.
    The default is `onConflict: 'ask'`. Callers (the route, `push-run-service.ts`, tests) move to the options object.
  - `SendResult` adds `{ result: 'conflicts'; conflicts: ConflictField[] }`. The `updated` result adds
    `taken: SyncedField[]` and `deferred: SyncedField[]`.
  - The update path, under the lease and `withAccess`:
    1. `current` (null → `provider_dive_gone` as today);
    2. base (`baseOf`), hub (`hubOf`) and fields: the Provider's `SYNCED_FIELDS` with both directions, filtered as `hubOf` does;
    3. `openFields`;
    4. `planSend`;
    5. with `conflicts` (ask) → answer `conflicts`, write nothing, record no Push;
    6. `take` → `takeChanges` in a transaction (actor: the User; cause `update`);
    7. reload the outgoing Dive;
    8. `update(…, { keep: [...plan.keep, ...fields without 'export'], clear: plan.clear })`;
    9. the Push with the fingerprint of the reloaded Dive;
    10. `keep` from a Conflict under `defer` → `record(…, runId)`, else `close`.
    A field Task 0 found SSI can't clear is answered in `deferred` with no entry, and the base moves with the Push.
  - `status` / `statusAt` add `conflicts: ConflictField[] | null`, the open entry.
  - Route `POST /api/dives/{id}/providers/{provider}`: body adds `conflicts` (object of field → `hub`/`provider`).
    Answer `outcome: 'conflicts'` (200) with `conflicts`. `outcome: 'updated'` adds `taken` and `deferred`.

- [ ] **Step 1: Write the failing tests** in `ssi-target.test.ts`, through the fake SSI. Each test changes a field there
  as the e2e helper does with `set`, then sends:
  - "a note changed in SSI's app comes back and the lead changed here goes out; one save, one Revision 'Updated from its source', the Dive up to date" (the piece's check, in the fake).
  - "a note removed here is removed at SSI"; "a note removed in SSI's app is removed here".
  - "a tank removed in SSI's app removes the Dive's one Cylinder; one from a Recording is sent again".
  - "a site removed at SSI is sent again".
  - "changed on both sides: nothing is sent, the answer lists the conflict with both values" (no Push, the fake saw no `save_divelog`).
  - "with choices, SSI's value is taken and Dive Hub's sent, in one save".
  - "a Dive linked without a base sends its values and fills its empty notes from SSI, no conflict".
  - "a run's conflict: sent without the field, an entry waits; the next send from the Dive's page asks it, and with a choice closes the entry".
  - "a field the Provider doesn't export stays as SSI has it" (a test adapter's `fields`).
  - Review Focus 1: "a send retried after signing in takes nothing twice" (the fake expires the token after `current`: one Revision).
  - `outgoing-dive.test.ts` (folded in): "carries the Primary recording's tank pressure and CNS channels".
- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Then update clients.md:
  - `outcome: conflicts`: list the fields with both values, "keep Dive Hub's" preselected, send again with `conflicts`.
  - `taken`: say what came back from the Provider.
  - `deferred`: say what was left as the Provider has it.
  - `status.conflicts`: an open entry, say so and offer to decide.
  - A removal is sent.
  Then the architecture and glossary lines.
- [ ] **Step 4: Run** the files, `changed-since-sent.test.ts`, `provider-numbers.test.ts` and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** "The send is three-way: a change made at the Provider comes back, a removal goes out, a conflict is asked".

### Task 7: Push runs leave a conflict in Needs your decision

**Files:**
- Modify: `apps/server/src/providers/push-run-service.ts`, `push-run-routes.ts`
- Test: `apps/server/test/push-runs.test.ts`
- Docs: `docs/spec/clients.md` ("Sending many Dives to a Provider")

**Interfaces:**
- Consumes: Task 6 `send(…, { onConflict: 'defer', runId })`.
- Produces: the run's view adds `conflicts: number`, the entries recorded with its `runId`. An item that was sent with
  deferred fields keeps `outcome: 'updated'`.

- [ ] **Step 1: Write the failing test** "a run sends a Dive with a conflict without that field, the entry waits, and the run's report counts it".
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement**; clients.md: the report says how many wait and links to Needs your decision.
- [ ] **Step 4: Run** `push-runs.test.ts`, `push-run-plan.test.ts`, `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** "Push runs: a conflict waits in Needs your decision, the report counts it".

### Task 8: The web client asks, lists and reports

**Files:**
- Create: `apps/web/src/ProviderConflicts.tsx` (the per-field choice, shared), `apps/web/src/ProviderConflictsSection.tsx` (Review section)
- Modify: `ProviderPanel.tsx`, `ReviewPage.tsx`, `ReviewStrip.tsx`, `PushRun.tsx`, `lib/providers.ts`, `lib/review.ts`, `i18n/locales/en.json`, `de.json`, `scripts/check-lib.mjs` (`@dives` pattern: `ProviderConflicts|ProviderConflictsSection`)
- Test: create `apps/web/e2e/provider-conflicts.spec.ts` (`@dives`), a case in `e2e/ui-quality.spec.ts`; extend `support.ts` if a helper is needed

**Interfaces:**
- Consumes: the send answer and status of Task 6, `GET /api/provider-conflicts` of Task 5, the run view of Task 7.
- Produces, in `ProviderConflicts.tsx`: `ProviderConflicts({ conflicts, providerName, onSend })`. One row per field with
  Dive Hub's and the Provider's value, said as the import preview says them (reuse its value formatting), and a React
  Aria radio group "Keep Dive Hub's" / "Take {provider}'s" with "keep" preselected. The button "Send with these choices"
  calls `onSend(choices)`.
- Words (en; de alongside): "Changed in both places", "{provider} has a different value for these since the last
  exchange. Choose which to keep; nothing was sent yet.", "Keep Dive Hub's", "Take {provider}'s", "Send with these
  choices"; Review: "Changed in both places ({count})"; run report: "{count} dives have values changed in both places:
  they wait in Needs your decision"; `taken`: "Taken from {provider}: {fields}". Field names reuse the read-back field labels.

- [ ] **Step 1: Write the failing browser tests** in `provider-conflicts.spec.ts`, using `/e2e/fake-ssi/dive` with `set` to change a dive at SSI:
  - "on the dive's page, notes changed in both places are asked, nothing is sent until chosen, and the choice is sent";
  - "a note changed only in SSI comes back on update and the page says so";
  - "a run's conflict waits under Needs your decision; Take SSI's sends and the entry is gone; the strip counts it".
  - The ui-quality case covers the dive page's conflict state and the Review section.
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement.** On the Dive's page the choice replaces the send button's area until sent or cancelled.
  On Review the section sits beside gone dives, built the same way.
- [ ] **Step 4: Run** the spec, `ui-quality.spec.ts`, `push-run.spec.ts`, `gone-dives.spec.ts`, then `pnpm check`.
  Review the screenshots of the new states (review capture with `REVIEW_AREAS=@dives`).
- [ ] **Step 5: Commit** "Web: a conflict with a Provider is asked on the dive's page and waits on Review after a run".

### Task 9: The piece's check on the owner's account, and the reference

**Files:**
- Modify: `apps/server/test/fixtures/ssi/round-trip.ts` (mode `twoway start | send | clear | finish`), `docs/references/ssi-app-api.md`, `docs/index.md`
- Create: `docs/research/<date of the run>-ssi-two-way-checks.md`

**Interfaces:**
- Consumes: Task 1 `planSend`, Task 4 `current` and `update(…, leave)`. The mode runs the same comparison as the push
  service, without the database. The base is the payload `start` saved in `samples/private/ssi/twoway.json` (git-ignored).

- [ ] **Step 1: Add the mode.**
  - `start` creates a test dive dated 2000-01-04 10:00, notes "Dive Hub test", lead 6 kg, and saves its payload.
  - `send` reads the dive with `current` and compares with the hub = the saved dive with lead 8 kg. It prints the
    `planSend` lists, sends with the plan's `leave`, then prints the stored notes and lead.
  - `clear` sends with the notes removed here and prints the stored notes.
  - `finish` deletes the dive and confirms it is gone.
- [ ] **Step 2: Run** `pnpm check`.
- [ ] **Step 3: Announce and run** `twoway start`: "Check: creates one test dive dated 2000-01-04 at SSI". Ask the owner
  to change its notes in the MySSI app (for example to "Dive Hub test, changed in the app") and say when done. Then
  announce and run `send`. Expected: `take: ['notes']`, the lead goes out, and SSI stores the owner's notes and 8 kg.
  Then `clear`. Expected: the notes are gone, and the owner confirms in the app. Then `finish`.
- [ ] **Step 4: Write the research note** (keys sent, what SSI stored, what the app showed, [T], app version 5.0.43),
  link it from `docs/index.md`, and mark the reference's update and clear behaviour [T] with links to this note and Task 0's.
- [ ] **Step 5: Commit** "SSI check: a change made in SSI's app survives a send, a removal reaches SSI" (script and docs only).

---

## After the last task

The final whole-branch review runs, then the `architecture-review` subagent, then `pnpm check:full` before the push.
The finish summary gives the [T] results of Task 0 and Task 9, the known consequence above, and that the 180–86 400 s
limit of `si_before` stays parked [R]. Offer "keep the branch" or "push and open a PR".
