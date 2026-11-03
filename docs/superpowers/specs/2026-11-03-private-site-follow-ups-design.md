---
title: Private site follow-ups - a lease instead of the advisory lock, and SSI site IDs only through a Connection
summary: Backlog 0005 in two PRs. PR 1 replaces the PostgreSQL advisory lock (site find-or-make and buddy list) with a lease row that holds no connection, fixes four answers of the private-ID route and takes in the server findings parked from piece 4. PR 2 removes the plain SSI site ID route and field so every SSI ID a User types is checked with SSI through a Connection, and fixes the web findings. The public/private flip of backlog 0005 is recorded as not happening.
status: accepted
date: 2026-11-03
---

# Private site follow-ups

Backlog [0005](../../backlog/0005-private-site-follow-ups.md), from piece 4's final review
([SSI app alignment design](2026-10-23-ssi-app-alignment-design.md), [ADR 0057](../../decisions/0057-ssi-aligned-with-its-app.md)). Owner's look taken in
the brainstorm of 2026-11-03.

## Why

Piece 4 left two problems and a list of small ones:

- The send's site lock (`locked` in `apps/server/src/providers/advisory-lock.ts`) holds a pool connection for the whole
  find-or-make, SSI calls of up to 60 s each included, while its work needs further connections. About ten holders at once
  exhaust the pool (max 10). The buddy list uses the same lock (`buddies:<account>`), with the same problem. The lock also
  brings `pg` into `providers/` (ADR 0053).
- Every SSI site ID typed on the plain field of the site form is stored **public without asking SSI**. A typo, or someone's
  private site, becomes a shared public ID. A connected User sees that field beside the Connection field that does ask SSI,
  without knowing which to use (owner: "very niche"; someone with an SSI account who wants to share a site ID can connect).

Success: no lock holds a connection; every SSI ID a User types is checked with SSI; the parked findings are fixed or tested.

## Two PRs, one plan run

- **PR 1** (branch from `main`): the lease, the private-ID route fixes, the server findings, the flip recorded.
- **PR 2** (branch from PR 1's branch, its PR based on it until PR 1 merges): SSI site IDs only through a Connection, the web
  findings.

Both are built in one plan run (owner: "make them in one go"); the plan has one section per PR. `pnpm check` green and the
`architecture-review` subagent before each push.

## Not in scope

- Backlog 0003 (moving dives from a private site to its public counterpart) and 0017.
- Raising the database pool size.
- The dive centres' SSI number route (`PUT /api/dive-centres/{id}/external-ids/ssi`): a centre number is public by nature.
- `siteForSend` running before `updateThere`'s take (parked finding): the note calls it narrow and fixing it reorders the
  send. **Owner said "do them now" to the parked findings; this one is my call to leave, see "Calls made".**

## The flip (backlog Goal 2): recorded, not fixed

The note feared that a site SSI lists publicly but flags private for its owner flips between public (each Site import,
`publishIds`) and private (each logbook read, `settleVisibility`). It can't happen with SSI's data as it is: the Site import
leaves out every row the zip flags private (`parseSsiSites`, `apps/server/src/providers/ssi/ssi-sites.ts:75`), and the 43
sites the note counted are flagged private in the zip. A flip needs a site the zip lists **without** the flag while the
owner's logbook flags it; none is known (the owner's 4 private sites aren't in the zip). Owner: treat it as not happening.

- A test pins it: a zip row with `odin_dive_sites_is_private` set is left out (if not already covered).
- [ssi-app-api.md](../../references/ssi-app-api.md), the zip table's private row: one line that the import leaves these out,
  so its `publishIds` never publishes a private ID SSI flags, and the flip can't happen while that holds.
- The note's suggested fix (settle skips rows with `siteImportId`) is **not** built: `siteImportId` is "last delivered" and
  never cleared, so a site SSI later made private would stay public here.

## PR 1

### A lease instead of the advisory lock

A new table beside `dive_lease` in `db/schema.ts` (migration generated with drizzle-kit, reviewed, committed; the owner
agreed to the change in the brainstorm, the protected-path hook still asks):

| Column | Type | |
|---|---|---|
| `key` | text, primary key | e.g. `site-for-send:<site>:<account>`, `buddies:<account>` |
| `holder` | uuid, not null | the action holding it |
| `locked_until` | timestamptz, not null | runs out by itself |

Name: `provider_lease` (my call; the builder may pick a better one in the same style).

- Taken with one statement, as `dive_lease`'s `take`: insert, or on conflict take it over where `locked_until` has passed.
- Waiting as today's lock: try, sleep `POLL_MS` (250 ms), up to `MAX_WAIT_MS` (30 s), then `LeaseBusy` (which callers
  already turn into `provider_busy`). Nothing holds a connection while waiting or while holding; each query borrows one.
- Held for `LEASE_MS` (5 min). Released by deleting the row where `holder` matches; a failed release is logged and the
  lease runs out by itself (as `dive_lease`). No cleanup job: a row a crash left behind is taken over on the next take.
- The helper lives in `apps/server/src/providers/lease-service.ts` beside `dive` and `turn` (e.g. `leases.key(key, source, fn)`),
  so it needs the lease service where the three callers run: `siteForSend` (`providers/push/site-for-send.ts`),
  `buddiesForSend` (`providers/push/buddies-for-send.ts`) and the buddy service (`providers/buddies/buddy-service.ts`, two
  places). Today they call `locked(db, …, clock)`; how the lease service reaches them (a parameter, or through `deps`) is
  the builder's. The `clock` they pass for tests keeps working.
- `apps/server/src/providers/advisory-lock.ts` is deleted, and with it `pg` in `providers/`. Its tests move to the lease.
- Trade-off accepted (owner): a crashed holder blocks its key for up to 5 minutes, where the advisory lock was freed at once.
  A holder that outlives its 5 minutes could overlap the next; two SSI calls of 60 s at most make that unrealistic.
- This brings the code back in line with [ADR 0027](../../decisions/0027-providers-as-adapters.md), whose leases rule out
  advisory locks ("a transaction lock would hold a pool connection for the seconds a Provider call takes"); no ADR changes.
  `docs/spec/architecture.md:603` ("under an advisory lock") and the lease paragraph near line 527 name the new lease.

Tests (real PostgreSQL, our test rules): two sends at one site and account make one site at SSI; a second holder waits and
then gets `provider_busy`; an expired lease is taken over; and **no connection held**: with a pool of 2, two holders of
different keys whose work runs queries both finish.

### The private-ID route (`providers/site-pick.ts`)

- **No account:** a Connection whose Diver has no SSI account answers `provider_not_connected` (was
  `provider_unsupported`, line 59). The code exists; the client contract notes this route answers it.
- **SSI unreachable, another account holds the ID privately:** answers `provider_unavailable` instead of
  `external_id_taken`, which showed that the ID is held here. A public row holding it still answers `external_id_taken`.
- **A public pick over the account's own private row:** the account holds X privately on this site, SSI now calls X public,
  the User types X: in one transaction the private row is dropped and X stored as the site's public ID (Revision as usual,
  replacing another public ID as today). Today it is a 409 until the next settle.

### Server findings parked from piece 4

- `settleVisibility` (`sites/site-ids.ts`): one select, clash check and update per remote site on every send's find. Batched:
  the rows read with `inArray`, the clashes in one query, the updates as few statements as fit. Behaviour unchanged.
- `counts.created` (`sites/import/import-plan.ts:331`) counts a create the Site import then skips because the ID is held
  privately: counted only for creates that happen (or the skip counted on its own; the builder's, as long as the preview's
  numbers add up to what the import does).
- A site made at SSI whose `storeId` then fails is orphaned (`site-for-send.ts`, after `sites.create`): logged as an error
  with the SSI ID, the site and the account. Retries stay as they are.
- Missing tests: settle's clash skip; an invalid typed pattern on the private-ID route; `get` and `find` both answering
  unknown; the preview's count for a nameless site.

## PR 2: SSI site IDs only through a Connection

Owner: requiring a Connection to type an SSI site ID is fine; the plain route goes, not kept only for tests.

### Server

- `PUT /api/dive-sites/{id}/external-ids/{source}` (`sites/routes.ts:165`) and `setExternalId`
  (`sites/site-service.ts:308`) are removed, with `site_source_not_typed` if nothing else answers it.
- The Connection route (`PUT /api/connections/{id}/dive-sites/{siteId}`, `providers/site-pick.ts`) stores what replaces
  the ID the form shows (owner, 2026-11-03):
  - **SSI calls the typed ID public:** it becomes the site's public ID (Revision), and the account's private row on this
    site is dropped in the same transaction (PR 1's same-ID case is one instance of this).
  - **SSI calls it private (or doesn't say) while the site has a public ID:** refused with a clear answer, a new problem
    code such as `site_has_public_id` (409, "This dive site already has a public SSI ID"); a shared public ID is never
    removed because of one account's private site. The client contract lists it.
  - **SSI calls it private and the site has no public ID:** stored private to the account, replacing the account's
    private row, as today.
  - An ID the account holds privately on **another** site stays `external_id_taken` (moving IDs between sites is close
    to backlog 0003; my call).
- The Connection route takes over removal: `null` removes the ID the form shows for that Connection, which is the one a
  send would use (`pickId`: the public one, else the account's private one). With the rules above both rarely exist; if
  they do, the next empty removes the other. Removing a public ID writes a Revision, as the old route did. Who may: any
  User with that Connection (the old route let any User; my call).
- Tests: the 29 calls in 19 files that set an SSI ID through the old route for setup use one test helper that stores it
  directly (`storeId`), in `apps/server/test/`. The route's own tests (`site-external-ids.test.ts`) are deleted where they
  test the removed route, kept or moved where they test behaviour the Connection route now has.
- Browser tests (`apps/web/e2e/prepare.ts`, `support.ts`, `ssi-site-import.spec.ts`, `push-run.spec.ts`,
  `review-material.capture.ts`, `ui-quality.spec.ts`): set IDs through the fake SSI and a Connection, or a seeding helper
  of the e2e server; the builder's.

### Web (`apps/web/src/SiteForm.tsx`, `SitesPage.tsx`)

- **With an SSI Connection:** one field per Connection, labelled "SSI site ID" (with the Diver's name when the User has
  several), showing the ID a send would use and a note whether it is public or private to the account. Typing goes through
  the Connection; emptying removes the shown ID.
- **Without one:** no field; the site page shows the public ID read-only, as it does now.
- `ExternalIdField`, the plain save loop, and SSI's `siteIdLabel`/`siteIdHint` texts go if nothing else uses them.
- Findings: cancelling after a refused private ID leaves the site page stale (the form saved the site, then the ID step
  failed): cancel refreshes the site. The Diver label reads "()" while Divers load: no parentheses until the name is known.
  The merge preview compares by Source only (`SitesPage.tsx:446`), so a private ID that moves isn't listed: compare by
  Source and account, as the merge moves them.
- UI review: screenshots of the site form with one and with several Connections, and without one; a `ui-quality` case if
  the form's states change (page rules).

### Docs

- [clients.md](../../spec/clients.md) (lines on the site form and the route, ~564 and ~981), `docs/spec/data-model.md`,
  `docs/spec/architecture.md`, `docs/spec/README.md`: the route gone, SSI IDs typed through a Connection.
- ADR 0021 as amended by ADR 0029 says a typed site ID has its own route. **A new ADR draft** (`status: proposed`, our
  template) records that SSI site IDs are typed only through a Connection, checked with SSI, with the replace rules above,
  and amends 0021/0029. The owner said yes to writing it (2026-11-03); the protected-path hook still asks at the time, as
  for the migration. Execution runs in a session with the owner, so both asks are answered there.
- Backlog 0005: status done, with what was built and where; nothing parked is left.

## Calls made (not asked)

- Lease keyed by text, one table for both locks, instead of a (site, account) table.
- `siteForSend` before `updateThere`'s take stays parked (narrow; reorders the send). Moved to a new backlog note.
- The orphaned SSI site is logged, not retried.
- Removing an ID through the Connection route removes what the form shows; any User with that Connection may.
- An ID held privately on another site stays `external_id_taken`.
- The refusal's code name (`site_has_public_id`) is a suggestion; the builder may name it in the style of `problems.ts`.
- PR 2 is based on PR 1's branch.
- `settleVisibility`'s batching keeps today's order of "skip on clash", pinned by the new clash test first.
