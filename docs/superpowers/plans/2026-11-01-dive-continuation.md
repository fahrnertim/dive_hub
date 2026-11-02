---
title: "Plan: Continuation - appending a Dive cut in two by a surface break (ADR 0063)"
summary: Eleven tasks - the migration (a derived Recording, parts with their append), joining parts into one Recording, appending by hand, a joined Recording as one unit in every existing flow, rebuilding it when an import changes a part (and imports finding the parts), undoing a whole append by restoring, the assessment skipping the break's edges, the surface_break logbook check with chains, the web (dive page, chart, deleted dives, check card) and the docs; the owner's dives 85/86 as the test case, from two FIT fixtures of one Device.
status: ready
date: 2026-11-01
---

# Continuation: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consecutive Dives of one Diver from the same Device, cut apart by a surface break, become one Dive whose
Primary recording is a joined Recording (each gap as 0 m, marked as a Surface break), suggested by a logbook check
and offered by hand, and undone as a whole append by restoring.

**Architecture:** A new folder `apps/server/src/dives/continuation/` beside merging: a pure join of parts, the DB
build/rebuild of the joined Recording, the append/undo service and the Provider-aware append (as `merge-service.ts`
wraps `merging-service.ts`). A part is a `recording` row with `joined_recording_id`; the joined Recording is a
`recording` row with `parser = 'continuation'` and no Original. Every reader of the Primary recording stays unchanged;
code that counts or picks a Dive's Recordings treats the joined Recording and its parts as one unit.

**Tech Stack:** TypeScript, Fastify + TypeBox, Drizzle on PostgreSQL, Vitest against a real PostgreSQL, React + React
Aria + TanStack Query, Playwright.

**Spec:** [the design](../specs/2026-10-31-dive-continuation-design.md) and
[ADR 0063](../../decisions/0063-dive-continuation.md). Read both before Task 1.

## Global Constraints

- [ADR 0053](../../decisions/0053-module-boundaries.md): `dives/continuation/` imports from `dives/`, `db/`,
  `imports/` (matching only), `divers/management` and `sites/dive-site-link` (both allowed for `dives/` by
  `MODULE_IMPORTS`), and types from `providers/` (as `merging-service.ts` does: `ProviderLinks` passed in from
  `app.ts`); never a Provider by name. `imports/placement.ts` may call `dives/continuation/joined-recording.ts` (it
  already calls `dives/dive-service.ts`). `assessment/` reads the Surface breaks from the recording summary, never from
  `dives/`. `pnpm check` runs the dependency rules.
- [ADR 0063](../../decisions/0063-dive-continuation.md): same Diver, same Device, each Dive with exactly one unit; the
  earlier Dive is kept; restoring reverses the whole append and every later append to the same joined Recording.
- [ADR 0038](../../decisions/0038-logbook-checks-and-merging-dives.md): merge's rules reused (fill values, append
  notes, move Provider links where the kept Dive has none, `alsoAt`); `surface_break` is never `obvious`;
  `LOGBOOK_CHECKS_VERSION` 4 → **5**.
- [ADR 0026](../../decisions/0026-deleting-dives.md): the later Dives are soft-deleted the normal way; imports skip a
  link on a deleted Dive as `deleted_earlier` (no new outcome reason).
- [ADR 0016](../../decisions/0016-recording-decisions-and-divers.md): a part is never Primary, never split off or made
  primary on its own (`recording_is_part`, 400).
- [ADR 0048](../../decisions/0048-dive-numbers.md): `renumber` after every append and every undo.
- [ADR 0036](../../decisions/0036-dive-assessment.md): no rule changes; only windows touching a Surface break's edges
  give no rate. Findings put aside on a later Dive are not carried over.
- Also touched: [ADR 0030](../../decisions/0030-importing-dives-from-providers.md),
  [0062](../../decisions/0062-garmin-import-only-provider.md) (imports by key and link; a fetch never replaces a
  Recording), [0056](../../decisions/0056-two-way-exchange-and-automation.md) (a Connection that deletes by itself does it after the
  quiet period).
- Load `karpathy-guidelines` before Task 1: every changed line traces to a task.
- Fixed values: at most **10 minutes** (600 s) from the earlier unit's end to the later's start for the rule (none by
  hand); joined `recording_key` `continuation:<its own id>`; `parser` `continuation`, `parser_version` `1`; break
  samples at **0 m** every first-part sample interval, from one interval after its last sample to one interval before
  the next part's first.
- Words: Continuation, Appending, Surface break ([glossary](../../glossary.md)). Never "merge", "combine", "join",
  "stitch" in UI copy. German: **Anhängen** (card button), **"An den vorherigen Tauchgang anhängen…"** (menu),
  **Oberflächenaufenthalt** (break). Texts in en and de.
- Tests against a real PostgreSQL, at most one `vi.fn`, no `vi.mock`; browser tests carry an area tag. Commands:
  `pnpm check`, `pnpm check --failed`, `pnpm check --tests <filter>`; one full `pnpm check` after the last edit of a
  task, then commit at once.
- Protected paths ask the owner, also in auto mode and from subagents: `apps/server/src/db/schema.ts`,
  `apps/server/drizzle/**`, `docs/decisions/**`. Migrations are generated (`pnpm --filter @dive-hub/server db:generate`,
  dev server stopped), never hand-edited after generation except to add SQL drizzle-kit can't write; never edit an
  applied migration.
- After a route change: `pnpm --filter @dive-hub/api-client generate`. A new web file gets its path in
  `scripts/check-lib.mjs` (`AREAS`, the `@dives` line).

## The test case: the owner's dives 85/86

`apps/server/test/fixtures/surface-break-dive.ts` (Task 2) exports `ownersDiveParts(): { first: Uint8Array; second:
Uint8Array }`: two FITs from `makeSyntheticDive` with one `serialNumber` **3400085** (one Device), 2 s samples, the
synthetic offset of +2 h, so local times are the owner's:

| | start (UTC) | local | duration | depth |
|---|---|---|---|---|
| first | 2026-10-26T06:05:49Z | 08:05:49 | 1180 s (19:40) | 0→7.1 m by 120 s; 6.5 m to 900 s; 6.5→0 m at 1120 s; then `Math.floor(t / 10) % 2 * 0.3` to 1180 s |
| second | 2026-10-26T06:29:30Z | 08:29:30 | 1530 s (25:30) | 1.9 m at 0 s; →7.9 m at 100 s; 7.0 m to 1200 s; 7.0→0 m at 1530 s |

Gap: 06:25:29Z → 06:29:30Z = **241 s** (4 min 01 s). The joined Recording: start 06:05:49Z, duration **2951 s**, max
depth **7.9 m**, `surfaceBreaks` `[{ startS: 1180, endS: 1421 }]`, depth samples 591 + **119** zeros (1182…1418 s) +
766 = **1476**. `apps/server/test/fixtures/write-continuation-fixture.ts` writes the same two files to
`apps/web/e2e/fixtures/surface-break-first.fit` and `surface-break-second.fit` for the browser tests.

## Where the joined Recording touches existing code

Every writer of `sample_series` and of recording summaries (each rebuilds the joined Recording, with a test):

| Writer | Today | With parts | Test (task) |
|---|---|---|---|
| `imports/placement.ts` `reimport` (update in place: `update(recording)` + `writeSamples(…, true)`) | upload or Provider fetch of a known key | rebuild the joined Recording when `known.joinedRecordingId`; then the Dive whose Primary it is follows | "a part uploaded again with changed samples rebuilds the joined Recording" (5) |
| `imports/placement.ts` `placeRecording` new row (`insert(recording)` + `writeSamples(…, false)`) | new Recording | never a part (a part is made only by appending): no change | "a new file of the same Device beside a joined Dive is placed as today" (4) |
| `drizzle/0005_vocabulary_data.sql` | old data migration | already applied: no change | — |
| a parser version reading Originals again | **doesn't exist yet** | whoever writes it goes through `reimport` or calls `rebuildJoined`; a comment at `writeSamples` says so | — |
| `dives/continuation/joined-recording.ts` (new) | — | the only writer of a joined Recording's row, series and events | (3) |

Every `primaryRecordingId` use and `hasRecordingOf`:

| Place | What it does | Joined Recording | Task |
|---|---|---|---|
| `dives/dive-service.ts` `attachRecording` (`takesOver`) | first Recording / file over Provider copy becomes Primary | a part never takes over; the joined one follows the rule (`isProviderCopy(joined)` is false: no Import) | 4 |
| `dive-service.ts` `isProviderCopy` (inner join on `import_id`) | Provider copy? | false for the joined Recording: correct, no change | 4 (test) |
| `dive-service.ts` `setPrimary` | another Recording becomes Primary | refuses a part (`recording_is_part`) | 4 |
| `dive-service.ts` `detach` (`remaining[0]` as new Primary) | split off | refuses a part; the joined one goes with its parts; `remaining` counts units only | 4 |
| `dive-service.ts` `followPrimary` / `primaryOf` / `refreshFromPrimary` / `createDiveFromRecording` / `remove` / `restore` | values follow Primary; soft delete with one tombstone | unchanged; `restore` of a Dive an append took goes to the undo (Task 6); a plain `restore` now goes through `undelete` -> `followPrimary` (values without Override follow the unchanged Primary, so a kept Dive deleted mid-continuation comes back with its own values) | 6 |
| `dives/merging-service.ts` `liveRecordings`, `mergeCandidates` count, `keptOf` | merge keeps the Dive with Recordings | count units | 4 |
| `merging-service.ts` `deleteLeftBehind` (`primaryRecordingId: null`), `fillValues` | | reused by the append (cause widened) | 3 |
| `merging-service.ts` `move` | Recordings move to the copy | unit moves together: no change | 4 (test) |
| `dives/logbook-service.ts` list (`primaryIds`, `recordingsOf`), sketch (`a.recordingId === d.primaryRecordingId`) | list rows | `recordingsOf` counts units | 4 |
| `dives/routes.ts` `view` (`isPrimary`, `primary`) | dive view | lists parts with `partOf` | 3 |
| `dives/checks/logbook-check-service.ts` `divesOf`, `checks/logbook-check-answers.ts` `keepApart` / `keepRestored` | `recordings` count | count units; `divesOf` adds the unit (Task 8) | 4, 8 |
| `assessment/assessment-service.ts` (lines 55, 129, 179–185: samples and events of the Primary) | assessment | unchanged reader; `read` passes `summary.surfaceBreaks` to `assessProfile` | 7 |
| `imports/placement.ts:108` `owner` (Dive whose Primary is the known Recording) | values follow a re-import | after a rebuild, the Dive whose Primary is the joined Recording | 5 |
| `imports/placement.ts` `matchDecision` (`sameDevice`) | one Device doesn't record twice | unchanged (parts share the Device) | 4 (test) |
| `providers/dive-import/dive-changes.ts:205`, `providers/push/outgoing-dive.ts:69` | sending to a Provider reads the Primary | unchanged: sends the joined profile and duration | 4 (test) |
| `providers/dive-import/dive-import.ts` `hasRecordingOf` (any live Recording of the Device on the Dive) and the computers list (`innerJoin(importJob)`) | skip a linked dive already here | unchanged: the parts are live Recordings of the Device; the joined one has no Import | 5 (test) |
| `dives/candidates/candidate-service.ts` (`innerJoin(original)`) | Duplicate candidates | new imports only, never joined: no change | — |

## Review Focus

1. A part uploaded again after the Diver overrode the kept Dive's duration: the joined Recording is rebuilt, the
   Override stays, values without Override follow (Task 5).
2. Restoring the Dive of the first append after a second append **and** after the joined Dive was merged into another
   Dive: all three Dives come back from wherever the joined Recording is now (Task 6).
3. Appending to a Dive whose later partner holds a second computer's Recording, or a Dive between the two: refused
   with `continuation_not_possible`, nothing changed (Task 3).
4. Two parts whose times overlap (the later starts before the earlier ends): no check, refused by hand (Tasks 3, 8).
5. A check card loaded before one of its Dives was edited: the append answers 409 `dive_changed` and changes nothing
   (Task 3).

---

### Task 1: Migration - a derived Recording, parts with their append

**Files:**
- Modify: `apps/server/src/db/schema.ts` (protected: ask the owner, showing the shape below)
- Create: `apps/server/drizzle/0053_*.sql` (generated)
- Test: `apps/server/test/migrations.test.ts`

**Interfaces:**
- Produces: `recording.originalId` / `importId` nullable; `recording.joinedRecordingId`, `recording.appendId`,
  `recording.fromDiveId` (uuid, nullable); table `continuationAppend` (`id`, `joinedRecordingId` not null →
  `recording.id`, `keptDiveId` not null → `dive.id`, `userId` → `user.id` on delete set null, `createdAt`);
  `RecordingSummary.surfaceBreaks?: { startS: number; endS: number }[]`.

The shape (owner sees it before the edit):
- `recording_derived_ck`: `(parser = 'continuation') = (original_id is null and import_id is null)`.
- `recording_part_ck`: `(joined_recording_id is null) = (append_id is null) and (append_id is null) = (from_dive_id is null)`.
- index `recording_joined_idx` on `joined_recording_id`.
- `from_dive_id`: the Dive the part came from (the kept Dive for the first part), so an undo knows where it goes back.
- **The delete reason needs no migration:** `revision.cause` is `text`; the reason is a new value of `REVISION_CAUSES`
  (`apps/server/src/dives/revisions.ts`), added in Task 3. Checked, no enum.

- [ ] **Step 1: Write the failing test** in `migrations.test.ts`: `it('lets only a continuation Recording go without an Original')`:
  insert a Recording with `parser: 'continuation'`, null `originalId`/`importId` → succeeds; with `parser: 'fit'` and
  null `originalId` → rejects with constraint `recording_derived_ck`; a row with `appendId` but no `joinedRecordingId`
  → rejects `recording_part_ck`.
- [ ] **Step 2: Run** `pnpm check --tests migrations` → FAIL (columns missing).
- [ ] **Step 3: Ask the owner, then edit `schema.ts`; stop the dev server; `pnpm --filter @dive-hub/server db:generate`;
  review the SQL** (two `DROP NOT NULL`, three columns with FKs, the table, two checks, the index).
- [ ] **Step 4: Run** `pnpm check --tests migrations` → PASS.
- [ ] **Step 5: Commit** `Server: a derived Recording without an Original, and parts with their append (ADR 0063)`.

### Task 2: Joining parts into one Recording (pure), and the owner's dive as fixtures

**Files:**
- Modify: `apps/server/test/fixtures/synthetic-dive.ts` (option `depthAt?: (t: number) => number`, replacing the
  square profile when given)
- Create: `apps/server/test/fixtures/surface-break-dive.ts`, `apps/server/test/fixtures/write-continuation-fixture.ts`,
  `apps/web/e2e/fixtures/surface-break-first.fit`, `surface-break-second.fit` (run the writer)
- Create: `apps/server/src/dives/continuation/join-parts.ts`
- Test: `apps/server/test/join-parts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PartInput {
    startsAt: Date; durationSeconds: number; maxDepthM: number | null; avgDepthM: number | null;
    utcOffsetSeconds: number | null; utcOffsetSource: UtcOffsetSource;
    entryLatitude: number | null; entryLongitude: number | null; exitLatitude: number | null; exitLongitude: number | null;
    summary: RecordingSummary;
    series: { channel: string; offsetsMs: number[]; values: number[] }[];
    events: { offsetMs: number; type: string; data: Record<string, unknown> }[];
  }
  export type Joined = Omit<PartInput, 'utcOffsetSeconds' | 'utcOffsetSource'> & Pick<PartInput, 'utcOffsetSeconds' | 'utcOffsetSource'>;
  export function joinParts(parts: PartInput[]): Joined; // parts in any order; sorted by startsAt; ≥ 2
  ```

- [ ] **Step 1: Write the failing tests** (`join-parts.test.ts`, parts parsed from `ownersDiveParts()` with the FIT
  adapter):
  - `joins the owner's dive into one profile with the break at 0 m`: `startsAt` 2026-10-26T06:05:49Z,
    `durationSeconds` 2951, `maxDepthM` 7.9, `summary.surfaceBreaks` `[{ startS: 1180, endS: 1421 }]`, depth series
    length 1476, every depth value at offsets 1182 000…1418 000 ms equals 0, first second-part depth at 1 421 000 ms is
    1.9.
  - `leaves other channels without samples in the break`: no temperature offset in (1 180 000, 1 421 000).
  - `averages depth over the time under water only`: `avgDepthM` = (avg₁·1180 + avg₂·1530) / 2710, rounded as the
    parts are; null when a part has none.
  - `takes summary values as the design's table says`: `minTemperatureC` the lower; `maxTemperatureC` the higher;
    `cnsStart` first's, `cnsEnd` last's; `otuEnd` = first `otuStart` + Σ(`otuEnd` − (`otuStart` ?? 0)); `n2Start` first,
    `n2End` last; per gas index `startPressureBar` first, `endPressureBar` last; `diveMode`, `decoModel`, `gfLow`,
    `gfHigh`, `waterType`, `waterDensity`, `conservatism`, `surfacePressureBar`, `diveNumber`,
    `surfaceIntervalSeconds`, `extras` from the first; `sacLpm`, `rmvLpm`, `avgAscentRateMps` left out;
    `avgHeartRate` duration-weighted; entry position from the first, exit from the last.
  - `joins three parts with two breaks`: three synthetic parts → two `surfaceBreaks`, events shifted by each part's
    start.
- [ ] **Step 2: Run** `pnpm check --tests join-parts` → FAIL (module missing).
- [ ] **Step 3: Implement** `depthAt`, the fixtures (values in "The test case" above), run the writer
  (`pnpm --filter @dive-hub/server exec tsx test/fixtures/write-continuation-fixture.ts`), then `joinParts`:
  per channel, concatenate with offsets shifted by `part.startsAt − first.startsAt`; depth gets the break's zeros
  (interval = median of the first part's depth offset steps; each break uses the part before it).
- [ ] **Step 4: Run** `pnpm check --tests join-parts` → PASS.
- [ ] **Step 5: Commit** `Server: joining a Dive's parts into one Recording, the surface break at 0 m; the owner's dive 85/86 as fixtures`.

### Task 3: Appending by hand (service, routes, dive view)

**Files:**
- Create: `apps/server/src/dives/continuation/joined-recording.ts`, `continuation-service.ts`, `append-service.ts`
- Modify: `apps/server/src/dives/merging-service.ts` (export `deleteLeftBehind`, `fillValues`, `mergeNotes`,
  `moveLinks`, `addedParticipants`; widen `cause` to `'merge' | 'move' | 'continuation'`),
  `apps/server/src/dives/revisions.ts` (`REVISION_CAUSES` + `'continuation'`, `'continuation-undo'`),
  `apps/server/src/dives/dive-service.ts` (`DiveError` codes `continuation_not_possible`, `recording_is_part`),
  `apps/server/src/dives/routes.ts` (two routes, `STATUS`, `RecordingView.partOf`), `apps/server/src/dives/dive-view.ts`,
  `apps/server/src/app.ts` (wiring), `apps/server/src/dives/logbook-service.ts` (`recordingsAndSite` selects
  `joinedRecordingId`)
- Test: `apps/server/test/dive-continuation.test.ts`

**Interfaces:**
- Consumes: `joinParts` (Task 2).
- Produces:
  ```ts
  // joined-recording.ts
  export async function buildJoined(tx: Tx, keptDiveId: string, partIds: string[], appendId: string): Promise<string>; // creates the joined Recording, marks the parts, answers its id
  export async function rebuildJoined(tx: Tx, joinedId: string, actor: Actor, cause: RevisionCause): Promise<void>; // from its live parts; deletes it when one is left (Task 6)
  // continuation-service.ts
  export function createContinuationService(db: Db, checks: LogbookCheckService, links: ProviderLinks): {
    previousCandidate(userId: string, diveId: string): Promise<null | { dive: DiveRow; breakSeconds: number; bothAt: string[]; deletesItself: string[] }>;
    append(userId: string, kept: { id: string; version: number }, later: { id: string; version: number }[]): Promise<{ kept: string; appended: string[] }>;
  };
  // append-service.ts (alsoAt first, as merge-service.ts); Side = { id: string; version: number }
  export function createAppendService(deps: { continuation: Pick<ContinuationService, 'previousCandidate' | 'append'>; logbook: Pick<LogbookService, 'versionOf'>; pushes: Pick<PushService, 'removeAt'> }): {
    append(userId: string, kept: Side, later: Side[], alsoAt: string[]): Promise<{ kept: string; failure: null } | { kept: null; failure: ProviderServiceError; providers: Removal['copies'] }>;
  };
  ```
  Routes: `GET /dives/{id}/continuation-candidate` → `200 Nullable({ id, version, ...DiveSummaryFields, breakSeconds, bothAt, deletesItself })`
  (the Dive before this one it would be appended to); `POST /dives/{id}/continuation` body `{ version, dives: [{ id,
  version }] (minItems 1), alsoAt? }` on the **earlier** Dive → `200 DiveView` of the kept Dive. `RecordingView.partOf:
  Nullable(String)` (the joined Recording's id); `SummaryView.surfaceBreaks`.

Preconditions (`continuation_not_possible`, 400), checked in the transaction on the Dives locked in id order: one
Diver; the kept Dive's unit is one Recording or a joined one; each later Dive has exactly one live Recording (no
parts); all of one Device; each later starts after the one before ends; no live Dive of the Diver starts between
them. No 10-minute limit. Versions: `dive_changed` (409).

The append, one transaction, per later Dive in order, as `merging-service.merge` does: `takeCylinders`; move its
Recording to the kept Dive (not through `attachRecording`); Participants, `moveLinks`, `takeWeighting`, site,
`fillValues`, `mergeNotes`; `deleteLeftBehind(tx, laterId, actor, 'continuation', { continuedInto: { from: null, to:
keptId } })`; `changeListener().diveChanged(…, 'delete', …)`. Then: an append row; `buildJoined` (a first append
makes the joined Recording, with the kept Dive's Recording as first part, `fromDiveId` = kept; a further append adds
parts to the existing one and rebuilds); Cylinders tied to a part's channel are tied to the joined Recording's same
channel; the joined Recording becomes Primary through `followPrimary` with cause `continuation` and `extra`
`{ appendedFrom: { from: null, to: [laterIds] }, … }`; `renumber`.

- [ ] **Step 1: Write the failing tests** (`dive-continuation.test.ts`, the owner's two FITs uploaded):
  - `appends dive 86 to dive 85: one Dive, the joined Recording Primary, both parts kept`: kept id = 85's; values
    duration 2951, max 7.9; `recordings` has three, the joined `isPrimary`, the two parts `partOf` = joined id,
    `parser` `continuation`; `surfaceBreaks` `[{ startS: 1180, endS: 1421 }]`; GET samples of the joined Recording
    has 1476 depth points (`maxPoints` 5000).
  - `deletes the later Dive the normal way, naming the Dive it continues`: GET `/dives/deleted` lists 86 with
    `continuedInto` = 85's id; revisions of 85 end with `continuation` after `recordings` entry; numbers: the Dive
    after 86 moves down by one.
  - `fills the kept Dive from the later one and appends its notes, as a merge`.
  - `moves the later Dive's link to a Provider where the kept Dive has none, and leaves it where both have one` (fake
    ledger, as in `dive-merging.test.ts`).
  - `alsoAt deletes the later Dive at the Provider first; a refusal appends nothing`.
  - `appends a third part to a joined Dive` and `appends two later Dives in one go` (three synthetic parts of one
    Device): two `surfaceBreaks`, three parts.
  - `refuses`: another Device; the later Dive with two Recordings; a Dive between them; overlapping times; another
    Diver → 400 `continuation_not_possible`, nothing changed; a stale version → 409 `dive_changed`.
  - `the dive page's candidate`: `continuation-candidate` of 86 answers 85 with `breakSeconds` 241; of 85 answers null.
- [ ] **Step 2: Run** `pnpm check --tests dive-continuation` → FAIL.
- [ ] **Step 3: Implement** the three modules, the exports from `merging-service.ts`, the routes (descriptions in the
  style of `POST /dives/{id}/merge`, naming ADR 0063), `pnpm --filter @dive-hub/api-client generate`.
- [ ] **Step 4: Run** `pnpm check --tests dive-continuation` and `pnpm check --tests dive-merging` → PASS.
- [ ] **Step 5: Full `pnpm check`, commit** `Server: appending a Continuation by hand - one Dive with a joined Recording, the later Dive deleted as in a merge (ADR 0063)`.

### Task 4: A joined Recording and its parts as one unit in the existing flows

**Files:**
- Create: `apps/server/src/dives/recording-units.ts` (`export const isUnit = () => isNull(recording.joinedRecordingId)`)
- Modify: `dive-service.ts` (`attachRecording`, `setPrimary`, `detach`), `merging-service.ts` (`liveRecordings`, the
  count in `mergeCandidates`), `logbook-service.ts` (`recordingsOf`), `checks/logbook-check-service.ts` (`divesOf`
  count), `checks/logbook-check-answers.ts` (`keepApart`, `keepRestored` counts)
- Test: `apps/server/test/dive-continuation.test.ts` (a `describe('a joined Dive in the existing flows')`)

**Interfaces:**
- Consumes: `append` (Task 3).
- Produces: `isUnit()`; every Recording count above counts units.

- [ ] **Step 1: Write the failing tests:**
  - `counts a joined Dive as one Recording`: the logbook list row's `recordings` is 1; `merge-candidates` and
    `logbook-checks` show 1.
  - `refuses to make a part primary or split it off`: `PUT …/primary` with a part, `POST /recordings/{part}/detach`
    → 400 `recording_is_part`.
  - `splits the joined Recording off only with its parts`: a second Device's FIT attached to the joined Dive; detach
    the joined Recording → a new Dive holding the joined Recording and both parts, joined Primary there; the old
    Dive's Primary is the other Device's Recording.
  - `merges a joined Dive and keeps the unit`: merged with an entry Dive, the joined Dive is kept (`keptOf`: only it
    has Recordings) with its Primary; merged as the second of two with a Dive that has its own file Recording (that
    one kept), the joined Recording and both parts attach together and no part becomes Primary.
  - `moves a joined Dive to another Diver with its parts`.
  - `places another Device's file overlapping a joined Dive as today`: attached, not Primary; the joined Recording
    stays Primary.
  - `sends the joined profile to a Provider`: `outgoing-dive` of the joined Dive has duration 2951 and the joined
    samples.
- [ ] **Step 2: Run** `pnpm check --tests dive-continuation` → the new tests FAIL.
- [ ] **Step 3: Implement**: `attachRecording` doesn't let a part take over; `setPrimary` and `detach` refuse a part;
  `detach` of a joined Recording moves its live parts along and picks `remaining` among units; counts use `isUnit()`.
- [ ] **Step 4: Run** `pnpm check --tests dive-continuation` and `--tests dive-merging`, `--tests recording-decisions`,
  `--tests logbook-checks` → PASS.
- [ ] **Step 5: Full `pnpm check`, commit** `Server: a joined Recording and its parts are one unit - counted once, never split, moved and merged together (ADR 0063)`.

### Task 5: Rebuilt when an import changes a part; imports find the parts

**Files:**
- Modify: `apps/server/src/imports/placement.ts` (`reimport`; a comment at `writeSamples` naming `rebuildJoined`)
- Test: `apps/server/test/continuation-imports.test.ts`

**Interfaces:**
- Consumes: `rebuildJoined` (Task 3).

- [ ] **Step 1: Write the failing tests:**
  - `a part uploaded again with changed samples rebuilds the joined Recording`: upload the second FIT made with a
    deeper bottom (same key) → outcome `updated`, the joined Recording's max depth and samples follow, the kept Dive's
    max depth follows, a Revision `reimport` on the Dive.
  - `keeps the Diver's Overrides`: override the duration first; after the re-upload the Override stays.
  - `the same file again changes nothing`: outcome `updated` (today's re-upload answer), the joined Recording's
    samples and the Dive's values equal before and after, one Dive.
  - `the first half uploaded again` → the same.
  - Garmin (`fake-garmin.ts`, both activities fetched and linked, then appended): the next fetch skips the second
    activity as `deleted_earlier` (its link stays on the deleted Dive) and leaves the first `unchanged`; with only the
    second linked before appending (first uploaded as a file), the link moved to the kept Dive → `unchanged`, nothing
    downloaded (`hasRecordingOf` finds the part).
  - SSI (`fake-ssi.ts`): both halves at SSI as entries linked to the two Dives; after appending, the import skips the
    second entry as `deleted_earlier`.
- [ ] **Step 2: Run** `pnpm check --tests continuation-imports` → the rebuild tests FAIL.
- [ ] **Step 3: Implement** in `reimport`: when `known.joinedRecordingId`, `rebuildJoined(tx, known.joinedRecordingId,
  actor, 'reimport')` after `writeSamples`, which refreshes the Dive whose Primary the joined Recording is.
- [ ] **Step 4: Run** `pnpm check --tests continuation-imports`, `--tests garmin-dive-import`, `--tests ssi-dive-import` → PASS.
- [ ] **Step 5: Full `pnpm check`, commit** `Server: an import that updates a part rebuilds its joined Recording; fetches skip the appended Dive (ADR 0063)`.

### Task 6: Undo: restoring reverses the whole append and later ones

**Files:**
- Modify: `continuation-service.ts` (`restorePreview`, `undo`), `joined-recording.ts` (`rebuildJoined` deletes the
  joined Recording when one part is left), `dive-service.ts` `restore` (hands a Dive an append took to the undo),
  `logbook-service.ts` `deletedDives` (`continuedInto`, `appendedWith`), `deletion-service.ts`, `routes.ts`
  (`DeletedDiveView`, a route)
- Test: `apps/server/test/continuation-restore.test.ts`

**Interfaces:**
- Produces: `continuation.taking(tx, diveId): Promise<{ appendId: string } | null>` (the live append that took this
  Dive: a part with `fromDiveId` = it and `appendId` set); `restorePreview(userId, diveId): Promise<string[]>` (every
  Dive the restore brings back, in start order); `undo(tx, userId, appendId)`. Route `GET /dives/{id}/restore-preview`
  → `{ comesBack: string[] }`. `DeletedDiveView` gains `continuedInto: Nullable(String)` and `appendedWith:
  String[]` (the other Dives taken by the same append, to list as one entry).

Undo of append N on joined Recording J (found by `appendId`, wherever J's Dive is now): every append of J created at
or after N, newest first; for each, every part with that `appendId` goes back to its `fromDiveId` Dive (restored:
`deletedAt` null, the part revived if it was deleted with the kept Dive, `joinedRecordingId`/`appendId`/`fromDiveId`
cleared, it becomes that Dive's Primary through `followPrimary`, Revision `continuation-undo`); Cylinders tied to J's
channels that came from that part go back with it; the append row is deleted; `rebuildJoined` (one part left: J is
soft-deleted, the remaining part becomes Primary and values without Override follow it; Overrides stay); `keepApart`
for each separated pair; `renumber`. Provider links that moved stay; links left on the restored Dive come back with
it. A kept Dive deleted meanwhile: the restored Dive gets its part back and stands alone.

- [ ] **Step 1: Write the failing tests:**
  - `restoring the later Dive separates the two and gives back its Recording`: 86 restored → two Dives, each with its
    one Recording Primary, durations 1180 and 1530, the joined Recording gone from both, numbers back.
  - `records "two dives" so the check doesn't ask again at once` (`logbook-checks` has no `surface_break` pair).
  - `one append of two Dives comes back whole`: A with B and C in one append; restore C → B and C back.
  - `undoing the first append undoes the later one`: B appended, then C; preview of B = [B, C]; restore B → A, B, C
    separate. Restoring C only → A + B stay joined, C back.
  - `works where the joined Dive went since`: after appending B to A, merge the joined Dive as the second Dive with a
    Dive F that has its own file Recording (F kept, the unit moves to F); restore B → B back with its part, A's part
    stays on F, the joined Recording is deleted there (one part left) and F's Primary is chosen as after a detach.
  - `the kept Dive deleted meanwhile`: delete 85, restore 86 → 86 back with its Recording; 85 stays deleted.
  - `a part updated by an import since comes back as it is now`.
  - `GET /dives/deleted` lists 86 with `continuedInto` and, for a two-Dive append, each with `appendedWith`.
- [ ] **Step 2: Run** `pnpm check --tests continuation-restore` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check --tests continuation-restore`, `--tests dive-deletion` → PASS.
- [ ] **Step 5: Full `pnpm check`, commit** `Server: restoring an appended Dive reverses its whole append and the later ones, giving back their Recordings (ADR 0063)`.

### Task 7: The assessment skips the break's edges

**Files:**
- Modify: `apps/server/src/assessment/profile-rules.ts` (`ProfileInput.surfaceBreaks?: { startS: number; endS: number }[]`;
  `profileOf` nulls `rate[i]` for windows touching an edge), `apps/server/src/assessment/assessment-service.ts` (`read`
  passes the Primary's `summary.surfaceBreaks`); `ASSESSMENT` version per ADR 0036's rule if the module has one
- Test: `apps/server/test/assessment-rules.test.ts`, `apps/server/test/assessment.test.ts`

A window `[t[i], t[end[i]]]` touches an edge when it overlaps `(startS, startS + Δ)` or `(endS − Δ, endS)`, Δ = the
profile's `sampleIntervalS`.

- [ ] **Step 1: Write the failing tests:**
  - `assessProfile gives no descent rate across a break's end`: a profile at 0 m to 600 s, then 6 m at 602 s, with
    `surfaceBreaks: [{ startS: 300, endS: 602 }]` → no `descent_rate` (without the break: one).
  - `…no ascent band across a break's start`: a first part ending at 8 m at 300 s, zeros after → no ascent band
    reaching into (300, 302) and no `ascent_rate`.
  - `judges the owner's joined dive as two parts`: through the API, the joined Dive's assessment has no `ascent_rate`,
    `descent_rate`, `sawtooth` or `safety_stop` finding, and `ascentBands` has none overlapping 1180–1421 s.
- [ ] **Step 2: Run** `pnpm check --tests assessment` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check --tests assessment` → PASS.
- [ ] **Step 5: Full `pnpm check`, commit** `Server: the assessment reads no rate across a surface break's edges (ADR 0063, 0036)`.

### Task 8: The `surface_break` logbook check, chains as one item

**Files:**
- Modify: `apps/server/src/dives/checks/logbook-check-rules.ts`, `logbook-check-service.ts`, `routes.ts` (`Rule`
  description, `CheckView.chain`, `/logbook-checks` answer)
- Test: `apps/server/test/logbook-check-rules.test.ts`, `apps/server/test/logbook-checks.test.ts`

**Interfaces:**
- Produces: `LOGBOOK_CHECK_RULES` + `'surface_break'`; `LOGBOOK_CHECKS_VERSION = 5`; `CheckedDive.unit?: { deviceId:
  string; startsAt: Date; endsAt: Date } | null` (set by `divesOf` when the Dive has exactly one unit with a Device);
  `ruleFor` answers `'surface_break'` for a qualifying pair after the overlap rules answer none;
  `LogbookCheck.dives: CheckedDive[]` (two, or more for a chain); `CheckView.chain: Nullable(Array({ ...PairedDive,
  surfaceBreakSeconds: Nullable(Integer) }))` for `surface_break` only (each Dive with the break before it), `dive` and
  `other` its first two (`other.keeps` = first).

A pair qualifies: same Diver; both units of one `deviceId`; `0 < later.startsAt − earlier.endsAt ≤ 600 s` (instants);
neither `probablyNoDive`; the later's unit is not a joined Recording. One before, one after: the nearer wins, a tie
gives none (as `oneToOne`, by gap). Chains are built from open pairs only: a pair answered "two dives" ends the chain
there. `surface_break` is never `obvious`, and `against` (merge candidates) leaves it out. "Two dives" on a chain
answers each of its pairs.

- [ ] **Step 1: Write the failing tests:**
  - rules: `finds the owner's two dives` (241 s gap, one Device); `not 601 s apart`; `not another Device`; `not
    overlapping`; `not a probable non-dive 5 minutes before`; `the nearer of two later partners`; `a tie gives none`;
    `a joined Dive as the earlier one, counted from its end`; `A–B and B–C make one chain of three`.
  - service/API: `/logbook-checks` lists one `surface_break` with `chain` of two and `surfaceBreakSeconds` [null, 241];
    `PUT /logbook-checks/answer` `two_dives` on the pair hides it, `status=answered` lists it, `null` asks again;
    `merge-candidates` of 85 is empty.
- [ ] **Step 2: Run** `pnpm check --tests logbook-check` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check --tests logbook-check` → PASS; regenerate the API client.
- [ ] **Step 5: Full `pnpm check`, commit** `Server: the surface_break logbook check - same Device, at most 10 minutes, chains as one item (ADR 0063)`.

### Task 9: Web - appending on the dive page, the joined Recording and its break

**Files:**
- Create: `apps/web/src/AppendDive.tsx` (menu item + dialog; also used by the check card in Task 10)
- Modify: `apps/web/src/DivePage.tsx` (menu item "An den vorherigen Tauchgang anhängen…" when
  `continuation-candidate` answers a Dive; the recordings list shows parts under their joined Recording, named by
  Device and time, without "make primary" or "split off"; the duration with "· 5 min at the surface"),
  `apps/web/src/DepthProfile.tsx` (a shaded, labelled band per `surfaceBreaks`: "Oberflächenaufenthalt 4 min"),
  `apps/web/src/DiveHistory.tsx` / `src/lib/history.ts` (`continuation`, `continuation-undo`, `continuedInto`,
  `appendedFrom`), `apps/web/src/i18n/locales/{en,de}.json`, `scripts/check-lib.mjs` (`AppendDive` on the `@dives` line)
- Test: `apps/web/e2e/dive-continuation.spec.ts` (`@dives`), `apps/web/e2e/support.ts` (`surfaceBreakPair(request)`
  uploads the two fixtures), `apps/web/e2e/ui-quality.spec.ts` (the dialog and the band)

The dialog (as `MergeDive.tsx`'s): which Dive stays (the earlier), which goes to "Deleted dives", the break's length,
the Provider question per `bothAt` (leaving out `deletesItself`, saying they go by themselves after 5 minutes), and
the warning that sending the update to SSI renumbers its later dives and removes a dive centre's QR verification.

- [ ] **Step 1: Write the failing test** `appends the dive after a surface break from the dive page, after asking`:
  open 86, menu "Append to the previous dive…", the dialog names 85 as staying and "4 min 01 s" (or the app's
  duration format), confirm → on 85, one profile with a band "Surface break 4 min", the duration line says "at the
  surface", two parts listed under the joined recording with no "Make primary" on them; history shows the entry.
- [ ] **Step 2: Run** `pnpm check --tests dive-continuation` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check --tests dive-continuation` → PASS; capture with `REVIEW_AREAS` and review the
  screenshots (light, dark, German, phone).
- [ ] **Step 5: Full `pnpm check`, commit** `Web: appending a Continuation from the dive page; the surface break in the profile and the joined Recording's parts`.

### Task 10: Web - the check card, deleted dives and restoring

**Files:**
- Modify: `apps/web/src/LogbookChecks.tsx` (a `surface_break` card: its Dives from `chain`, each break's length,
  "Make these 3 dives one" for chains, button **Anhängen** with text saying one Dive results and the later ones go to
  "Deleted dives" where they can be restored; "These are two dives" with Undo; never in "merge the clear pairs"),
  `apps/web/src/DeletedDives.tsx` (`continuedInto`: "Appended to dive 85" with its link; rows with `appendedWith`
  as one entry "2 dives appended to dive 85"; before restoring, `restore-preview` names every Dive that comes back and
  says "This also takes dive C back out"), i18n
- Test: `apps/web/e2e/dive-continuation.spec.ts`, `apps/web/e2e/dive-deletion.spec.ts` if its helpers change

- [ ] **Step 1: Write the failing tests:**
  - `suggests the pair in Needs your decision and appends on Anhängen`: the card lists both Dives and 4 min 01 s;
    "Append" → one Dive; the check is gone.
  - `restoring the appended dive separates them again`: Deleted dives says "Appended to dive …" with a link; restore
    → two Dives in the logbook, each with its profile; the check doesn't come back.
- [ ] **Step 2: Run** `pnpm check --tests dive-continuation` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check --tests dive-continuation` → PASS; review the screenshots.
- [ ] **Step 5: Full `pnpm check`, commit** `Web: the surface_break check card and restoring an appended dive`.

### Task 11: Docs

**Files:**
- Modify: `docs/spec/clients.md` (Logbook checks: `surface_break`, `chain`, Anhängen, never obvious; Dives: appending
  by hand, `continuation-candidate`, `POST /dives/{id}/continuation`, parts with `partOf` and no Primary/split-off,
  `surfaceBreaks` in the chart and with the duration, `continuedInto`, `appendedWith`, `restore-preview`, the
  `continuation` history entries, `recording_is_part` and `continuation_not_possible`), `docs/spec/data-model.md` (the
  derived Recording, parts, `continuation_append`), `docs/spec/architecture.md` if it lists `dives/` modules,
  `docs/decisions/0063-dive-continuation.md` (status line "Built" with the PR; protected: ask the owner), the design
  doc's status note, `docs/index.md` only if a new document was added
- [ ] **Step 1:** Write the changes; check every client duty of the design's "Client duties" section has its line.
- [ ] **Step 2: Commit** `Docs: Continuation in the client contract and the data model; ADR 0063 built` (docs-only: no check).

Then the branch finish: the whole-branch review, the `architecture-review` subagent, push, PR (Superpowers override 5).
