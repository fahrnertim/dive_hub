---
title: Tidy the two-way exchange with a Provider
summary: Small follow-ups the review of the three-way send (ADR 0056) left - a run's conflict count, the entry's values on the Dive's page, the import directions of a Recording's values, the conflicts body, the entry's run, and two browser tests.
status: draft
risk: low
date: 2026-10-24
---

# Tidy the two-way exchange with a Provider

## Goal
Each point below is fixed, with a test where it changes behaviour. Done: every point is done or, where the owner
decides against it, struck out here with the reason; `pnpm check:full` is green.

1. **A run's conflict count counts entries that no longer wait.** `apps/server/src/providers/push-run-service.ts:230-238`
   (`conflictsOf`) counts every entry with the run's id, also one whose Dive is soft-deleted or whose remote dive
   changed. Apply the filter of `apps/server/src/providers/conflicts.ts:84` (Dive not deleted, the entry's remote dive
   still the current one at that Connection), so the run's report counts what "Needs your decision" lists.
2. **The Dive's page shows the entry's values as the run found them.** `apps/server/src/providers/push-service.ts:393`
   (`statusAt`) answers the stored entry's fields; a Dive edited since still shows the old Dive Hub value. Either
   recompute the Dive Hub side on read, or say in the API description and the [client contract](../spec/clients.md)
   that the values are "as found by the run".
3. **A Provider's Recording ignores the import directions of three values.** `asRecording`
   (`apps/server/src/providers/dive-import.ts:286`, the summary at :296-313) takes the max temperature, the water
   temperature and the max depth without checking `importsField` for them, as it does for the other fields.
4. **The `conflicts` body keys are listed by hand.** `apps/server/src/providers/routes.ts:799-803`: derive the object
   from `SYNCED_FIELDS` (`apps/server/src/providers/three-way.ts`), so a new synced field can't be forgotten there.
5. **`provider_conflict` and its run.** No index on `run_id` (`conflictsOf` filters by it); the upsert
   (`apps/server/src/providers/conflicts.ts:35`) overwrites an older run's id, so that run's count drops (say so in the
   run's report, or keep it as is and document it); and no test that a closed entry counts 0 in its run. The index
   needs a migration and a change to `apps/server/src/db/schema.ts`.
6. **No browser test for the deferred notice nor for the disabled Send** on the Dive's page while a send waits.

## Read first
- [ADR 0056](../decisions/0056-two-way-exchange-and-automation.md) (search for "Conflict").
- `apps/server/src/providers/conflicts.ts` and `conflictsOf` in `push-run-service.ts`.
- `apps/server/test/ssi-target.test.ts`, the describe "the three-way send (ADR 0056)".
- The "Sending a Dive" part of the [client contract](../spec/clients.md) (search for `deferred`).

## Decided
- [ADR 0056](../decisions/0056-two-way-exchange-and-automation.md): the send is three-way; a run's Conflicts wait as
  one entry per Dive and Provider.

## State
`main`, after the branch `ssi-two-way-conflicts` is merged. The line numbers are from that branch's last commit.

## Open
Point 2: recompute or say "as found by the run". Point 5: what the run's count says after another run found the
Dive's Conflict again.

## Skills to load
`postgres-drizzle` and `fastify-best-practices` (read their overrides in [skills.md](../skills.md#overrides)); for
point 6 `playwright-cli`.

## Don't
Change how the three-way plan decides (`three-way.ts`), the SSI adapter, or `docs/decisions/`.
