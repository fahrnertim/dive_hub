---
title: "Plan: sites (piece 4 of the SSI app alignment)"
summary: Piece 4 of the SSI app alignment design - a Dive whose site has no SSI ID is sent anyway; the send takes the site's public ID, else the account's private one, else a nearby site of the account's logbook, else creates the site at SSI as private; private site IDs belong to the Diver's SSI account (dive_site_external_id.account_id → diver_external_id), only the sites module reads the table and no User sees another account's private ID; a picked or typed ID is asked of SSI (get_divesite); checks on the owner's account first (what save_divesite and get_divesite answer, whether a site can be deleted) and last (a private site usable on a dive and in no public list).
status: ready
date: 2026-10-24
---

# Sites: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Dive whose site has no SSI ID can be sent: Dive Hub finds the site in the account's SSI logbook or creates
it there as a private site. A private SSI ID is only ever used for, and shown to, its own SSI account.

**Architecture:** `dive_site_external_id` gets `account_id` (→ `diver_external_id`, `on delete cascade`; empty =
public). A new `sites/site-ids.ts` is the only reader and writer of the table: what IDs a User or a Diver's account may
see, which one a send uses, storing one, settling SSI's private flag. A new `providers/site-for-send.ts` runs in the
send, inside the Connection's access, before the requirements are checked: it finds or creates the site through the
adapter's `diveSites` (`find`, new `get` and `create`). A picked or typed ID goes through a new Connection route that
asks the Provider whether the site exists and is private.

**Tech Stack:** TypeScript (ESM, Node), Fastify + TypeBox, Drizzle 0.45 on PostgreSQL, vitest against a real
PostgreSQL, the fake SSI (`apps/server/test/fake-ssi.ts`, `/e2e/fake-ssi/*` in `test/e2e-server.ts`), React + React
Aria, Playwright, tsx for the check script.

**Spec:** [docs/superpowers/specs/2026-10-23-ssi-app-alignment-design.md](../specs/2026-10-23-ssi-app-alignment-design.md):
the "SSI (owner)" Sites bullet, piece 4, and **"Piece 4, settled 2026-10-24"** (this plan's main source).
[ADR 0057](../../decisions/0057-ssi-aligned-with-its-app.md) (proposed, amended 2026-10-24: private site IDs).
Background: [ADR 0021](../../decisions/0021-site-external-ids-and-import.md) (External IDs, the 100 m rule),
[ADR 0029](../../decisions/0029-push-requirements-and-buddies.md) (requirements),
[ADR 0030](../../decisions/0030-importing-dives-from-providers.md) (the import's sites),
[ADR 0056](../../decisions/0056-two-way-exchange-and-automation.md) (the site is never cleared), the
[write bodies](../../research/2026-10-22-ssi-write-bodies.md) (`siteUpload`).

## Global Constraints

- Module rules of [ADR 0053](../../decisions/0053-module-boundaries.md): routes → services → db, no cycles (not even
  through a type import), `MODULE_IMPORTS` in `.dependency-cruiser.cjs` (`sites` may import `dives`, `providers`;
  `providers` may import `sites`). `sites/site-ids.ts` imports only `db/` and other `sites/` files, never `providers/`;
  it defines its own small input types instead of importing `RemoteSite`.
- **After Task 2 no file outside `sites/site-ids.ts` names `diveSiteExternalId` or `dive_site_external_id`**, except
  `db/schema.ts`, migrations and tests. Task 2's grep checks it.
- No `odin_*` key outside `apps/server/src/providers/ssi/` and its tests ([ADR 0027](../../decisions/0027-providers-as-adapters.md)).
  `site-for-send.ts`, `push-service.ts`, `site-ids.ts` and the routes never name SSI.
- The User-Agent stays `Dart/3.12 (dart:io)` ([ADR 0049](../../decisions/0049-ssi-app-user-agent.md)). Nothing logs a URL, a token or a password.
- **Protected paths ask the owner:** migrations and `db/schema.ts` (Task 1), `apps/server/src/providers/` (asks no
  longer, ADR 0058), `docs/decisions/**` (none planned: ADR 0057's amendment is written). A task that would change an
  accepted ADR stops with `STOP: <reason>`.
- Tests never reach SSI. Tests come first. At most one `vi.fn` per test, no `vi.mock`. Database tests run against the
  real PostgreSQL. Every browser test has an area tag (`@dives` for the Dive page, `@sites` for the site page).
- Commands: one server file `pnpm --filter @dive-hub/server exec vitest run test/<file>.test.ts`; one browser file
  `pnpm --filter @dive-hub/web test:e2e e2e/<file>.spec.ts`; before each commit `pnpm check` (green); before a push
  `pnpm check:full`; a migration with `pnpm --filter @dive-hub/server db:generate` (never `drizzle-kit push`).
- New server files in `sites/` and `providers/` are covered by `AREAS`' folder patterns in `scripts/check-lib.mjs`; a new
  web file gets its name into the matching pattern (`@dives` or `@sites`). A new state gets a case in `e2e/ui-quality.spec.ts`.
  UI words in `apps/web/src/i18n/locales/en.json` and `de.json`. The [client contract](../../spec/clients.md) changes
  in the task that changes the API.
- The rules (from the design's "Piece 4" section):
  - **Visibility.** A row with `account_id` empty is public: every User and every send may use it. A row with
    `account_id` is private to that `diver_external_id` (one SSI account): only sends for that Diver use it, and only
    Users who manage that Diver (`diver_management`) see it. The row's `source` equals the account row's `source`
    (checked in code; the enums are separate).
  - **Uniqueness.** `(source, external_id)` once, public or private (SSI has one ID space). At most one public row per
    `(site_id, source)`. At most one private row per `(site_id, source, account_id)`.
  - **Which ID a send uses:** with a remote dive whose site ID is one of this site's IDs the Diver's account may use
    (public or private) → that one (an update never moves a dive between them); else the public ID; else the private
    one; else a logbook site within 100 m (`MATCH_WITHIN_M`) with matching names (`namesMatch`) whose ID no other site
    here holds, stored public or private as the Provider marks it; else a new site at the Provider, private (name,
    position, country, water type), stored private. Same in a manual send and a Push run.
  - The requirement `site_external_id` doesn't block a Dive whose site has a position when the Provider can create
    sites. Without a site, or with a site without a position, it blocks as today.
  - **No Revision** on the site for setting, changing or removing a private ID (site history is shared). A public ID
    keeps its Revisions as today.
  - **Merge:** keyed by `(source, account_id)`: the kept site's row wins, the removed site's row of the same key stays
    on the removed site (as public IDs do today); other rows move. A Revision only for moved public rows.
  - **Settling SSI's flag:** a logbook site private and owned by the account whose ID is a public row here → the row
    becomes private to the account; a logbook site public whose row here is private → `account_id` cleared. A logbook
    site private and owned by **another** account is dropped from the adapter's lists (unusable; never stored).
  - Deleting a site or a Dive here never deletes the site at SSI. A site created at SSI whose dive save then fails
    keeps its stored ID.
- Owner's account: the token is kept in `samples/private/ssi/` (the owner signs in with `round-trip.ts read` in their own
  terminal). Before running a check mode, announce it in one line: the mode and what it writes. Test data is dated
  2000-01-01 or named "Dive Hub test", and deleted afterwards. The password never reaches an agent.

## Review Focus

1. **Another User's private ID leaks** through any reader: the site list and page, the site picker's suggestions, the
   MCP site tools, the site import's matching, a dive import for another account, a merge's Revision. Test in Task 2
   (one test per reader, two Users, two SSI accounts).
2. **A send retried after a sign-in** (`withAccess` reruns the action) after the site was created at SSI: the retry finds
   the stored ID and creates no second site. Test in Task 4.
3. **A User who manages two Divers with their own SSI accounts** sends one Diver's dive: only that Diver's private ID is
   used, never the other's, although the User sees both. Test in Task 4.
4. **A typed ID SSI doesn't know** (mistyped) is refused (`provider_site_unknown`) and nothing is stored; SSI unavailable
   while typing → stored private, never public. Test in Task 5.
5. **The account's private site that SSI publishes** (same ID, now public in the logbook) loses `account_id` on the next
   read and then serves every User. Test in Task 3.

Known consequence (my call, said in the finish summary): a typed ID through the old route
`PUT /api/dive-sites/{id}/external-ids/{source}` is still stored public without asking SSI; the client contract says to
use the Connection route whenever the User has a Connection for that Source.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `apps/server/test/fixtures/ssi/round-trip.ts`, `site-checks.ts` (new) | modify / create | modes `site probe` (Task 0) and `site visible start/global/zip/finish` (Task 8) |
| `apps/server/src/db/schema.ts`, `apps/server/drizzle/0040_private_site_ids.sql` | modify / create | `account_id`, the indexes (protected) |
| `apps/server/src/sites/site-ids.ts` | create | the only reader and writer of `dive_site_external_id` |
| `apps/server/src/sites/site-service.ts`, `sites/provider-sites.ts`, `sites/import/site-import-service.ts`, `sites/routes.ts` | modify | use `site-ids.ts`; `privateTo` in the site view |
| `apps/server/src/mcp/tools-sites.ts` | modify | use `site-ids.ts` (visible IDs only) |
| `apps/server/src/providers/outgoing-dive.ts`, `providers/dive-changes.ts`, `providers/dive-import.ts` | modify | the send's and the comparison's site ID by the rule; the import's privacy |
| `apps/server/src/providers/provider.ts` | modify | `RemoteSite.visibility`, `diveSites.get/create`, `Requirement.createdBySend` |
| `apps/server/src/providers/ssi/ssi-client.ts`, `ssi-adapter.ts`, `ssi-site-record.ts` (new) | modify / create | `get_divesite`, `save_divesite`, the logbook's privacy |
| `apps/server/src/providers/requirements.ts` | modify | `Unmet.bySend` |
| `apps/server/src/providers/site-for-send.ts` | create | find or create the site during a send |
| `apps/server/src/providers/push-service.ts`, `providers/routes.ts` | modify | the send step; `PUT /api/connections/{id}/dive-sites/{siteId}` |
| `apps/server/test/fake-ssi.ts`, `test/e2e-server.ts` | modify | `get_divesite`, `save_divesite`, private sites |
| `apps/web/src/ProviderPanel.tsx`, `SiteForm.tsx`, `lib/providers.ts`, locales | modify | "sending finds or creates", picking through the Connection, "Your private SSI site" |
| `docs/spec/clients.md`, `spec/architecture.md`, `spec/data-model.md`, `references/ssi-app-api.md`, `glossary.md`, `research/…` | modify / create | contract, behaviour, [T] results |

---

### Task 0: Check on the owner's account: what SSI answers for sites

Runs first: Tasks 3 and 4 depend on it. Only the check script and docs change.

**Files:**
- Create: `apps/server/test/fixtures/ssi/site-checks.ts`; modify `round-trip.ts` (mode `site probe`, header line)
- Create: `docs/research/<date of the run>-ssi-site-checks.md`; modify `docs/index.md` (research list)

**Interfaces:**
- Produces, for Task 3: the `save_divesite` answer's key names and where the new ID is; how `get_divesite` answers a
  private site of the owner, a public site and an unknown ID (key names, `is_private`/`_is_private_owner` present or not,
  status for unknown); whether a new site with no dive is in `logbook_sites`; whether `odin_dive_sites_deleted: true`
  deletes it.

- [ ] **Step 1: Add `site probe`** (needs `SSI_SITE_ID`, a public site). Through the transport (`call(what, params, body)`
  of `ssi-transport.ts`), in order:
  1. `save_divesite` with the app's site row (all keys of `siteUpload` in the write-bodies note; `internalPk` and
     `needsUpload` left out): `odin_dive_sites_id: null`, name `"Dive Hub test"`, lat `0.001`, lon `0.001`,
     `odin_countries_code_iso: null`, `bow: "salt"`, `is_private: true`, `_is_private_owner: <account mid>`,
     `_deleted: false`, the rest `null`. Print the answer's keys and every value that looks like an ID.
  2. `get_divesite` (`dsid`) for the new ID, for `SSI_SITE_ID` and for `999999999`: print HTTP status, key names, and
     the values of `odin_dive_sites_id`, `_is_private`, `_is_private_owner`, `_deleted` (no names, no comments).
  3. `get_divelog`: is the new ID in `logbook_sites`, and with which `is_private`/`_is_private_owner`.
  4. `save_divesite` with the same row, the new ID and `odin_dive_sites_deleted: true`; then `get_divesite` and
     `get_divelog` again: is it gone.
  Save the answers to `samples/private/ssi/site-probe.json`. Header comment line as the other modes.
- [ ] **Step 2: Announce and run** (`… round-trip.ts site probe`, "creates and deletes one private site 'Dive Hub test'
  at 0.001, 0.001"). If the site can't be deleted, say so to the owner before anything else runs.
- [ ] **Step 3: Write the research note** (frontmatter; what was sent by key name, what SSI answered, the result, app
  5.0.43). Mark the lines in `docs/references/ssi-app-api.md` [T] (a new section "Sites: `save_divesite`,
  `get_divesite`").
- [ ] **Step 4: Decide.** If neither the answer nor `get_divesite`/`get_divelog` yields the new ID, stop:
  `STOP: save_divesite gives no way to learn the new site's ID`. Otherwise write in the note which one Task 3 uses.
- [ ] **Step 5: Commit** (`pnpm check` is not needed for docs and the check script alone; run it, it is fast).

### Task 1: The table learns private IDs; `site-ids.ts`

**Files:**
- Modify: `apps/server/src/db/schema.ts:356-381`; create `apps/server/drizzle/0040_private_site_ids.sql` (generated)
- Create: `apps/server/src/sites/site-ids.ts`; test `apps/server/test/site-ids.test.ts`
- Modify: `docs/spec/data-model.md`, `docs/spec/architecture.md:281`

**Interfaces:**
- Produces (all in `sites/site-ids.ts`):
  - `type SiteIdRow = { source: SiteSource; externalId: string; accountId: string | null; providesData: boolean; imported: ImportedValues | null }`
  - `accountOf(q: Db | Tx, diverId: string, source: SiteSource): Promise<string | null>` — the Diver's `diver_external_id.id` at that Source.
  - `accountsOfUser(q: Db | Tx, userId: string, source?: SiteSource): Promise<string[]>` — account rows of the Divers the User manages.
  - `idsOf(q: Db | Tx, siteIds: string[], accounts: string[]): Promise<Map<string, SiteIdRow[]>>` — public rows plus private rows of `accounts`.
  - `pickId(rows: SiteIdRow[], source: SiteSource, account: string | null, remote?: string | null): string | null` — pure, the send's order (remote if it is one of them; public; private).
  - `holderOf(q: Db | Tx, source: SiteSource, externalId: string): Promise<{ siteId: string; accountId: string | null; deleted: boolean } | null>`
  - `storeId(tx: Tx, s: { siteId: string; source: SiteSource; externalId: string; accountId: string | null; actor: Actor | null; providesData?: boolean; imported?: ImportedValues }): Promise<void>` — replaces the row of the same `(site, source, account)`; another site holding the ID → `SiteError('external_id_taken')`; account of another Source → throws; a Revision only when `accountId` is null and `actor` is given.
  - `clearId(tx: Tx, siteId: string, source: SiteSource, accountId: string | null, actor: Actor | null): Promise<string | null>` — returns the removed ID.
  - `settleVisibility(tx: Tx, source: SiteSource, accountId: string, remote: { externalId: string; private: boolean }[]): Promise<void>`
  - `nearbyMatch<T extends { externalId: string; name: string; latitude: number | null; longitude: number | null }>(site: { name: string; position: Position }, remotes: T[]): T | undefined` — pure, nearest within `MATCH_WITHIN_M` with `namesMatch`.

- [ ] **Step 1: Migration test.** In `apps/server/test/migrations.test.ts`, a case `0040 keeps public IDs and allows one private ID per account`: after migrating, the existing rows have `account_id` null; inserting a second public row for a site and Source fails; a private row for the same site and Source with an account succeeds; a second one for that account fails; the same `external_id` again (public or private) fails; deleting the `diver_external_id` row deletes the private row.
- [ ] **Step 2: Run it; it fails** (no column).
- [ ] **Step 3: Schema** (asks the owner): `accountId: uuid('account_id').references(() => diverExternalId.id, { onDelete: 'cascade' })`;
  replace `dive_site_external_id_site_source_uq` with `…_public_uq` on `(site_id, source)` `where account_id is null`
  and `…_private_uq` on `(site_id, source, account_id)` `where account_id is not null`; an index on `account_id`. Keep
  `…_source_uq` and the check. Update the table comment (ADR 0057, amended). `db:generate`, read the SQL, name the file
  `0040_private_site_ids.sql`.
- [ ] **Step 4: Run the migration test; it passes.**
- [ ] **Step 5: `site-ids.test.ts`** — `pickId`: `remote` among the rows wins (public or private); else public; else private; a remote not among them is ignored; another account's row never picked. `storeId`: a private row writes no Revision, a public one does; another site holding the ID → `external_id_taken`; an account at another Source throws. `settleVisibility`: public row → private for an own private remote; private row → public for a public remote; another account's private row untouched. `nearbyMatch`: 99 m and "Blue Hole" vs "The Blue Hole" matches; 101 m doesn't; two matches → the nearer. `idsOf` returns public rows and only the given accounts' private ones.
- [ ] **Step 6: Run; it fails. Implement `site-ids.ts`; run; it passes.**
- [ ] **Step 7: Docs** (`data-model.md`, `architecture.md` External IDs line: public and private rows, who sees them).
- [ ] **Step 8: `pnpm check`, commit.**

### Task 2: Every reader goes through `site-ids.ts`

**Files:**
- Modify: `sites/site-service.ts` (:105-118 list columns, :145-160 `setExternal`, :263-270 merge, :307-319 offer, :326-342 `setExternalId`), `sites/routes.ts` (`ExternalIdView`), `sites/provider-sites.ts`, `sites/import/site-import-service.ts` (:64, :76, :100-106), `mcp/tools-sites.ts` (:88, :147), `providers/outgoing-dive.ts:16-22`, `providers/dive-changes.ts:154-155`
- Test: `apps/server/test/private-site-ids.test.ts`

**Interfaces:**
- Consumes: Task 1's functions.
- Produces:
  - Site view `externalIds[]` entries get `privateTo: { diverId: string } | null` (null = public); only rows from `idsOf(…, accountsOfUser(userId))`.
  - `ProviderSite` (`provider-sites.ts`) gets `account: string | null` (the importing Diver's account row) and
    `private: boolean` (the Provider marks it private and the account's own). `siteOutlook(q, s)` and
    `siteForProvider(tx, s, options)` keep their signatures. A match skips sites holding a public ID or the account's
    private ID at that Source (another account's private ID doesn't block); a matched or created private site is stored
    with `account` and no ID Revision.
  - `loadOutgoingDive(db, userId, diveId, options?: { deleted?: boolean; remoteSiteIds?: Partial<Record<SiteSource, string>> })`: `outgoing.siteIds[source]` = `pickId(rows, source, accountOf(diver, source), remoteSiteIds?.[source])`.
  - `hubOf(q, run, diveId, siteSource, remoteSiteId?: string | null)` uses the same `pickId`.

- [ ] **Step 1: Leak tests** in `private-site-ids.test.ts`, two Users A and B, each with a Diver connected to their own SSI account (fake), site S with public ID `100` and A's private `200`, site T with only A's private `300`:
  - `GET /api/dive-sites/{S}` for B lists only `100`; for A lists `100` (public) and `200` with `privateTo.diverId` = A's Diver.
  - The site list (`GET /api/dive-sites`) for B has no `200` and no `300`.
  - The MCP site tools for B never return `200` or `300`.
  - `loadOutgoingDive` for B's Dive at T has no SSI site ID; for A's Dive at T it is `300`; for A's Dive at S `100`, and with `remoteSiteIds: { ssi: '200' }` it is `200`.
  - B's dive import naming SSI site `300` (held privately by A at T): the known path finds T and the Dive gets T as its
    site; no row is written for B and B still sees no `300`.
  - A merge of T into S: S keeps `100` and `200` (A's private row for S wins), T's `300` stays on T; the merge's Revision names no private ID.
  - A site import (`ssi` Source) of a public site `300` (SSI published it): the row loses `account_id`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Move every reader** onto `site-ids.ts` (the list's `json_agg` becomes `idsOf` after the page query; the site import works on public rows and `holderOf`; MCP filters by `accountsOfUser`). Then `git grep -n "diveSiteExternalId\|dive_site_external_id" apps/server/src` lists only `db/schema.ts` and `sites/site-ids.ts`.
- [ ] **Step 4: Run the new file and `site-import.test.ts`, `ssi-dive-import.test.ts`, `sites.test.ts`; all pass.**
- [ ] **Step 5: Client contract** (`clients.md`, the site's `externalIds`: `privateTo`, shown only to its own Users). `pnpm check`, commit.

### Task 3: SSI's sites: privacy in the logbook, `get_divesite`, `save_divesite`

**Files:**
- Modify: `providers/provider.ts` (`RemoteSite`, `diveSites`), `providers/ssi/ssi-client.ts` (:86-95 interface, :134-143 logbook sites), `ssi-adapter.ts` (:46, :284-285), `providers/dive-changes.ts` (`sitesOf`, settle on a run's context)
- Create: `providers/ssi/ssi-site-record.ts` (the `siteUpload` row)
- Modify: `test/fake-ssi.ts` (:179-250), `test/e2e-server.ts` (:89-117)
- Test: `apps/server/test/ssi-sites-api.test.ts`

**Interfaces:**
- Consumes: Task 0's note (where the new ID is), Task 1's `settleVisibility`.
- Produces:
  - `RemoteSite` gains `visibility: 'public' | 'private' | 'unknown'` (`private` = private and the account's own) and `waterType: SiteWaterType | null`.
  - `diveSites.get?(context, id: string): Promise<RemoteSite | null>` — null: the Provider doesn't know the ID.
  - `diveSites.create?(context, site: { name: string; position: Position; country: string | null; waterType: SiteWaterType | null }): Promise<string>` — the new ID; private to the account.
  - SSI client: `site(token, id): Promise<SsiRecord | null>` (`get_divesite`, `dsid`), `saveSite(token, row): Promise<string>` (`save_divesite`, POST `json_data`); logbook sites carry `privateOwner: string | null` (`_is_private_owner` when `_is_private` is truthy).
  - `ssiSiteRow(site, accountId): Record<string, unknown>` in `ssi-site-record.ts`: every `siteUpload` key, `internalPk`/`needsUpload` left out, `odin_dive_sites_is_private: true`, `_is_private_owner: Number(accountId)`, `_deleted: false`, `bow` from the water type (salt/fresh, else null), the rest null.
  - The fake: `sites` entries take `odin_dive_sites_is_private`, `_is_private_owner`; `get_divesite` answers a known site's row or what Task 0 found for an unknown ID; `save_divesite` adds a site to `fake.sites` and answers as Task 0 recorded; `fake.calls` records both.

- [ ] **Step 1: Tests** in `ssi-sites-api.test.ts` against the fake: `find` drops a site private to another account and marks the own one `private`; `get` answers `public`/`private`/null; `create` sends `is_private: true` with the account's mid and the position, and returns the new ID; the row has every `siteUpload` key (compare with a list in the test, as the dive row's key test does); a dive import whose logbook marks a site private and own stores it private (no Revision for the ID); a public logbook site whose row here is private clears `account_id` (Review Focus 5).
- [ ] **Step 2: Run; they fail. Implement; run; they pass.**
- [ ] **Step 3: `docs/references/ssi-app-api.md`** "When Dive Hub calls SSI" table: `save_divesite` in a send, `get_divesite` when picking or typing. `pnpm check`, commit.

### Task 4: The send finds or creates the site

**Files:**
- Modify: `providers/provider.ts:41` (`Requirement`), `providers/requirements.ts`, `providers/ssi/ssi-adapter.ts:30` (`createdBySend: true`), `providers/push-service.ts` (`prepared` :223, `requirementsMet` :231, `send` :463-500, `updateThere` :314-345)
- Create: `providers/site-for-send.ts`
- Test: `apps/server/test/site-for-send.test.ts`; extend `apps/server/test/requirements.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `Requirement` `site_external_id` gets `createdBySend?: boolean`.
  - `unmetRequirements(requirements, site: { id: string; positioned: boolean } | null, dive)`; the `site_external_id` Unmet gets `bySend: boolean` (true when `createdBySend` and the site is positioned). `requirementsMet(adapter, p, options?: { beforeSite?: boolean })` ignores `bySend` ones only with `beforeSite`.
  - `siteForSend(db: Db, s: { adapter: ProviderAdapter; context: ActionContext; diverId: string; siteId: string | null; source: SiteSource; actor: Actor }): Promise<'had' | 'matched' | 'created' | 'none'>` — `none`: no site, no position, or no account; leaves the requirement to refuse. The `find` it reads also runs
    `settleVisibility` for the account, so the owner's private IDs already on shared sites become private on the first
    send as on the first import.
  - `send` calls it inside `withAccess` before choosing update or create, then reloads the Dive; `updateThere` passes the remote dive's site ID as `remoteSiteIds` to `loadOutgoingDive` and `hubOf`.

- [ ] **Step 1: Requirements tests:** a site with a position and `createdBySend` → `bySend: true`, and `requirementsMet` with `beforeSite` passes; without a position → `bySend: false`, blocks; no site → blocks as today.
- [ ] **Step 2: Send tests** in `site-for-send.test.ts` (fake SSI, a Dive at a site with a position and no SSI ID):
  - the logbook has "Blue Hole" 60 m away, public → the Dive is sent with its ID, stored public, no `save_divesite` call;
  - the logbook has it private and own → stored private for the Diver's account;
  - nothing nearby → one `save_divesite` (private, the site's name and position), stored private, the dive sent with the new ID;
  - a logbook site nearby whose ID another site here holds → skipped, a site is created;
  - a send that SSI signs out of after creating the site, retried by `withAccess` → one `save_divesite` (Review Focus 2);
  - a Push run of two Dives at one new site → one `save_divesite`;
  - the dive save fails after the site was created → the ID stays stored, the next send creates nothing;
  - a User managing two Divers with their own accounts, site with Diver X's private ID → Diver Y's send creates Y's own, X's is never sent (Review Focus 3);
  - an update whose dive at SSI points at the site's private ID while a public one exists → sent with the private ID, no Conflict on `site`.
- [ ] **Step 3: Run; they fail. Implement `site-for-send.ts` and the push-service changes; run; they pass.** Then run `ssi-target.test.ts` and `push-runs.test.ts`; they pass.
- [ ] **Step 4: Client contract** (`clients.md` :480-489): `bySend: true` doesn't block; say "Sending finds this site in your <Provider> logbook or creates it there as a private site"; the picker stays. `pnpm check`, commit.

### Task 5: Picking or typing an ID through the Connection

**Files:**
- Modify: `providers/routes.ts` (new route next to :772-786), `providers/push-service.ts` (or a small `providers/site-pick.ts` if push-service grows), `http/problems.ts`
- Test: `apps/server/test/site-pick.test.ts`

**Interfaces:**
- Consumes: `diveSites.get`, `find`, Task 1's `storeId`/`clearId`/`accountOf`.
- Produces: `PUT /api/connections/{id}/dive-sites/{siteId}` body `{ externalId: string | null }` → `200 { externalId: string | null; private: boolean }`.
  Set: `get` → null → `422 provider_site_unknown` ("<Provider> has no site with this ID"); `public` → stored public
  (with a Revision, as the old route); `private` → stored private to the Connection's Diver's account; `unknown`, or
  the Provider unavailable → the logbook's `find` decides when it lists the ID, else private. Clear (`null`): removes the
  account's private row for that site and Source, else nothing (the public ID is cleared with the old route). The
  Connection must be the User's (`connection_not_found`).

- [ ] **Step 1: Tests:** each branch above, with the fake's `get_divesite`; an unknown ID stores nothing (Review Focus 4); SSI answering 503 → stored private, never public; another User's Connection → `connection_not_found`.
- [ ] **Step 2: Run; they fail. Implement; run; they pass.**
- [ ] **Step 3: Client contract:** the route, `provider_site_unknown`, and "with a Connection for the Source, pick and type through it; the old route stores a public ID without asking". `pnpm check`, commit.

### Task 6: Web: the Dive's page and the site page

**Files:**
- Modify: `apps/web/src/ProviderPanel.tsx` (`Requirements` :293, `SitePicker` :423-487), `apps/web/src/SiteForm.tsx` (:36-39, :57, :126, :205-208), `apps/web/src/lib/providers.ts`, `apps/web/src/i18n/locales/en.json`, `de.json`
- Test: `apps/web/e2e/provider-sites.spec.ts` (new, `@dives`), `apps/web/e2e/site-form.spec.ts` (or the existing site page spec, `@sites`), `e2e/ui-quality.spec.ts`

**Interfaces:**
- Consumes: `Unmet.bySend`, the Connection route, `externalIds[].privateTo`.

- [ ] **Step 1: Browser tests:**
  - `@dives` a Dive at a site with a position and no SSI ID: the panel says "Sending finds this site in your SSI logbook or creates it there as a private site", "Send to SSI" is enabled, sending works (the fake creates the site), and the site page then shows "Your private SSI site: <ID>".
  - `@dives` picking a site in the picker stores it through the Connection route.
  - `@sites` typing an unknown ID on the site page shows "SSI has no site with this ID"; clearing the private ID removes it; another User doesn't see it.
  - A `ui-quality` case for the panel's new state.
- [ ] **Step 2: Run; they fail. Implement** (en and de words; the private field only when the User has a Connection for that Source; the public typed field as today). **Run; they pass.**
- [ ] **Step 3: Review the screenshots** of the new states (`REVIEW_AREAS=dives,sites`). `pnpm check`, commit.

### Task 7: Docs

**Files:** `docs/spec/architecture.md` (the push requirements :558, the site step in a send), `docs/glossary.md`
(**Private site ID**: a Dive site's ID at a Source that belongs to one Diver's account there), `docs/references/ssi-app-api.md`
(the private flag is read now; line 374 "The private flag isn't read" changes), the design doc's piece 4 line ("done"
after Task 8).

- [ ] **Step 1: Write them; `pnpm check`; commit.**

### Task 8: The check on the owner's account: usable and not visible

**Files:**
- Modify: `site-checks.ts`, `round-trip.ts` (modes `site visible start | global | zip | finish`, header lines)
- Create: `docs/research/<date>-ssi-private-site-check.md`; modify `docs/references/ssi-app-api.md` ([T]), `docs/index.md`

- [ ] **Step 1: The modes.** `start`: through Dive Hub's own code (`ssiSiteRow` + `saveSite`, then a dive created with
  `createRecord` dated 2000-01-01 12:00, notes "Dive Hub test", at the new site) keeps both IDs and the time in
  `samples/private/ssi/site-visible.json`. `global`: `get_divesites_global` with `last_sync` just before `start`'s time
  (the format from the app's code; print what it accepts), paged until the end; prints whether the new ID is there, and
  `get_divelog`'s entry for it (`is_private`, owner = the account). `zip`: downloads `APP_CACHE_SITES.zip` (no sign-in)
  and prints whether the ID is in it and the file's `created`. `finish`: deletes the dive (only a "Dive Hub test" dive)
  and the site, and checks both are gone.
- [ ] **Step 2: Announce and run `start`; the owner looks at the dive in SSI's app** (the site shows on it); run
  `global`; the next day `zip`; then `finish`.
- [ ] **Step 3: Research note; [T] in the reference; the design doc marks piece 4 checked. Commit.**

---

## Finish

`pnpm check:full` green, the `architecture-review` subagent's findings settled, then push the branch and open a PR
(skills override 5). The summary lists the known consequence above and any parked findings.
