---
title: Tidy piece 6's automation (Waiting pushes, scheduled fetch)
summary: Small follow-ups the reviews of piece 6 left open - cheaper queue writes on a Revision or a site change, the Clock everywhere, a few untested branches, an order-dependent test, list-query counts, i18n casts and three small UI points.
status: draft
risk: low
date: 2026-10-28
---

# Tidy piece 6's automation (Waiting pushes, scheduled fetch)

## Goal
Each point below is fixed, with a test where it changes behaviour. If the owner decides against a point, strike it here
and give the reason. Done means: `pnpm check:full` is green.

### Server
1. **Queue writes cost queries on every change.**
   - `noteDiveChange` (`apps/server/src/providers/waiting-push-queue.ts`), called from `dives/revisions.ts`, runs its
     queries (dive, connections, pushes, importJob) on every Revision, also for import causes that it then drops.
     Return before any query when no Connection of the Diver has a sending setting on.
   - `noteSiteChange` runs per-Dive queries, which is slow for a big public site.
2. **The Clock.** `noteSiteChange`, `queueNow` and `conflicts.record` take `new Date()`, not the injected Clock.
   `test/provider-conflicts.test.ts` moves `changedAt` in the database because of it. `noteSiteChange` also doesn't take
   the Revision's time.
3. **Races and errors.**
   - `queueNow` reads, then upserts `options`; two requests can race.
   - `settle` after the lease can throw, which turns a confirmed manual send into an API error.
   - ~~PATCH `/connections/:id` checks every part, then writes. A concurrent change between the two can still slip
     through. Use one transaction if the services allow it.~~ Struck (2026-10-29): the only concurrent change that
     matters is the Connection being deleted, and then the next part's own lookup answers `connection_not_found`; a
     transaction would need a `Tx` through three service functions for no change a User could see.
   - `afterImport`'s upserts are not in one transaction (bounded at 20).
4. **Leftovers in the queue.**
   - A hold doesn't clear a stale `exists` detail.
   - `unsent_import_ids` keeps Imports whose Dives were all sent. They are harmless (count 0); drop them when read.
   - A conflict entry's `queued` needs state `waiting`, so it shows as open for the moment a send runs.
5. **Conflicts.**
   - An Import doesn't close an open entry whose two sides became equal again.
   - A "keep Dive Hub's" choice closes the field without queuing when the Dive has no current remote with a Connection.
6. **Scheduled fetch.**
   - A failed fetch (Provider down) leaves no log for the operator.
   - The tick runs `blocked()` per Connection every minute.
   - A running or failed Import counts as the last fetch, with 0/0/0.
7. **List queries.**
   - `GET /connections` does N+1 queries (`conflicts.waiting`, `unsentDives` per Connection).
   - `offersOf` on the Imports list is O(imports × connections).
8. **Module shape.** `pushes.waitingOf` and `pushes.deletingItself` (`push-service.ts`) only pass through to the queue.
   Move them to `WaitingPushService` and give that to `diveRoutes` and `apiRoutes`, so `PushService` stays about sending.
   `startWorker` takes 9 positional parameters; give it one object.

### Tests
9. "Retry makes a stopped entry due now" (`test/waiting-pushes.test.ts`) fails when run alone, because it depends on
   test order. Two more failed once in a full local `pnpm check` on 2026-10-28 and passed on rerun:
   - `test/site-for-send.test.ts`: 5 tests got `provider_busy`. It passes alone and passed in CI.
   - `e2e/waiting-pushes.spec.ts:321`: the Connection's heading was not focused after the link from an Import's result.
10. Missing tests:
    - a refused create or update stops at once (only a refused delete is tested)
    - `decide`'s `open` branch, the own-Connection fallback and a co-manager's 404
    - the logbook list refreshing after a send (web)
    - the row fix link keeping `from`
    - the automation offer test starting the run
11. Test nits:
    - the contract test "null without dive import" uses `!data.dives` as a proxy
    - the migration test inserts with minimal raw SQL
    - tests reset the clock with a negative skip
    - a cleanup in a test body instead of `afterEach` (`dive-deletion.test.ts`)
    - the fetch-on-opening test uses hash navigation only

### Web
12. **Type workarounds.** The i18n plural-key casts (`'automation.unsentByImport' as …_one` in `ImportPanel.tsx`,
    likewise in `ProviderAutomation.tsx`) and `filterName={String}`.
13. **Settings.**
    - A stored `fetchEveryMinutes` that is no longer offered selects no radio.
    - The switches have no pending state while saving.
    - `fetchNeedsImport` is copy nobody reads.
14. **Rows and pages.**
    - On a phone, a logbook row's stopped words wrap into a narrow column beside Retry.
    - Retry's error Notice sits inside a `<span>`.
    - The requirements fix button only focuses the text; there is no control for a Dive without a site.
    - The deleted dives list shows "Delete in SSI" next to "Will be deleted in SSI in 5 min". Decide whether the manual
      button stays.

## Read first
- [ADR 0056](../decisions/0056-two-way-exchange-and-automation.md), the amendment of 2026-10-27.
- The [plan](../superpowers/plans/2026-10-27-provider-automation.md), Global Constraints.
- `apps/server/src/providers/waiting-push-queue.ts`, `waiting-push-service.ts` and `scheduled-fetch.ts`.
- The "Sending by itself" part of the [client contract](../spec/clients.md).

## Decided
- [ADR 0056](../decisions/0056-two-way-exchange-and-automation.md): the quiet periods (30 s and 5 min), the retries
  (5 min, 30 min, 2 h and 6 h until 24 h), more than 20 new Dives go to an offer, and the fetch intervals.
- A Push run doesn't clear the offer when it starts, because it sends at most the Provider's cap. The offer shrinks by
  what is sent.
- Point 14 (owner, 2026-10-28): the deleted dives list **hides "Delete in SSI" while an automatic delete waits**; the
  button shows only when automatic deleting is off.
- Point 4 (2026-10-29): a conflict entry is `queued` when the Dive's send entry carries a choice made after the Conflict
  was found, in any state (waiting, held, stopped). The logbook row shows a held or stopped one.
- Point 5 (2026-10-29): a "keep Dive Hub's" choice with no Connection to send through leaves the field open, so the
  choice isn't lost silently.
- Point 6 (2026-10-29): `lastFetchImportId` means "the last fetch whose Import finished". The worker sets it when an
  unattended Import finishes `done`, unless the one there is newer. A running or failed fetch leaves the previous summary.
- Point 10 (2026-10-29): the row's fix link keeps the logbook's `list` (`?list=`), which is what the test checks; the
  name `from` was wrong. The automation offer test checks the run's result ("Sent 1 of 1 dives to SSI.") on the
  logbook, as there is no separate run page.

## State
`main`, after PR #8 (`ssi-automation`) is merged.

Points 1-11 are done on branch `automation-follow-ups` (2026-10-29). Points 12-14 (Web) are left for a second plan.

## Open
Nothing for the owner; the rest is left to the agent.

## Skills to load
Load `postgres-drizzle`, `fastify-best-practices`, `tanstack-query-best-practices` and `vitest`, and read their
overrides in [skills.md](../skills.md#overrides). For the browser tests, also load `playwright-cli`.

## Don't
- Change the values ADR 0056 settled.
- Change `docs/decisions/`.
- Work on live updates ([0009](0009-live-updates-in-open-pages.md)).
