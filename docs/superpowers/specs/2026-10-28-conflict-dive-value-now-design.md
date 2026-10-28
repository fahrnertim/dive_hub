---
title: A Conflict waits only while its two sides differ - the Dive's value now everywhere it is shown or counted
summary: Whether a Provider Conflict still waits is worked out on reading with a third check - the Dive's value now still differs from the Provider's as the run found it (compared as the send compares, with the comparable value the entry now stores). One read side in the conflict service serves the Dive's page, "Needs your decision" on the Review page and a Push run's count. Plus PR #11's deferred minors - changedSinceSent no longer pays for Conflicts, and a test for a profile imported without the Provider's max depth.
status: approved
date: 2026-10-28
---

# A Conflict waits only while its two sides differ

Design from a brainstorming session with the owner on 2026-10-28, following PR #11 (backlog 0002) and its "Rulings" and
"Deferred minors". "Owner" marks what the owner decided; "my call" marks what the designer decided and the owner may
overturn.

## Intent

PR #11 made the Dive's page show Dive Hub's side of a waiting Conflict as the Dive is now; the Review page's "Needs your
decision" still shows it as the run found it, so it can show an older value than the one a choice sends. And a Conflict
whose two sides became equal through an edit (the User typed the Provider's value) is still asked, although the send
already skips such a field (`planSend`: an open field is settled only `if (!same(field, provider, hub))`).

Logically a Conflict is a field changed on both sides, differently. Once the sides are equal it is no Conflict any more,
wherever it is shown or counted.

## Decisions

1. **Owner: one definition of "still waits", worked out on reading** (option B of the session). `conflicts.ts` already
   decides on reading that an entry waits while its Dive is live and its remote dive is the Dive's current one
   (`stillWaits`). A third check joins them: **at least one of the entry's fields still differs** between the Dive now
   and the Provider's value as the run found it. Fields that no longer differ are left out of what is shown; an entry
   with none left does not wait. The same check serves:
   - the Dive's page (`status.conflicts` / `statusAt`): `null` when no field is left;
   - "Needs your decision" (`GET /api/provider-conflicts`, `ConflictService.waiting`) and the per-Connection count in
     the Connection list, which is built from it;
   - a Push run's `conflicts` count (`waitingByRun`).

   Rejected: showing-only (A: the run's count and the list would disagree, undoing PR #11's point 1); closing fields
   when the Dive is edited (C: every path that changes a Dive would have to reach into providers, across
   [ADR 0053](../../decisions/0053-module-boundaries.md)'s boundaries, and a missed path leaves a wrong stored state).
   Nothing is written on reading: the stored entry stays until a send settles it, as today.

2. **Owner: compared as the send compares.** The entry stores, per field, the Provider's comparable value
   (`Comparable[field]` from `three-way.ts`) beside the shown ones, and the check is `same(field, provider, hubNow)`.
   `provider_conflict.fields` is `jsonb`: no migration. For `site`, the comparable value is the site's ID at a site
   Source, so the entry also keeps that Source, and Dive Hub's side is read with `hubOf(..., source, remoteSiteId)` as
   the send's `exchange` does. **My call:** the shape is the builder's (e.g. an optional `compared: { provider, siteSource? }`
   per stored field); it never leaves the server (the API's `ConflictFieldView` stays `{ field, hub, provider }`).
   Both places that record entries store it: the send's `settle` (`push-service.ts`) and the import's
   (`dive-import.ts`, `recordConflict`).

3. **My call: entries stored before this change** (no comparable value) fall back to comparing the shown values: Dive
   Hub's shown now against the stored Provider's shown, equal by `JSON.stringify`. Wrong only towards "still differs",
   which is today's behaviour.

4. **My call: a field the comparison no longer covers** (e.g. a value field of a Dive that got a primary Recording
   since, which `hubOf` leaves out of `fields`) still waits as stored, shown with Dive Hub's value now. The send leaves
   such a field alone too.

5. **My call: one read side, in the conflict service.** `hubNow` moves from `push-service.ts` into
   `createConflictService`, which gets what it needs (the provider registry and `createDiveChanges` with `blobs`) from
   `layer.ts`. `waitingByRun` becomes a method of the service; `push-run-service` takes the service (or that method)
   instead of importing the bare function; `statusAt` asks the service for the Dive's fields. The bare functions the
   send and import use to write (`record`, `entryOf`, `openFields`, `closeFields`, `close`) stay as they are, as the
   file's header says. Construction order in `layer.ts` changes accordingly (the conflict service before the push and
   push-run services). **My call:** the Review listing builds the comparison's run (`runOf`) once per Connection, not
   per entry; a Dive `hubOf` can't read keeps its entry waiting with the stored fields (as `hubNow` does today).
   Cost: a run listing is slower by one comparison per entry that passes the cheap checks
   (Dive live, remote dive current), which run first; those entries are few.

6. **Deferred minor (PR #11): `changedSinceSent` pays nothing for Conflicts.** It calls `statusAt` per candidate Dive and
   Provider and uses only `connection` and `current`. `statusAt` gets a way to leave the Conflicts out (my call: an
   option, or `changedSinceSent` uses a smaller helper; the builder's choice), so the filter does no comparison.

7. **Deferred minor (PR #11): a test for "profile imported, max depth not", with differing values.** In
   `ssi-dive-import.test.ts`'s "a field the Provider does not import, on a new Dive", with `importedWithout`: a record
   whose own max depth differs from the profile's deepest sample; the Recording's `maxDepthM` is the profile's.

8. **API text and client contract.** `routes.ts` (the `GET /api/provider-conflicts` field description, ~:821, and
   `status.conflicts`, ~:281) and `docs/spec/clients.md` ("Conflicts with a Provider", ~:717, and `status.conflicts`,
   ~:544) say: `hub` is the Dive's value now, `provider` the Provider's as the run found it; a field whose two values
   became equal is left out, and an entry with none left is not listed nor counted. The `pnpm` API client is regenerated
   if the descriptions are part of it. The PR #11 ruling ("the Review page keeps showing both values as the run found
   them") is replaced by this.

## Tests (first, against the real database)

- Review: a Dive edited after a Push run's Conflict lists its new value under `hub`; edited to the Provider's value, the
  field is gone, and with no field left the entry is not listed, the Connection's count and the run's `conflicts` are 0.
- The Dive's page: the same edit leaves the field out; none left gives `conflicts: null`.
- The site compared by ID: a Dive moved to a site with the same Provider ID as the Provider's is equal.
- An entry stored without comparable values (written straight into the table) still lists, and falls back to the shown
  values.
- `changedSinceSent`: unchanged results (existing tests); no Conflict work (by construction, not measured).
- The Recording test of decision 7.

## Non-goals

- No change to how entries are written, closed or chosen, nor to the send's or import's comparison.
- No web change: the pages render `hub` and `provider` as they come.
- The average depth's gap (PR #11 ruling) stays.

## Global constraints for the plan

[ADR 0053](../../decisions/0053-module-boundaries.md) (all of this stays in `apps/server/src/providers/`),
[ADR 0056](../../decisions/0056-two-way-exchange-and-automation.md), `karpathy-guidelines`, our test rules ([docs/skills.md](../../skills.md#overrides) override 3).
