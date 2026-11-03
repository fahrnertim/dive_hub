---
title: "Plan: private site follow-ups (backlog 0005) - a lease instead of the advisory lock, SSI site IDs only through a Connection"
summary: Two PRs in one run. PR 1 replaces the advisory lock with a provider_lease row, fixes the private-ID route's answers, batches settleVisibility and takes in the parked server findings. PR 2 removes the plain SSI site ID route and field, gives the Connection route the replace and remove rules, and fixes the web findings.
status: accepted
date: 2026-11-03
---

# Private site follow-ups: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backlog 0005 done in two PRs: no lock holds a pool connection, every SSI site ID a User types is checked with
SSI through a Connection, the parked findings fixed or tested; `pnpm check` green and the architecture review run before
each push.

**Architecture:** PR 1 is server only: a `provider_lease` table and a `keyLease` helper in
`apps/server/src/providers/lease-service.ts` replace `providers/advisory-lock.ts` for the three callers; fixes in
`providers/site-pick.ts`, `sites/site-ids.ts`, `sites/import/site-import-service.ts`, `providers/push/site-for-send.ts`.
PR 2 removes `PUT /api/dive-sites/{id}/external-ids/{source}` (server, tests, browser tests) and reshapes the SSI field
of `apps/web/src/SiteForm.tsx`; the Connection route (`PUT /api/connections/{id}/dive-sites/{siteId}`) takes over.

**Tech Stack:** Fastify + TypeBox, Drizzle + PostgreSQL (drizzle-kit migrations), Vitest against a real PostgreSQL,
React + React Aria + TanStack Query, i18next (en, de), Playwright.

**Spec:** [docs/superpowers/specs/2026-11-03-private-site-follow-ups-design.md](../specs/2026-11-03-private-site-follow-ups-design.md)
(accepted 2026-11-03). Backlog: [0005](../../backlog/0005-private-site-follow-ups.md).

## Global Constraints

- [ADR 0053](../../decisions/0053-module-boundaries.md): no new import across modules; `pg` leaves `providers/`
  (only `db/` and tests import it). [ADR 0027](../../decisions/0027-providers-as-adapters.md): leases, not advisory
  locks; nothing holds a pool connection while a Provider is called. [ADR 0057](../../decisions/0057-ssi-aligned-with-its-app.md):
  a public ID only where SSI says public; "unknown" is private. [ADR 0021](../../decisions/0021-site-external-ids-and-import.md)
  as amended by [ADR 0029](../../decisions/0029-push-requirements-and-buddies.md): changed only by the new draft ADR of Task 7.
- Out of scope: backlog 0003 and 0017; the pool size (stays 10); the dive centres' SSI number route; `siteForSend`
  before `updateThere`'s take (Task 5 parks it as a backlog note).
- Protected paths ask the owner (the hook does): `apps/server/src/db/schema.ts`, `apps/server/drizzle/**` (Task 1),
  `docs/decisions/**` (Task 7). The owner agreed to both in the brainstorm; answer the hook's ask, don't work around it.
  Migration: stop the dev server, `pnpm --filter @dive-hub/server db:generate`, review the SQL, never edit an applied one.
- Tests first (`superpowers:test-driven-development`), against a real PostgreSQL; at most one `vi.fn`, no `vi.mock`;
  browser tests carry an area tag; `pnpm`, never `npm`.
- After a failing check iterate with `pnpm check --failed` or `pnpm check --tests "<filter>"`; one full `pnpm check`
  after the last edit of a task (comments too), then commit at once.
- `karpathy-guidelines` (load it before Task 1): every changed line traces to a task below. Skills: `postgres-drizzle`
  (Tasks 1, 4), `fastify-best-practices` (Tasks 3, 7), `vitest` (all), `tanstack-query-best-practices`, `accessibility`,
  `playwright-cli` (Task 8), each with its override in [skills.md](../../skills.md#overrides).
- Every new or changed text in **en and de** (`apps/web/src/i18n/locales/`). A new API answer or duty goes into
  [clients.md](../../spec/clients.md).
- Branches: PR 1 on `private-site-follow-ups` from `main`; PR 2 on `ssi-site-ids-by-connection` from PR 1's last commit,
  its PR based on `private-site-follow-ups`. Never merge locally; PR #20 and #22 are not touched.

## Review Focus

1. **`fn` throws while the lease is held**: the lease is given back at once, so the next taker doesn't wait 5 minutes
   (Task 1 test `gives the lease back when the work fails`).
2. **A holder that outlived its lease**: another took the key; the first one's release must not delete the second's row
   (release matches `holder`) (Task 1 test `leaves a lease another holder took over after it ran out`).
3. **Typing the ID the field already shows**: no SSI change, no new Revision, 200 (Task 7 test
   `typing the shown ID again changes nothing`).
4. **Emptying a field that shows nothing**: 200 and nothing changes (Task 7 test `removes nothing when the field shows nothing`).
5. **SSI unreachable while the site has a public ID**: the typed ID would be "unknown" (private), so it is refused with
   `site_has_public_id`, and the public ID stays (Task 7 test `keeps the public ID when SSI can't be asked`).

---

## PR 1: `private-site-follow-ups`

### Task 1: The `provider_lease` table and `keyLease`

**Files:**
- Modify: `apps/server/src/db/schema.ts` (beside `diveLease`, ~line 984)
- Create: `apps/server/drizzle/00NN_<generated>.sql` (+ `meta/`), generated
- Modify: `apps/server/src/providers/lease-service.ts`
- Test: `apps/server/test/key-lease.test.ts` (new)

**Interfaces:**
- Produces: table `providerLease` (`provider_lease`: `key text primary key`, `holder uuid not null`,
  `locked_until timestamptz not null`), doc comment in the style of `diveLease`'s.
- Produces: `export async function keyLease<T>(db: Db, lease: { key: string; source: string; clock: Clock; log?: ProviderLog }, fn: () => Promise<T>): Promise<T>`
  in `lease-service.ts`. Takes with one insert … on conflict (key) do update set holder, locked_until where
  `locked_until < now` returning holder (as `take`); else sleeps `POLL_MS` and tries again until `MAX_WAIT_MS`, then
  `throw new LeaseBusy(source)`. Holds for `LEASE_MS`. Releases in `finally` with delete where key and holder match; a
  failed release goes to `log?.error(...)` and never replaces `fn`'s answer or error. Holds no connection between
  statements.

- [ ] **Step 1: Write the failing tests** in `key-lease.test.ts` (`createTestDatabase`, a `resettableClock({ stopped: true })` as in `leases.test.ts`):
  - `runs one holder per key at a time and the next after it`: two `keyLease` calls on key `k`, the first's `fn` waits on a
    promise the test resolves; the second's `fn` starts only after it (record order `['a-start','a-end','b-start']`).
  - `refuses with LeaseBusy after MAX_WAIT_MS`: a row for `k` with `lockedUntil = now + LEASE_MS`; `keyLease` rejects with
    `LeaseBusy` whose `provider` is the given source; the clock slept in steps of `POLL_MS`.
  - `takes over a lease that ran out`: a row with `lockedUntil = now - 1`; `fn` runs; afterwards no row for `k`.
  - `gives the lease back when the work fails`: `fn` throws `new Error('x')`; rejects with it; no row for `k`.
  - `leaves a lease another holder took over after it ran out`: in `fn`, `clock.skip(LEASE_MS + 1)` and a second
    `keyLease` on `k` takes it and is still holding when the first returns; the row's holder is the second's.
  - `holds no connection: two holders of different keys on a pool of one, whose work queries, both finish`:
    `new pg.Pool({ connectionString: t.pool.options.connectionString, max: 1 })`, `drizzle(small, { schema })`; each
    `fn` runs `select 1` twice with a `clock`-free await between; both resolve.
- [ ] **Step 2:** Run `pnpm check --tests key-lease`; expected: FAIL (`keyLease` not exported).
- [ ] **Step 3:** Add `providerLease` to `schema.ts` (hook asks: yes from the owner), stop the dev server,
  `pnpm --filter @dive-hub/server db:generate`, read the SQL (one `CREATE TABLE "provider_lease"`, nothing else).
- [ ] **Step 4:** Implement `keyLease` as in Interfaces.
- [ ] **Step 5:** Run `pnpm check --tests key-lease`; expected: 6 PASS.
- [ ] **Step 6:** `pnpm check`; commit `Server: provider_lease and keyLease, a lease per key that holds no connection (backlog 0005)`.

### Task 2: The three callers on `keyLease`; `advisory-lock.ts` gone

**Files:**
- Modify: `apps/server/src/providers/push/site-for-send.ts:13,40`, `providers/push/buddies-for-send.ts:10,50`,
  `providers/buddies/buddy-service.ts:13,101,123`
- Delete: `apps/server/src/providers/advisory-lock.ts`
- Modify: `docs/spec/architecture.md` (~527 and ~603: the lease, no advisory lock)
- Test: `apps/server/test/site-for-send.test.ts`

**Interfaces:**
- Consumes: `keyLease` (Task 1). Keys unchanged: `` `site-for-send:${siteId}:${account}` ``, `` `buddies:${accountId}` ``.
  Callers pass `{ key, source, clock: s.clock ?? realClock }`; `buddy-service.ts` uses `realClock` as today. Signatures
  of `siteForSend` and `buddiesForSend` stay.

- [ ] **Step 1: Write the failing test** in `site-for-send.test.ts`, beside the pool-of-two test:
  `a holder needs no connection of its own: sends at two new sites on a pool of one finish` — two sites
  (`newSite('Lone A', 23)`, `newSite('Lone B', 24)`), `siteForSend` for each on `drizzle(new pg.Pool({ …, max: 1 }))`,
  `Promise.all` resolves to `['created','created']` and `siteSaves()` grew by 2.
- [ ] **Step 2:** Run `pnpm check --tests "pool of one"`; expected: FAIL (time-out: the holder's session takes the one connection).
- [ ] **Step 3:** Switch the four call sites to `keyLease`, delete `advisory-lock.ts`, update the two lines in `architecture.md`.
  `grep -r "from 'pg'" apps/server/src/providers` must print nothing.
- [ ] **Step 4:** Run `pnpm check --tests "site-for-send|buddies-for-send|ssi-buddies"`; expected: all PASS.
- [ ] **Step 5:** `pnpm check`; commit `Server: the site and buddy locks are leases; the advisory lock is gone (ADR 0027, backlog 0005)`.

### Task 3: The private-ID route's answers

**Files:**
- Modify: `apps/server/src/providers/site-pick.ts`, `providers/dive-provider-routes.ts:~70` (route description)
- Modify: `docs/spec/clients.md` (the private-ID route's answers)
- Test: `apps/server/test/site-pick.test.ts`

**Interfaces:**
- `visibilityOf` answers `'public' | 'private' | 'unknown' | 'unreachable' | null`: `'unreachable'` where both asks
  failed with `provider_unavailable` (today's second `catch`). `'unknown'` and `'unreachable'` both store private.
- Uses `holderOf` (`sites/site-ids.ts`) to tell who holds a refused ID.

- [ ] **Step 1: Write the failing tests** (helpers `newSite`, `ssiSite`, `pick`, `rowsOf` of the file):
  - `answers provider_not_connected when the Connection's Diver has no SSI account`: delete Tim's `diver_external_id`
    row for SSI (restore in `finally`, or use a second Diver); `pick` answers 409 `code: 'provider_not_connected'`.
  - `answers provider_unavailable, not external_id_taken, when SSI can't be asked and another account holds the ID privately`:
    another site holds `4120` private to Ann's account (`storeId` with `accountOf(t.db, annDiver, 'ssi')`);
    `ctx.fakeSsi.failWith = 503`; `pick(site, '4120')` → 502 `code: 'provider_unavailable'`; `rowsOf(site)` `[]`.
  - `still answers external_id_taken when SSI can't be asked and a public row holds the ID`.
  - `stores a public ID over the account's own private row on the site, with a Revision`: site holds `4121` private to
    Tim's account; `ssiSite(4121, { odin_dive_sites_is_private: 0 })`; `pick(site, '4121')` →
    `{ externalId: '4121', private: false }`; `rowsOf(site)` `[{ externalId: '4121', accountId: null }]`. Same with a
    private row `4122` and a typed public `4123`: rows `[{ externalId: '4123', accountId: null }]`.
  - `refuses an ID that doesn't match SSI's pattern`: `pick(site, 'abc')` → 400 `invalid_input`; no SSI call.
  - `stores private when neither get nor find says`: `ssiSite(4124, { odin_dive_sites_is_private: null })` (row without
    the flag) → `{ private: true }`.
- [ ] **Step 2:** Run `pnpm check --tests site-pick`; expected: the new ones FAIL except those already true (keep them as pins).
- [ ] **Step 3:** In `set`: `provider_not_connected` at line 59; `'unreachable'` from `visibilityOf`; on `external_id_taken`
  with visibility `'unreachable'` and `holderOf(...).accountId` set and not `account`, throw `provider_unavailable`;
  when storing public, in the same transaction delete the account's private row of this site at this Source first.
  Route description and clients.md name the three answers.
- [ ] **Step 4:** Run `pnpm check --tests site-pick`; expected: all PASS.
- [ ] **Step 5:** `pnpm check`; commit `Server: the private-ID route answers provider_not_connected, keeps a held ID unsaid while SSI is away, and lets a public ID replace the account's private one (backlog 0005)`.

### Task 4: Settle in batches, the import's count, the orphan log, the missing pins

**Files:**
- Modify: `apps/server/src/sites/site-ids.ts:228-240` (`settleVisibility`)
- Modify: `apps/server/src/sites/import/site-import-service.ts:~180-198`
- Modify: `apps/server/src/providers/push/site-for-send.ts:76-77`
- Modify: `docs/references/ssi-app-api.md` (zip table, private row, ~436)
- Test: `apps/server/test/private-site-ids.test.ts`, `site-import.test.ts`, `site-for-send.test.ts`,
  `ssi-sites-api.test.ts` (or the file that tests `parseSsiSites`), the dive import preview's test file (search `missing` with `sites:`)

**Interfaces:**
- `settleVisibility(tx, source, accountId, remote)` keeps its signature and behaviour: rows by `inArray(externalId, …)`
  in one select, clashes in one select, then the updates; a change that would give a site two rows of one kind is skipped.
- `siteForSend` takes an optional `log?: ProviderLog` (push-service passes its `log`); after `sites.create`, a failing
  store logs `{ err, site: site.id, source, externalId: created, account }` with "a site made at the Provider could not
  be stored; it is orphaned there" and rethrows.

- [ ] **Step 1: Write the failing tests:**
  - `settle skips a change that would give the site two public rows` (private-site-ids): site has public `5001` and
    Tim's private `5002`; `settleVisibility(tx, 'ssi', account, [{ externalId: '5002', private: false }])` leaves both rows.
  - `settle makes a public row private and a private one public in one call` (same file): pins the batched path.
  - `counts no create the import skipped because the ID is held privately` (site-import): an SSI ID held private on a
    site here, the zip lists it with a far position and another name; after the import `counts.created` is 0.
  - `logs a site made at SSI whose ID could not be stored` (site-for-send): make `storeId` fail by holding the ID SSI
    will answer on another site first (`ctx.fakeSsi` next ID); the one `vi.fn` is `log.error`, called once with
    `externalId`.
  - `leaves out a zip row SSI flags private` (`parseSsiSites` test file), if no test covers it yet.
  - `counts a nameless site of a dive import's preview as missing` (preview test file).
- [ ] **Step 2:** Run `pnpm check --tests "settle|counts no create|orphan|flags private|nameless"`; expected: the
  count and log tests FAIL; the pins may pass (keep them).
- [ ] **Step 3:** Batch `settleVisibility`; count the creates `create()` skipped and store `created: plan.counts.created - skipped`;
  add the log; one line in `ssi-app-api.md`: the Site import leaves these rows out, so `publishIds` never publishes an ID
  SSI flags private and the public/private flip of backlog 0005 can't happen while that holds.
- [ ] **Step 4:** Run the filter again; expected: all PASS.
- [ ] **Step 5:** `pnpm check`; commit `Server: settle in batches, the import counts only made sites, an orphaned SSI site is logged; pins for piece 4's gaps (backlog 0005)`.

### Task 5: Finish PR 1

- [ ] **Step 1:** New `docs/backlog/00NN-site-for-send-before-take.md` (next free number, frontmatter as 0005's,
  `status: draft`): `siteForSend` runs before `updateThere`'s take, so it may make an SSI site for the Dive's old site;
  narrow; fixing it reorders the send. In backlog 0005: Goal 1 and the server findings marked done with their commits;
  Goal 2 "not happening (see ssi-app-api.md)"; the web findings left for PR 2.
- [ ] **Step 2:** `pnpm check` green; run the `architecture-review` subagent; fix findings with `path:line` and a rule.
- [ ] **Step 3:** Push `private-site-follow-ups`; open the PR against `main` (what changed, the trade-off "a crashed
  holder blocks its key up to 5 minutes", the parked note).

---

## PR 2: `ssi-site-ids-by-connection` (from PR 1's branch)

### Task 6: Test and browser-test setup without the old route

**Files:**
- Modify: `apps/server/test/support.ts` (helper), the 19 test files that `PUT /api/dive-sites/…/external-ids/…`
- Modify: `apps/server/test/e2e-server.ts` (a seeding route), `apps/web/e2e/prepare.ts:89`, `support.ts:311,519,720`,
  `push-run.spec.ts:41,135,174,238`, `review-material.capture.ts:470,477,753`, `ssi-site-import.spec.ts:18`, `ui-quality.spec.ts:146`

**Interfaces:**
- Produces: `export async function setPublicSiteId(db: Db, siteId: string, externalId: string | null, source: SiteSource = 'ssi'): Promise<void>`
  in `apps/server/test/support.ts`: `storeId` (public, `actor: null`) or `clearId(tx, siteId, source, null, null)` in a transaction.
- Produces: `POST /e2e/site-id` `{ siteId, externalId: string | null }` (hidden, as the other `/e2e/` routes) calling the same.
- Tests that assert the old route's Revision on an ID keep their assertion only if Task 7 moves it to the Connection route.

- [ ] **Step 1:** Add the helper and the e2e route; replace every setup call (not the tests of the route itself in
  `site-external-ids.test.ts`). `grep -rn "dive-sites/[^']*external-ids" apps/server/test apps/web/e2e` lists only
  `site-external-ids.test.ts`.
- [ ] **Step 2:** `pnpm check`; expected: green (behaviour unchanged). Commit `Tests: SSI site IDs set up without the plain route (backlog 0005)`.

### Task 7: The Connection route replaces and removes; the plain route gone; the ADR draft

**Files:**
- Modify: `apps/server/src/providers/site-pick.ts`, `providers/dive-provider-routes.ts`, `providers/registry.ts:~61`
  (`ProblemCode`), `providers/route-parts.ts:23` (409), `http/problems.ts`, `apps/web/src/i18n/locales/{en,de}.json` (problem text)
- Modify: `apps/server/src/sites/routes.ts:165-180`, `sites/site-service.ts:303-319`, `sites/site-error.ts` (drop
  `site_source_not_typed` if nothing else answers it, with its problem text and locale lines)
- Modify: `docs/spec/clients.md` (~564, ~981), `docs/spec/data-model.md`, `docs/spec/architecture.md`, `docs/spec/README.md`
- Create: `docs/decisions/00NN-ssi-site-ids-through-a-connection.md` (next number, our template, `status: proposed`)
- Test: `apps/server/test/site-pick.test.ts`; `site-external-ids.test.ts` (route tests deleted; behaviour that moved is tested in site-pick)

**Interfaces:**
- `set(userId, connectionId, siteId, typed)` keeps its answer `{ externalId, private }`. Rules (spec, "PR 2 / Server"):
  public → stored public, the account's private row of the site dropped (Task 3); private or unknown/unreachable while the
  site has a public row at the Source → `ProviderServiceError('site_has_public_id')`, 409, en "This dive site already has
  a public SSI ID" / de "Dieser Tauchplatz hat schon eine öffentliche SSI-ID"; private and no public row → stored private.
  `typed === null` removes the shown ID (`pickId(rows, source, account)`): public → `clearId(tx, siteId, source, null, { type: 'user', id: userId })`
  (Revision), private → as today; answers `{ externalId: <the ID now shown or null>, private: <its kind> }`.
  Typing the shown ID again: no store, no Revision.

- [ ] **Step 1: Write the failing tests** (site-pick):
  - `refuses a private ID while the site has a public one`: public `4130` on the site, `ssiSite(4131, { odin_dive_sites_is_private: 1, odin_dive_sites_is_private_owner: ACCOUNT_X })`;
    `pick(site, '4131')` → 409 `site_has_public_id`; rows unchanged.
  - `keeps the public ID when SSI can't be asked` (Review Focus 5): public `4132`, `failWith = 503`, `pick(site, '4133')` → 409 `site_has_public_id`.
  - `removes the public ID the field shows, with a Revision, then the private one`: public `4134` and Tim's private `4135`;
    `pick(site, null)` → `{ externalId: '4135', private: true }` and the site's history has the removal; again → `{ externalId: null, private: false }`.
  - `removes nothing when the field shows nothing` (Review Focus 4): 200 `{ externalId: null, private: false }`.
  - `typing the shown ID again changes nothing` (Review Focus 3): public `4136`, `pick(site, '4136')` twice; one Revision.
  - In `site-external-ids.test.ts` (or a route test): `PUT /api/dive-sites/{id}/external-ids/ssi` answers 404.
- [ ] **Step 2:** Run `pnpm check --tests "site-pick|site-external-ids"`; expected: the new ones FAIL.
- [ ] **Step 3:** Implement the rules; remove the plain route, `setExternalId` and (if unused) `site_source_not_typed`;
  update the route description and the four spec documents. Write the ADR draft (hook asks: yes from the owner): context
  (the plain route stored public without asking SSI), decision (typed only through a Connection, the replace and remove
  rules, any User with that Connection may remove), amends 0021 and 0029.
- [ ] **Step 4:** Run the filter again; expected: all PASS.
- [ ] **Step 5:** `pnpm check`; commit `Server: SSI site IDs only through a Connection, which replaces and removes what the field shows (ADR draft, backlog 0005)`.

### Task 8: The site form's one SSI field; the web findings

**Files:**
- Modify: `apps/web/src/SiteForm.tsx` (drop `ExternalIdField`, the plain save loop, `externalIds` in `Draft`; one field
  per Connection), `apps/web/src/SitesPage.tsx:189` (label), `:446` (merge preview), `apps/web/src/i18n/locales/{en,de}.json`
  (`siteIdLabel`/`siteIdHint` at ~1367 go if unused; ProviderPanel's `siteIdHint` at ~1731 stays)
- Test: `apps/web/e2e/` (the spec that covers the site form's SSI field; search `privateSiteIdLabel` text), `ui-quality.spec.ts`

**Interfaces:**
- Consumes: Task 7's route rules and `site_has_public_id`.
- Field per SSI Connection: label "SSI site ID" (en) / "SSI-Tauchplatz-ID" (de), with ` (<Diver>)` only when the User has
  several and the name is known; value = the ID a send would use for that Connection's Diver (public, else the Diver's
  private); description says "Public: every SSI user can use it." / "Private to <Diver>'s SSI account." (en, with de).
  Emptying sends `null`. No Connection: no field.

- [ ] **Step 1: Write the failing browser tests** (area tag of the site pages):
  - `the site form shows one SSI field for a connected User, saying whether the ID is public`.
  - `the site form shows no SSI field without a Connection; the site page shows the public ID`.
  - `cancelling after a refused SSI ID shows the saved site`: rename the site and type an ID SSI refuses
    (`provider_site_unknown`), then Cancel: the site page shows the new name.
  - `the merge preview lists a private SSI ID that moves to a site with a public one`.
  - A `ui-quality.spec.ts` case for the form with an SSI Connection.
- [ ] **Step 2:** Run `pnpm check --tests "<the names above>"`; expected: FAIL.
- [ ] **Step 3:** Implement: the field; on Cancel after a step saved (`created.current`), set the site's query data to it
  and invalidate `keys.site(id)`; the label without "()" (`SitesPage.tsx:189`: the name, else no suffix); the merge
  preview compares `source` and `privateTo?.diverId`.
- [ ] **Step 4:** Run the filter again; expected: PASS. Capture the site form (one Connection, two, none) with
  `REVIEW_AREAS` and look at the screenshots at phone and desktop width.
- [ ] **Step 5:** `pnpm check`; commit `Web: one SSI site ID field through the Connection; fresh site after cancel, no "()" label, the merge preview counts private IDs (backlog 0005)`.

### Task 9: Finish PR 2

- [ ] **Step 1:** Backlog 0005 `status: done`, every point with where it went; nothing parked left in it.
- [ ] **Step 2:** `pnpm check` green; run the `architecture-review` subagent; fix findings.
- [ ] **Step 3:** Push `ssi-site-ids-by-connection`; open the PR with base `private-site-follow-ups` (the removed route
  named for API clients, the ADR draft linked, screenshots).
