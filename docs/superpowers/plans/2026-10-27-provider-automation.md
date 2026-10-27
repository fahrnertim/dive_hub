---
title: "Plan: automation for every Provider (piece 6)"
summary: Implementation plan for piece 6 of the SSI alignment - the Waiting push table and its worker step (send on change, send new dives, delete at the Provider, 30 s and 5 min quiet periods, held and stopped states, retries for a day, waking on the Provider's next success), choices in "Needs your decision" through the queue (Conflicts, a dive already at the Provider), the scheduled fetch (interval per Provider, on opening, unattended rules, open Conflicts holding their fields in every import), the Connection's settings and summary, and the web client's icons, states and settings.
status: proposed
date: 2026-10-27
---

# Automation for every Provider (piece 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Connection can send a Dive's changes, new Dives and deletes by itself, and fetch on a schedule, and the User
sees on each Dive, in the logbook and on the Connection what waits, what is held and what stopped, with Retry.

**Architecture:** A `waiting_push` row per Dive and Provider is the queue's truth. Every change to a Dive notes it
(`noteDiveChange`, called from `writeRevision` inside the change's transaction), which upserts the row and (re)schedules
one Graphile job per Connection (`waiting-pushes:<connection>`). The job's step sends one due entry through the ordinary
`pushes.send` / `pushes.remove`, classifies the outcome (done, held, retry later, stopped) and queues itself again after
the Provider's pause. A one-minute crontab tick queues due scheduled fetches and wakes held and stopped entries. The
scheduled fetch runs the manual import's `start` with an `unattended` plan.

**Tech Stack:** TypeScript, Fastify + TypeBox, Drizzle/PostgreSQL, Graphile Worker, vitest (real PostgreSQL), React +
react-aria + TanStack Query, i18next (en, de), Playwright.

**Spec:** [design, "Piece 6, settled 2026-10-27"](../specs/2026-10-23-ssi-app-alignment-design.md#piece-6-settled-2026-10-27)
and the "Exchange (owner)" section it amends; [ADR 0056](../../decisions/0056-two-way-exchange-and-automation.md)
(amended 2026-10-27); [ADR 0026](../../decisions/0026-deleting-dives.md) (its order changes for the delete setting only).

## Global Constraints

- **ADR 0053:** routes → services → db; route files don't import `drizzle-orm`; `db/` imports no domain module; a new
  import between modules adds its entry to `MODULE_IMPORTS` in `.dependency-cruiser.cjs` with the reason in the commit
  message; no import cycles, not even type imports. `dives/revisions.ts` may import `providers/` (allowed today), so
  `providers/waiting-push-queue.ts` must import only `db/` and `providers/provider.ts` types (no `dives/` file), or a
  cycle appears. `imports/` may not import `providers/`: the Import's created Dives reach the queue through `worker.ts`.
- **ADR 0027 and the design's "Generic throughout":** nothing outside `providers/ssi/` names SSI or an `odin_*` key; the
  only SSI-specific value is `limits.fetchEveryMinutes: 60` in its capabilities. Tests of the generic layer use the test
  ledger (`test/fake-ledger-provider.ts`); SSI tests use `test/fake-ssi.ts`. Tests never reach SSI.
- **ADR 0056 (amended 2026-10-27), exact values:** quiet period **30 s** after a Dive's last change, **5 min** after a
  delete; retries after **5 min, 30 min, 2 h, then every 6 h**, until **24 h** after the first failure; more than **20**
  Dives created by one Import are not queued; intervals **60, 360, 1440** minutes (360 preselected in the client); fetch on
  opening only when the last fetch is more than **60 min** old and no younger than the Provider's minimum.
- **Never by itself:** a duplicate (an `exists` answer is held), an update that would remove a verification (held), a send
  through a Connection that isn't the Dive's Connection or whose account changed, a send while a Push run of the
  Connection is queued or running (wait), a scheduled read more often than `fetchEveryMinutes`.
- **One way out:** the worker sends only through `pushes.send` and `pushes.remove`, as the Connection's User, like a Push
  run (ADR 0047). Nothing in "Needs your decision" sends directly any more: every choice queues the Dive, due now.
- **Protected paths:** Task 1 changes `apps/server/src/db/schema.ts` and adds migration `0042_*`: each edit asks the
  owner (`.claude/hooks/ask-protected.mjs`); the owner approves them in the run. No other task touches them; if one seems
  to need it, `STOP: <reason>`. `docs/decisions/**` is not changed by this plan. Don't touch `scripts/agent-lib.mjs`.
- **Tests:** tests first; real PostgreSQL; at most one `vi.fn`, no `vi.mock`; time through the injected `Clock`
  (`skippingClock()` in tests, `ctx.clock.skip(ms)`), never real waits; the worker step is called as the worker calls
  it, without Graphile's runner (as `push-runs.test.ts` does). Every browser test carries an area tag (`@dives`,
  `@account`). `pnpm check` while working; browser tests by hand with `pnpm check --tests <filter>`. Never grow a lint
  baseline or raise a threshold. A new web file gets its path and area in `scripts/check-lib.mjs`.
- **UI rules:** no toasts; errors and notices don't time out; icons `aria-hidden` with a visible or `aria-label` text; new
  icons go into `apps/web/src/ui/Icon.tsx` (Lucide names that exist in the installed `lucide-react`); copy takes the
  Provider's name (`{{provider}}`), never "SSI" literally.
- **Copy (en, exact; de in the same tone):**
  - Waiting: "Waiting to send to {{provider}}". Deleting: "Will be deleted in {{provider}} in {{minutes}} min".
  - Held: "Won't be sent to {{provider}} until you sign in" · "Needs a site with a position before it can go to
    {{provider}}" · "{{provider}} already has a dive at this time: decide under Needs your decision" · "Sending would
    remove the verification in {{provider}}: send it yourself to confirm".
  - Stopped: "Couldn't send to {{provider}}: {{reason}}" / "Couldn't delete it in {{provider}}: {{reason}}", button
    "Retry".
  - Decision: "{{provider}} already has a dive at this time", buttons "Link to it" and "Create a new one".
  - Offer: "{{count}} new dives weren't sent automatically", buttons "Send them to {{provider}}" and "Dismiss".
  - Summary: "Last fetched {{when}}: {{new}} new, {{updated}} updated, {{waiting}} wait for you".
  - Settings: "Send changes automatically", "Send new dives automatically", "Delete at {{provider}} when I delete here"
    (help: "Restoring the dive later creates it at {{provider}} again as a new entry, and a verification it had there is
    lost. Dive Hub can't see whether a dive there is verified."), "Fetch from {{provider}}" with "every hour", "every 6
    hours", "once a day".

## Review Focus

1. **A Dive edited while its send is under way:** it goes out once more after the send, never lost and never twice in
   parallel. Test in Task 3 (`a change during a send queues the Dive once more`).
2. **Two Users manage one Diver, each with a Connection to the same account, both settings on:** one entry, one send, as
   the Dive's Connection's User. Test in Task 2 (`one entry per Dive and Provider for two Connections`).
3. **The User deletes, then Undoes within 5 minutes:** nothing is deleted at the Provider; Undo after the delete went
   out: the restored Dive counts as new. Test in Task 4 (`Undo within the quiet period cancels the delete`, `a restore
   after the delete went out queues a create when send new dives is on`).
4. **SSI down for two days, then back:** the entry is stopped after 24 h and goes out at the first minute tick after any
   Connection to SSI succeeds; an `internal_error` entry stays stopped. Test in Task 3 (`wakes entries stopped as
   unavailable after another Connection's success`, `an internal_error entry wakes only by Retry`).
5. **A scheduled fetch while a Conflict on the Dive is open:** the clashed field is neither taken nor sent, and the
   entry isn't raised twice. Test in Task 6 (`an open Conflict holds its fields in an import`).

---

### Task 1: Schema, migration and capabilities

**Files:**
- Modify: `apps/server/src/db/schema.ts` (new enums and table after `providerConflict`; `connection` columns;
  `ProviderImportPlan`) — protected, asks the owner
- Create: `apps/server/drizzle/0042_provider_automation.sql` via `pnpm --filter @dive-hub/server db:generate` — protected
- Modify: `apps/server/src/providers/provider.ts` (`Capabilities.limits`), `apps/server/src/providers/ssi/ssi-adapter.ts:59`,
  `apps/server/test/fake-ledger-provider.ts`, `apps/server/test/fake-handover-provider.ts`
- Test: `apps/server/test/migrations.test.ts`, `apps/server/test/provider-contract.test.ts`

**Interfaces:**
- Produces (schema.ts):
  - `waitingPushAction = pgEnum('waiting_push_action', ['send', 'delete'])`,
    `waitingPushState = pgEnum('waiting_push_state', ['waiting', 'held', 'stopped'])`.
  - `waitingPush` table `waiting_push`: `diveId` (FK dive, cascade), `provider` text, `connectionId` (FK connection,
    cascade), `action`, `state` (default `waiting`), `reason` text null (a hold reason `requirements` | `sign_in` |
    `exists` | `removes_verification`, or a problem code when stopped), `options` jsonb
    `$type<WaitingPushOptions>()` default `{}`, `detail` jsonb null (`{ remoteId, remoteNumber, startsAt }` of the dive
    already at the Provider), `dueAt` timestamptz not null, `attempts` int default 0, `firstFailedAt` timestamptz null,
    `stoppedAt` timestamptz null, `changedAt` timestamptz not null (the last note), `createdAt`. Primary key
    `(diveId, provider)`; index `(connectionId, state, dueAt)`.
  - `export interface WaitingPushOptions { onExisting?: 'link' | 'create'; conflicts?: Record<string, 'hub' | 'provider'> }`.
  - `connection` gains `sendChanges` boolean default false, `sendNewDives` boolean default false, `deleteAtProvider`
    boolean default false, `fetchEveryMinutes` integer null with check `in (60, 360, 1440)`, `lastFetchedAt`
    timestamptz null, `lastFetchImportId` uuid null (FK `importJob`, set null), `unsentImportId` uuid null (FK
    `importJob`, set null; the offer of Task 5).
  - `ProviderImportPlan` gains `unattended?: boolean`.
- Produces (provider.ts): `Capabilities.limits.fetchEveryMinutes: number | null` (doc comment: the shortest interval of
  a scheduled fetch, null for none). SSI declares `60`; the ledger `60`; the handover provider `null`.

- [ ] **Step 1:** Add to `migrations.test.ts` a test `waiting_push and the Connection's automation columns exist` that
  inserts a `waiting_push` row for a Dive and Connection, checks the primary key refuses a second row for the same Dive
  and provider, and that `fetch_every_minutes = 30` violates the check.
- [ ] **Step 2:** Run `pnpm --filter @dive-hub/server test migrations` — FAIL (no table).
- [ ] **Step 3:** Change `schema.ts` as above (asks the owner), run `db:generate`, name the file
  `0042_provider_automation.sql`, read it (only the new enums, table, index, columns and check).
- [ ] **Step 4:** Add `fetchEveryMinutes` to `Capabilities.limits` and to every adapter; extend the contract test with
  `every Provider declares fetchEveryMinutes, null without dive import`.
- [ ] **Step 5:** `pnpm check` — green.
- [ ] **Step 6:** Commit `Automation: waiting_push table, the Connection's settings and fetchEveryMinutes (migration 0042)`.

### Task 2: The queue: noting changes, one entry per Dive and Provider, scheduling the Connection's job

**Files:**
- Create: `apps/server/src/providers/waiting-push-queue.ts` (imports only `db/` and provider types)
- Modify: `apps/server/src/dives/revisions.ts` (`writeRevision` calls `noteDiveChange` for `entityType === 'dive'`)
- Modify: `apps/server/src/sites/site-service.ts` (a change to a site's name or position notes its Dives)
- Modify: `apps/server/src/providers/push-service.ts` (`settle` after a confirmed send or delete)
- Test: `apps/server/test/waiting-pushes.test.ts` (new)

**Interfaces:**
- Produces:
  - `export const WAITING_PUSHES_TASK = 'waiting_pushes'`; `export const QUIET_MS = 30_000`; `export const DELETE_QUIET_MS = 300_000`.
  - `noteDiveChange(tx: Tx, diveId: string, cause: RevisionCause, at: Date): Promise<void>`: for each Provider where
    the Dive has a current confirmed Push with a remote ID and its Connection (`push.connectionId`) is the Dive's
    Connection (exists, same `accountId` as when sent, same Diver): with `cause === 'delete'` and `deleteAtProvider`, upsert
    action `delete` due `at + DELETE_QUIET_MS`; with `cause === 'restore'`, delete a waiting `delete` entry; else with
    `sendChanges`, upsert action `send` due `at + QUIET_MS` (state `waiting`, `reason` null, `attempts` 0,
    `changedAt = at`), never replacing a `delete`. When the Dive has no remote dive at a Provider and the cause is not
    an import's (`import-create`, `auto-attach`, `reimport`, `fill`, `update`, `auto-site`): the Diver's oldest Connection
    to that Provider with `sendNewDives` queues a `send` the same way (a restored Dive whose remote dive was deleted
    counts). After each upsert, `scheduleConnection(tx, connectionId)`.
  - `noteSiteChange(tx: Tx, siteId: string, at: Date)`: `noteDiveChange(..., 'edit', at)` for the live Dives at the site.
  - `queueNow(q: Db | Tx, diveId: string, provider: string, connectionId: string, options: WaitingPushOptions): Promise<void>`:
    upsert `send` due now, state `waiting`, merging `options`; schedules (Tasks 3, 4 and 7 use it).
  - `scheduleConnection(q: Db | Tx, connectionId: string)`: `graphile_worker.add_job(WAITING_PUSHES_TASK,
    {connectionId}, job_key => 'waiting-pushes:' || id, job_key_mode => 'replace', run_at => <the earliest dueAt of its
    waiting entries>, max_attempts => 1)`; nothing when none waits.
  - `cause` is a plain `string` (a type import of `RevisionCause` from `dives/revisions.ts` would be a cycle); the list of
    an import's causes lives in this file.
  - A note while the Connection is `needs_sign_in` without a kept password writes the entry `held` `sign_in` at once,
    so the Dive's page says so right after the save.
  - Turning a setting on queues nothing that changed before (the logbook's "changed since sent" filter and a Push run
    are for those).
  - `settle(q: Db | Tx, diveId: string, provider: string, startedAt: Date)`: deletes the entry unless its `changedAt` is
    after `startedAt` (then it stays `waiting`, due `changedAt + QUIET_MS`). `push-service.ts` calls it after every
    confirmed send or delete (manual, Push run or worker), so the manual Send on the Dive's page removes the entry.

- [ ] **Step 1: Failing tests** (`waiting-pushes.test.ts`, ledger Provider, a Dive sent once through the API):
  `an edit queues the Dive due 30 s later`; `a second edit moves the due time and keeps one entry`; `nothing is queued with
  send changes off`; `one entry per Dive and Provider for two Connections` (Bob manages Ann's Diver and connects the same
  account; both settings on; one row, its `connectionId` the Push's); `a Connection now at another account queues nothing`;
  `a Dive typed in queues a send with send new dives on`; `an import's new Dive is not queued here` (Task 5 queues it);
  `a site's position change queues its sent Dives`; `a save while the Connection needs a sign-in holds the entry at
  once`; `settle keeps an entry changed after the send began`; and one test per kind of change that alters what is sent (edit of
  values, Participants, attach a Recording, site merge, Cylinder), each asserting a row exists. Read rows from the table
  (the API comes in Task 7); assert the job with `select run_at from graphile_worker.jobs where key = ...` (public view in
  the installed version; if absent, the `_private_jobs` table).
- [ ] **Step 2:** Run `pnpm --filter @dive-hub/server test waiting-pushes` — FAIL.
- [ ] **Step 3:** Implement `waiting-push-queue.ts`; call `noteDiveChange` at the end of `writeRevision` for dives (the
  Revision's own time) and `noteSiteChange` where `site-service.ts` writes a site's name or position change. If a kind
  of change in Step 1 writes no Dive Revision, add the `noteDiveChange` call on that path and say so in the commit.
- [ ] **Step 4:** Run the test — PASS; `pnpm check` — green (dependency-cruiser: no cycle).
- [ ] **Step 5:** Commit `Automation: a change to a Dive puts it in the queue once (Waiting push), and the Connection's job is scheduled`.

### Task 3: The worker step: sending, holding, retrying, stopping, waking

**Files:**
- Create: `apps/server/src/providers/waiting-push-service.ts`
- Modify: `apps/server/src/providers/layer.ts` (wire it, with the Clock), `apps/server/src/worker.ts` (task and crontab
  `* * * * * automation_tick`), `apps/server/src/main.ts` (pass it)
- Test: `apps/server/test/waiting-pushes.test.ts`

**Interfaces:**
- Consumes: Task 2's queue; `pushes.send(userId, diveId, provider, { onConflict: 'defer', ...options })`,
  `pushes.remove(userId, diveId, provider)`, `pushes.status(...)` (requirements, `upToDate`, `updateRemovesVerification`).
- Produces: `createWaitingPushService(deps: { db: Db; registry: ProviderRegistry; pushes: PushService; clock?: Clock })`
  returning:
  - `step(connectionId: string): Promise<{ afterMs: number } | null>` — the worker re-adds the job after `afterMs`.
  - `tick(): Promise<void>` — the minute tick (fetch part in Task 6).
  - `retry(userId: string, diveId: string, provider: string): Promise<void>` — a stopped or held entry the User owns
    becomes `waiting`, due now (`connection_not_found` / `waiting_push_not_found` otherwise).
  - `export const RETRY_AFTER_MS = [300_000, 1_800_000, 7_200_000, 21_600_000]` (the last repeats);
    `export const GIVE_UP_MS = 86_400_000`.
- `step` rules, in order: Connection gone → null. `needs_sign_in` without a kept password → every entry of the
  Connection `held` (`sign_in`), null. A Push run of the Connection queued or running → `{ afterMs: 30_000 }`. No due
  entry → reschedule at the earliest due, null. One due entry, oldest due first:
  - `send`: status blocks (a blocking requirement) → `held` `requirements`. Up to date (and no `options`) → row deleted.
    `updateRemovesVerification` → `held` `removes_verification`. Else send as the Connection's User: `created`,
    `linked`, `updated` → the send's own `settle` (Task 2) removes or keeps the row; `exists` → `held` `exists` with
    `detail`; `conflicts` can't happen with `defer`.
  - `delete`: `pushes.remove` → settled the same way.
  - Errors by problem code: `provider_sign_in_needed` → all held as above. `provider_busy` → due in 30 s, no attempt
    counted. `provider_unavailable` and `internal_error` → `attempts + 1`, `firstFailedAt` set once, due after
    `RETRY_AFTER_MS[min(attempts-1, 3)]`; past `firstFailedAt + GIVE_UP_MS` → `stopped`, `reason` the code, `stoppedAt`.
    Any other code → `stopped` at once.
  - More due entries → `{ afterMs: provider.limits.pauseMs }`.
- `tick` (this task's part): held `sign_in` entries of active Connections → `waiting` due now; `stopped` entries with
  reason `provider_unavailable` whose Provider has any Connection with `lastUsedAt > stoppedAt` → `waiting`, due now,
  `attempts` 0, `firstFailedAt` null; then `scheduleConnection` for every Connection with a due entry (a safety net).

- [ ] **Step 1: Failing tests:** `sends a due entry and removes it`; `does nothing before 30 s` (step before
  `clock.skip(30_000)`); `a change during a send queues the Dive once more` (a change noted between the step's start and the send's end; give
  the ledger fake a `beforeSave` hook if it has none);
  `a manual send removes the entry`; `holds a Dive without a site and sends it after the save that adds one`; `holds an exists answer with the remote dive`;
  `holds an update that would remove a verification`; `a Conflict goes out without the field and waits in Needs your
  decision` (entry `runId` null); `retries an unavailable Provider after 5 min, 30 min, 2 h, 6 h and stops after 24 h`;
  `wakes entries stopped as unavailable after another Connection's success`; `an internal_error entry wakes only by
  Retry`; `a refused send stops at once`; `a token-only Connection holds its entries and the tick wakes them after sign-in`;
  `waits while a Push run of the Connection runs`; `a Dive a run sent meanwhile is removed as up to date`; `Retry makes a
  stopped entry due now`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement the service; in `worker.ts` add `[WAITING_PUSHES_TASK]` (like `PUSH_RUN_STEP_TASK`: re-add
  with the job key and `runAt` now + `afterMs`) and `automation_tick` to the crontab (`* * * * *`).
- [ ] **Step 4:** Run — PASS; `pnpm check` — green.
- [ ] **Step 5:** Commit `Automation: the worker sends Waiting pushes one at a time, holds, retries for a day, stops and wakes`.

### Task 4: Deleting at the Provider through the queue

**Files:**
- Modify: `apps/server/src/dives/routes.ts:685-716` (DELETE `/dives/:id`), `:719-748` (GET `/dives/deleted`)
- Modify: `apps/server/src/providers/push-service.ts` (`statusAt` says `deletesItself` per Provider)
- Test: `apps/server/test/dive-deletion.test.ts`

**Interfaces:**
- Produces: the Provider status (`StatusView`) gains `deletesItself: boolean` (the Dive's Connection has
  `deleteAtProvider`); the delete route skips `removeAt` for those Providers even when `alsoAt` names them, and the
  queue (Task 2's `delete` note) does it after 5 minutes. `DeletedDiveView` gains `waiting: WaitingPushView[]` (Task 7's
  view). **Merging two Dives** (`/dives/:id/merge`, `dives/routes.ts:650-680`; owner 2026-10-27): where both are at a
  Provider (`bothAt`) whose Dive's Connection has `deleteAtProvider`, the merge doesn't ask (`removeAt` skipped for it,
  `merge-candidates` says `deletesItself` per Provider) and the merged-away Dive's copy is deleted through the queue
  after 5 minutes; its deletion by the merge notes `delete` (in `merging.ts`, whatever cause its Revision has).
  Restoring it in that time cancels it. Where only one is at the Provider, its link moves to the kept Dive as today.
- [ ] **Step 1: Failing tests:** `with delete at the Provider on, the Dive is deleted here first and at the Provider
  after 5 min`; `Undo within the quiet period cancels the delete`; `a restore after the delete went out queues a create
  when send new dives is on`; `a stopped delete shows on the deleted dives with its reason`; `with the setting off the
  delete still asks (alsoAt) as today`; `for a Dive at two Providers only the one without the setting is asked`;
  `merging two Dives both at the Provider deletes the merged-away copy after 5 min without asking`; `a merge where only
  one is at the Provider moves its link and deletes nothing`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS; `pnpm check` — green.
- [ ] **Step 5:** Commit `Automation: delete at the Provider after 5 quiet minutes; Undo cancels it (amends ADR 0026's order for the setting)`.

### Task 5: New Dives from an Import, and the offer above 20

**Files:**
- Modify: `apps/server/src/worker.ts` (`PROCESS_IMPORT_TASK`: after `processImport`, `waitingPushes.afterImport(importId)`)
- Modify: `apps/server/src/providers/waiting-push-service.ts` (`afterImport`, `dismissOffer`)
- Modify: `apps/server/src/providers/routes.ts` (`POST /connections/:id/unsent-dives/dismiss`)
- Test: `apps/server/test/waiting-pushes.test.ts`

**Interfaces:**
- Produces: `afterImport(importId: string): Promise<void>` — the Import's created live Dives (from its outcome), grouped by
  Diver; for each Diver's oldest Connection per Provider with `sendNewDives` whose Provider isn't the Import's own:
  20 or fewer → `queueNow`-like upsert due now + `QUIET_MS`; more than 20 → none queued, `connection.unsentImportId =
  importId`. `unsentDives(connectionId): Promise<string[]>` — that Import's Dives still without a remote dive there (the
  Push run's `ids` request takes them). `dismissOffer(userId, connectionId)` clears it.
- [ ] **Step 1: Failing tests:** `a file import's new Dive is queued with send new dives on`; `an import of 21 Dives queues
  none and offers them on the Connection`; `a Push run started with the offered ids sends them and the offer empties`;
  `an import from the same Provider queues nothing`; `dismissing removes the offer`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS; `pnpm check` — green.
- [ ] **Step 5:** Commit `Automation: new Dives from an Import are queued; above 20 the Connection offers a Push run`.

### Task 6: The scheduled fetch

**Files:**
- Modify: `apps/server/src/providers/dive-import.ts` (`start` takes `{ unattended: true }`; `sync` and the preview leave
  open Conflict fields alone; unattended: computers without a choice skipped and counted, Conflicts recorded)
- Modify: `apps/server/src/providers/waiting-push-service.ts` (`tick` queues fetch jobs) or a new
  `apps/server/src/providers/scheduled-fetch.ts` (`FETCH_TASK = 'scheduled_fetch'`, `fetch(connectionId)`, `fetchDue(userId)`)
- Modify: `apps/server/src/worker.ts`, `apps/server/src/providers/routes.ts` (`POST /connections/fetch-due`)
- Test: `apps/server/test/scheduled-fetch.test.ts` (new), `apps/server/test/provider-conflicts.test.ts`

**Interfaces:**
- Consumes: `diveImports.start(userId, connectionId, given)`; `conflicts.openFields`, `conflicts.record`.
- Produces: `fetch(connectionId: string): Promise<void>` — skipped when the Connection needs a sign-in without a password,
  its import mode is `off`, or an import of it is waiting or running; else `start(row.userId, id, { computers: {},
  decisions: {}, unattended: true })`, then `lastFetchedAt = now`, `lastFetchImportId`. `fetchDue(userId:
  string): Promise<number>` — queues `FETCH_TASK` (job key `fetch:<connection>`) for the User's Connections with
  `fetchEveryMinutes` set whose `lastFetchedAt` is older than `max(60, provider.limits.fetchEveryMinutes)` minutes;
  answers how many. The tick queues those older than `fetchEveryMinutes`.
- Unattended import rules: dives of a computer with no saved choice are skipped as `no_computer_choice` (a new skip
  reason beside `ambiguous`, counted on the Connection); a Conflict without a choice keeps Dive Hub's value and is recorded
  with `conflicts.record` (fields merged into an open entry, `runId` null). In **every** import, fields in `openFields`
  of the Dive and Provider are neither taken nor offered as "changed only here"; a manual preview lists them as Conflicts,
  and a choice for them in `start` closes them in the entry.
- [ ] **Step 1: Failing tests:** `the tick fetches a Connection whose interval passed and not one fetched an hour ago with
  6 h set`; `fetch-due fetches after more than an hour, not after 30 minutes`; `a new dive at the Provider becomes a Dive
  as a manual import makes it`; `an ambiguous entry and a dive of a computer without a choice wait and are counted`; `a
  Conflict from a fetch waits in Needs your decision`; `an open Conflict holds its fields in an import`; `a manual
  preview's choice closes the open entry`; `a token-only Connection that needs a sign-in is not fetched`;
  `a scheduled read never comes sooner than fetchEveryMinutes`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS; `pnpm check` — green.
- [ ] **Step 5:** Commit `Automation: fetch on a schedule and on opening; unattended imports skip what only the User can decide`.

### Task 7: The API: settings, states, choices through the queue

**Files:**
- Modify: `apps/server/src/providers/routes.ts` (`PATCH /connections/:id`, `GET /connections`, `StatusView`, the send
  route's `conflicts` choice from "Needs your decision", new routes below), `apps/server/src/providers/connection-service.ts`
  (`setAutomation`), `apps/server/src/routes.ts:261` (`DiveListView` rows), `apps/server/src/providers/conflicts.ts`
  (`waiting` also lists held `exists` entries as a second kind)
- Modify: `docs/spec/clients.md` ("Sending a Dive", "Conflicts with a Provider", "Dives gone" neighbours: a new
  "Sending by itself" section)
- Test: `apps/server/test/waiting-push-api.test.ts` (new)

**Interfaces:**
- Produces:
  - `WaitingPushView = { provider: string; action: 'send' | 'delete'; state: 'waiting' | 'held' | 'stopped'; reason:
    string | null; dueAt: string }` on each Dive row of `GET /dives` (`waiting: WaitingPushView[]`), on `StatusView`
    (`waiting: WaitingPushView | null`) and on deleted dives.
  - `PATCH /connections/:id` accepts `sendChanges`, `sendNewDives`, `deleteAtProvider` (booleans) and
    `fetchEveryMinutes` (`60 | 360 | 1440 | null`); 400 `provider_unsupported` where the Provider can't (no API export,
    no delete, no import, or `fetchEveryMinutes` null) and `fetch_interval_too_short` below the Provider's minimum.
  - `GET /connections` rows gain the four settings, `offers: { sendChanges, sendNewDives, deleteAtProvider, fetchEvery:
    number[] }`, `waiting: { waiting, held, stopped }` counts, `lastFetch: { at, created, updated, waitingForYou } |
    null`, `unsentDives: string[]`.
  - `POST /dives/:id/providers/:provider/retry` (204; Task 3's `retry`).
  - `POST /dives/:id/providers/:provider/decision` with `{ onExisting: 'link' | 'create' }` or `{ conflicts: { field:
    'hub' | 'provider' } }` → `queueNow` with those options (204). The Review page's Conflict choice uses it; the Dive's
    page keeps sending at once (the manual send).
  - `POST /connections/fetch-due` → `{ queued: number }`.
- [ ] **Step 1: Failing tests:** `settings round-trip and refuse what the Provider can't`; `the list rows carry the
  Dive's waiting state`; `retry answers 404 for another User's Dive`; `a decision queues the Dive due now with its
  options`; `the exists entry is listed under Needs your decision and leaves after Link to it`; `fetch-due answers how
  many it queued`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement; write the client contract section (duties: show the states with the
  copy above; call `fetch-due` once per app start; ask before delete only for Providers without `deletesItself`; offer the
  unsent dives). **Step 4:** Run — PASS; `pnpm check` — green.
- [ ] **Step 5:** Commit `Automation: the API for settings, waiting states, Retry and decisions through the queue; client contract`.

### Task 8: Web: the logbook, the Dive's page, deleted dives, the delete dialog

**Files:**
- Modify: `apps/web/src/api.ts`, `apps/web/src/DiveList.tsx`, `apps/web/src/ProviderPanel.tsx`,
  `apps/web/src/DeletedDives.tsx`, `apps/web/src/DeleteDive.tsx`, `apps/web/src/ui/Icon.tsx`,
  `apps/web/src/i18n/locales/en.json`, `de.json`
- Create: `apps/web/src/WaitingPush.tsx` (the state's icon, text and Retry; add to `scripts/check-lib.mjs` with `@dives`)
- Test: `apps/web/e2e/waiting-pushes.spec.ts` (new, `@dives`), a case in `apps/web/e2e/ui-quality.spec.ts`

**Interfaces:**
- Consumes: Task 7's `WaitingPushView`, `retry`, `deletesItself`.
- Produces: `<WaitingPushState push={WaitingPushView} providerName={string} variant="row" | "panel" />`.
- [ ] **Step 1: Failing browser tests:** `a saved Dive shows waiting in the logbook and on its page`; `a stopped Dive shows
  the error and Retry puts it back`; `a Dive without a site says it needs one`; `the delete dialog doesn't ask for a
  Provider that deletes by itself, and the deleted dives list says when`; `saving while the Connection needs a sign-in
  says so at once`.
- [ ] **Step 2:** Run `pnpm check --tests waiting-pushes` — FAIL. **Step 3:** Implement (the panel keeps the manual Send;
  pressing it removes the entry server-side through the send). **Step 4:** Run — PASS; `pnpm check` — green; look at
  the review capture of the changed pages.
- [ ] **Step 5:** Commit `Web: waiting, held and stopped sends in the logbook and on the Dive's page, with Retry`.

### Task 9: Web: the Connection's settings and summary, Needs your decision, fetch on opening

**Files:**
- Modify: `apps/web/src/Connections.tsx`, `apps/web/src/ProviderConflictsSection.tsx` (the new `exists` kind),
  `apps/web/src/ProviderConflicts.tsx` (the Review page's choice uses `decision`), `apps/web/src/App.tsx` (call
  `fetch-due` once after sign-in), `apps/web/src/api.ts`, locales
- Test: `apps/web/e2e/waiting-pushes.spec.ts` (`@account` cases), `apps/web/e2e/provider-conflicts.spec.ts`

**Interfaces:**
- Consumes: Task 7's Connection fields, `decision`, `fetch-due`, dismiss route, Push run start with `ids`.
- [ ] **Step 1: Failing browser tests:** `the settings show only what the Provider offers and 6 hours is preselected`;
  `the delete setting's help text says what restoring does`; `the Connection shows the last fetch and how many wait`;
  `the offer of unsent new dives opens a Push run`; `a dive already at the Provider is decided under Needs your decision`;
  `opening Dive Hub asks for a fetch once`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS; `pnpm check` — green; review capture.
- [ ] **Step 5:** Commit `Web: automation settings, the last fetch, unsent new dives and decisions through the queue`.

### Task 10: Design and docs

**Files:** `docs/superpowers/specs/2026-10-23-ssi-app-alignment-design.md` (piece 6 "done" with this plan's link, as
piece 5's line), `docs/spec/architecture.md` if it lists worker tasks, `docs/backlog/0002-two-way-exchange-follow-ups.md`
(strike points the work settled, e.g. point 1's count if `conflictsOf` changed, with the commit).
- [ ] **Step 1:** Update; run the `architecture-review` subagent on the branch and fix what it finds with `path:line`.
- [ ] **Step 2:** Commit `Docs: piece 6 done in the design`; push and open the PR (skills.md override 5).
