---
title: "Plan: Garmin as an import-only Provider (ADR 0062)"
summary: Eight tasks - the Garmin client and a fake Garmin, the adapter and its wiring, dives as files in the generic Provider import (FIT Originals placed like uploads, never replacing a Recording), the kinds of dive to fetch per Connection (SSI too), the optional key expiry, the web (Garmin's key field and link, the expiry, the kinds), and the docs; tests first, pnpm check green, then the PR.
status: ready
date: 2026-10-31
---

# Garmin as an import-only Provider: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A User connects Garmin with their own personal API key and Dive Hub fetches their dives (by hand or on the
scheduled fetch) as full Recordings from Garmin's original FIT files, one Recording per dive whatever was uploaded
before; every Connection chooses the kinds of dive to fetch.

**Architecture:** A new adapter folder `apps/server/src/providers/garmin/` (client + adapter) on the existing
Provider layer. The generic import (`providers/dive-import/dive-import.ts`) learns dives that come as files: it stores
the file as the Original and places it through `imports/placement.ts` as an upload would. Two new Connection columns
(kinds, key expiry), one migration. The web reads everything Garmin-specific from the capabilities, never by name.

**Tech Stack:** TypeScript, Fastify + TypeBox, Drizzle on PostgreSQL, Graphile Worker, Vitest against a real
PostgreSQL, React + React Aria, Playwright.

**Spec:** [the design](../specs/2026-10-31-garmin-provider-design.md) and
[ADR 0062](../../decisions/0062-garmin-import-only-provider.md). API facts:
[reference](../../references/garmin-connect-personal-api.md).

## Global Constraints

- [ADR 0053](../../decisions/0053-module-boundaries.md): `providers/garmin/` imports only from `providers/` and
  `imports/` (the FIT adapter, placement); nothing outside `providers/` imports `providers/garmin/` except the
  composition (`src/start.ts`) and tests. `pnpm check` runs the dependency rules.
- ADRs touched: 0027, 0030, 0056 (no sending automation for an import-only Provider), 0062. Load
  `karpathy-guidelines` before Task 1: every changed line traces to a task.
- Garmin host: `https://personal.connectapi.garmin.com` (config `garminUrl`, env `DIVEHUB_GARMIN_URL`, default that
  host). Token: `POST /personalapitoken-service/personal-api/personal-api-key/token`, header
  `Authorization: ApiKey <key>`, **`Accept: */*`**, answer: the JWT as plain text. Data: `Authorization: Bearer <jwt>`.
- Listing: `GET /activitylist-service/activities/search/activities?activityType=diving&start=<n>&limit=100`, pages
  until one is shorter than 100. Download: `GET /download-service/files/activity/{activityId}`, `Accept: */*`, a zip
  with one `.fit`.
- Key page link: `https://connect.garmin.com/app/settings/personalApiToken`. Expiry notice from **7 days** before
  the date. Pause between downloads: **1000 ms**. Token reused until **60 s** before its `exp`.
- The key and the token never appear in a log, an error message, a Revision, a fixture or the repository. Tests use
  `apps/server/test/fixtures/synthetic-dive.fit` and the e2e fixtures, never real Garmin data.
- Tests against a real PostgreSQL, at most one `vi.fn`, no `vi.mock`; browser tests carry an area tag; commands
  `pnpm check` and those in [development.md](../../development.md). Migrations are generated with drizzle-kit, never
  hand-edited after generation except to add a data step; never edit an existing migration.
- A new duty for clients goes into [clients.md](../../spec/clients.md). Texts in en and de.

## Review Focus

1. A Garmin dive uploaded as a file *after* it was fetched: one Recording, the upload replaces as uploads do (Task 3).
2. A Garmin activity entered by hand (`isManualActivity: true`) or a download that is no FIT: skipped with a reason,
   the rest of the fetch goes on (Task 3).
3. A key expired or deleted at Garmin during a scheduled fetch: the Connection becomes `needs_sign_in`, no retry loop,
   no key in the log (Task 2).
4. Turning `apnea` on after a fetch without it: the next fetch takes in the older apnea dives (Task 4).
5. Garmin answering 429 or 5xx on a download: that dive fails as `unavailable`, the dives before it stay, the next
   fetch tries it again (Task 3).

---

### Task 1: The Garmin client and a fake Garmin

**Files:**
- Create: `apps/server/src/providers/garmin/garmin-client.ts`
- Create: `apps/server/test/fake-garmin.ts`
- Test: `apps/server/test/garmin-client.test.ts`

**Interfaces:**
- Produces:
  - `createGarminClient(opts: { url: string; now?: () => number; fetch?: typeof fetch }): GarminClient`
  - `interface GarminClient { token(key: string): Promise<GarminToken>; dives(token: string): Promise<GarminActivity[]>; file(token: string, activityId: string): Promise<Uint8Array> }`
    (`file` answers the unzipped FIT bytes; `dives` reads every page)
  - `interface GarminToken { jwt: string; expiresAt: number; accountId: string }` (`accountId` = the JWT's
    `garmin_guid` claim; the JWT's signature is not checked)
  - `interface GarminActivity { activityId: number; startTimeLocal: string; startTimeGMT: string; typeKey: string; duration: number | null; maxDepth: number | null; manual: boolean; ownerDisplayName: string | null }` (`maxDepth` in m as Garmin sends it; check the unit against the fake's documented sample and the reference)
  - `class GarminError extends Error { reason: 'wrong_credentials' | 'unavailable' | 'bad_response' }`: 401/403 on
    the token call → `wrong_credentials`; 429, 5xx, network → `unavailable`; anything unreadable → `bad_response`.
    The message never quotes the key or the token.
  - `createFakeGarmin(): { url: string; addAccount(a: { key: string; guid: string; displayName: string; dives: FakeGarminDive[] }): void; revoke(key: string): void; calls: string[]; close(): Promise<void> }`,
    `FakeGarminDive = { activityId: number; typeKey: string; startTimeLocal: string; manual?: boolean; fit: Uint8Array }`;
    it answers 406 to `Accept: application/json` on the token and download calls (as Garmin does), serves the zip via
    `zipOf` from `test/zip.ts`, and records each call's method and path (never headers) in `calls`.

- [ ] **Step 1: Write the failing tests** in `garmin-client.test.ts`, against `createFakeGarmin()`:
  - `trades a key for a token whose account is the garmin_guid` → `accountId === guid`, `expiresAt` = the JWT's `exp` × 1000.
  - `sends Accept */* on the token and the download` (the fake 406s otherwise; passing proves it).
  - `reads every page of the dive listing` with 230 fake dives → 230 activities, `calls` has 3 listing calls with `start=0`, `100`, `200`.
  - `answers the FIT inside the downloaded zip` → bytes equal `synthetic-dive.fit`.
  - `a revoked key is wrong_credentials` → `GarminError` with `reason: 'wrong_credentials'` and a message without the key.
  - `429 on a download is unavailable`.
- [ ] **Step 2:** `pnpm --filter @dive-hub/server exec vitest run test/garmin-client.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `garmin-client.ts`. Unzip with `imports/archive.ts` (write the download to a temp file
  for `eachFile`, or add a buffer variant there if `eachFile` can't take one; the limits stay as they are); the first
  `.fit` entry is the file, none is `bad_response`.
- [ ] **Step 4:** the same command → PASS.
- [ ] **Step 5: Commit** `Server: a Garmin Personal API client (token, dive listing, original file) and a fake Garmin for tests`.

### Task 2: The Garmin adapter, its wiring, and import-only Providers

**Files:**
- Create: `apps/server/src/providers/garmin/garmin-adapter.ts`
- Modify: `apps/server/src/providers/provider.ts` (`SignIn` token fields; `dives.file`; export-only members optional), `apps/server/src/providers/registry.ts` (`unbacked`), `apps/server/src/config.ts` (`garminUrl`), `apps/server/src/start.ts` (adapter list), `apps/server/test/e2e-server.ts` (fake Garmin + one account), `.env.example`
- Test: `apps/server/test/garmin-adapter.test.ts`, `apps/server/test/provider-registry.test.ts` (or the registry test that exists)

**Interfaces:**
- Consumes: Task 1's `GarminClient`.
- Produces:
  - `SignIn` token variant becomes `{ kind: 'token'; createUrl?: string; expires?: boolean }` (`expires`: the User
    may give the key's expiry date). SSI unchanged.
  - `ProviderAdapter.dives`: `mode`, `fingerprint`, `open` become optional, required (by the registry check) only when
    `capabilities.data.dives.export` is declared; new optional
    `file?(context: ActionContext, remoteId: string): Promise<{ bytes: Uint8Array; mediaType: string; fileName: string }>`.
  - `createGarminAdapter(deps: { client: GarminClient; pauseMs?: number; sleep?: (ms: number) => Promise<void> }): ProviderAdapter`
    with `id: 'garmin'`, `capabilities: { name: 'Garmin', signIn: { kind: 'token', createUrl: 'https://connect.garmin.com/app/settings/personalApiToken', expires: true }, data: { dives: { import: { operations: ['list'] }, fields: {} } }, notices: [], limits: … }`
    (limits: the pause as the generic pause between actions; `run: null`).
  - `signIn({ kind: 'token', token })` → account `{ id: guid, label: displayName ?? 'Garmin' }`, credentials' `access`
    = the key. Every action trades the key for a token, kept in memory per key until 60 s before `exp`.
  - `list(context)` → a `DiveListing` whose records are the activities (as JSON); `parse(record)` → `ImportedDive`
    with `remoteId = String(activityId)`, `evidence: 'computer'`, `device: null`, `diveMode` from `typeKey` through
    the FIT vocabulary's mapping (`apnea_*` → `apnea`), `localStart = startTimeLocal`, depth and duration from the
    listing; `null` for `manual` activities is **not** wanted: return the dive and let Task 3 skip it with a reason.
  - `file(context, remoteId)` → `{ bytes, mediaType: 'application/vnd.ant.fit', fileName: '<activityId>.fit' }`, after
    the pause when another download of this adapter ran less than `pauseMs` ago.
  - `GarminError` reasons map to the adapter error reasons of ADR 0027 (`wrong_credentials` on sign-in, `signed_out`
    on an action's token call, `unavailable`, `bad_response`).

- [ ] **Step 1: Write the failing tests:**
  - `garmin-adapter.test.ts`: `signs in with a key and names the account`; `a second key of another account is provider_other_account` (through the connection service, as the SSI tests do); `lists the dives as computer dives with their mode` (an `apnea_diving` fake dive → `diveMode: 'apnea'`); `a revoked key on an action is signed_out and the Connection needs sign-in`; `downloads wait the pause between two files` (injected `sleep`, the one `vi.fn`).
  - Registry test: `an adapter with dives import only and no open is accepted`; `one declaring export without open is refused`.
  - `GET /api/providers` lists Garmin with `signIn.createUrl` and `signIn.expires: true`.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement** the adapter, the optional members, the registry check, `garminUrl` and the start/e2e wiring.
  Regenerate the API client as development.md says (the capabilities schema changed).
- [ ] **Step 4:** run them → PASS; `pnpm check` green so far.
- [ ] **Step 5: Commit** `Server: a Garmin Provider, import only, signed in with the User's own key (ADR 0062)`.

### Task 3: Dives that come as files in the Provider import

**Files:**
- Modify: `apps/server/src/providers/dive-import/dive-import.ts` (`assess`, `previewDives`, `start`, `process`, `processDive`), `apps/server/src/imports/placement.ts` (`Placement.keepKnown`)
- Modify: `apps/server/src/db/schema.ts` only if a new outcome reason needs a type (`ImportOutcome` reasons)
- Test: `apps/server/test/garmin-dive-import.test.ts`

**Interfaces:**
- Consumes: Task 2's `dives.file`, `createFileFormats()` / `formatOf` (`imports/formats.ts`), `placeRecording`.
- Produces:
  - `Placement.keepKnown?: boolean`: when the Recording key is known already, the outcome is
    `{ result: 'skipped', reason: 'already_here', diveId }` (or the existing reason that means this, if one does) and
    nothing is written to the Recording. Uploads don't set it.
  - For an adapter with `dives.file`: `assess` answers `linked` for a remote ID linked to a Dive of this Connection,
    else `recording` (no per-computer choice, never `unchosen`); the preview's computers list is empty.
  - `start` downloads, one after another, the files of the dives assessed `recording` (not manual, of a chosen kind:
    Task 4) and stores each as an Original (`mediaType`, `fileName` from `file`); a failed download ends that dive as
    `failed` / `unavailable` and goes on.
  - `process` reads such an Original through the file formats (not `JSON.parse`), places each Recording with
    `{ keepKnown: true, diverId: <the Connection's Diver> }` and then links the Dive to the remote dive (`link`), so a
    later fetch assesses it `linked` and doesn't download it.
  - A manual activity ends `{ result: 'skipped', reason: 'entered_by_hand' }` in preview and outcome.

- [ ] **Step 1: Write the failing tests** in `garmin-dive-import.test.ts` (fake Garmin from `e2e-server`-style setup
  or `createTestApp` with the adapter), each asserting Recording count, Dive count and the outcome:
  - `a fetch makes one Recording per dive from its FIT and keeps the FIT as the Original` (Original `media_type` is the FIT's, file name `<id>.fit`).
  - `fetching twice downloads nothing the second time` (fake `calls` has no second download; outcome `skipped`/linked).
  - `a dive uploaded as a file before is not replaced by the fetch` (upload `synthetic-dive.fit`, then fetch the same file as a Garmin dive → 1 Recording, its Original still the upload's, the Dive linked to the activity).
  - `a dive fetched before and uploaded later is one Recording` (fetch, then upload the same file → 1 Recording).
  - `a manual activity is skipped as entered by hand`.
  - `a download answering 429 fails that dive only; the next fetch takes it`.
  - SSI's existing dive-import tests stay green unchanged.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Keep SSI's path byte-for-byte where `dives.file` is absent.
- [ ] **Step 4:** run them and `test/ssi-dive-import.test.ts` → PASS.
- [ ] **Step 5: Commit** `Server: a Provider's dives may come as files - stored as Originals, placed like uploads, never replacing a Recording (ADR 0062)`.

### Task 4: The kinds of dive to fetch, per Connection

**Files:**
- Modify: `apps/server/src/db/schema.ts` (`connection.fetchKinds`), new migration in `apps/server/drizzle/` (generated)
- Modify: `apps/server/src/providers/connection-routes.ts` (PATCH body and view), `connection-view.ts`, `dive-import.ts` (skip by kind in preview, start and process)
- Test: `apps/server/test/fetch-kinds.test.ts`

**Interfaces:**
- Produces: `connection.fetchKinds: DiveKind[]`, column `fetch_kinds text[] not null default '{scuba,apnea}'` with a
  check that every element is in `DIVE_KINDS` and the array isn't empty; PATCH `/api/connections/:id` takes
  `fetchKinds` (1–2 distinct of `DIVE_KINDS`, 400 otherwise); the Connection view has `fetchKinds`. A dive's kind is
  `apnea` when its `diveMode` is `apnea`, else `scuba` (the rule of `kindOf` in `imports/import-service.ts`: reuse
  it, don't copy it). Not chosen → `{ result: 'skipped', reason: 'kind_not_chosen' }`; for a file adapter it is never
  downloaded.

- [ ] **Step 1: Write the failing tests:** `a new Connection fetches both kinds`; `PATCH sets the kinds and refuses an empty or unknown one`; `SSI: an apnea dive is skipped when only scuba is chosen` (fake SSI dive type 6); `Garmin: an apnea dive isn't downloaded when only scuba is chosen`; `turning apnea on, the next fetch takes in the older apnea dive`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement**; generate the migration (`pnpm --filter @dive-hub/server exec drizzle-kit generate`), read its SQL, add the check if drizzle-kit didn't. `drizzle-kit generate` afterwards reports no changes. Regenerate the API client.
- [ ] **Step 4:** run → PASS, plus `test/migrations.test.ts`.
- [ ] **Step 5: Commit** `Server: every Connection chooses the kinds of dive it fetches, scuba and apnea by default (ADR 0062)`.

### Task 5: The key's expiry date

**Files:**
- Modify: `apps/server/src/db/schema.ts` (`connection.keyExpiresOn`), new migration (generated), `connection-routes.ts` (sign-in bodies), `connection-service.ts`, `connection-view.ts`
- Test: `apps/server/test/key-expiry.test.ts`

**Interfaces:**
- Produces: column `key_expires_on date` (nullable); the token sign-in body (connect and sign in again) takes an
  optional `keyExpiresOn: 'YYYY-MM-DD'`, accepted only when the Provider's `signIn.expires` is true (400 otherwise),
  refused when in the past; signing in again without it clears it. The Connection view has `keyExpiresOn: string | null`
  and `keyExpiresSoon: boolean` (today, in the server's clock, is on or after the date minus 7 days).

- [ ] **Step 1: Write the failing tests:** `the expiry date is kept and shown`; `keyExpiresSoon from seven days before` (resettable clock); `a date for SSI is refused`; `a date in the past is refused`; `signing in again with a new key replaces the date`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement**; generate the migration; regenerate the API client.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `Server: a Connection keeps the key's expiry date when the Provider's sign-in has one, and says a week ahead (ADR 0062)`.

### Task 6: The web - Garmin's key, its expiry, the kinds

**Files:**
- Modify: `apps/web/src/Connections.tsx`, `apps/web/src/i18n/locales/en.json`, `de.json`, the Connection settings component the import settings live in (find it from `importMode` in `apps/web/src`)
- Test: `apps/web/e2e/garmin.spec.ts` (area tag of the Connections page, see `scripts/check-lib.mjs` AREAS), a component test in `apps/web/test/` if the form logic has a branch worth one

**Interfaces:**
- Consumes: capabilities `signIn.createUrl`, `signIn.expires`; Connection view `fetchKinds`, `keyExpiresOn`, `keyExpiresSoon`.
- Produces: with `createUrl`, the token field's description links "Create a key at Garmin Connect" (text from i18n,
  the Provider's `name` interpolated) to it, opening a new tab; with `expires`, an optional date field "Key expires
  on"; on the Connection, from `keyExpiresSoon`, the notice "The key expires on <date>" with the same link; in the
  Connection's import settings, two checkboxes "Scuba dives" / "Apnea sessions" (at least one stays checked). A
  Provider without `dives.export` shows no send, no read-back and no sending automation (check what the web shows
  for it today and hide by capability where it doesn't already).

- [ ] **Step 1: Write the failing browser test** `garmin.spec.ts`: connect Garmin with the e2e fake Garmin's key and an expiry date 5 days ahead → the notice shows; open import, fetch → the fake's dives arrive; uncheck "Apnea sessions" → saved; the Garmin Connection offers no sending.
- [ ] **Step 2:** `pnpm --filter @dive-hub/web test:e2e garmin` → FAIL.
- [ ] **Step 3: Implement**; en and de texts; add the new page state to `e2e/ui-quality.spec.ts` if the notice is a new state.
- [ ] **Step 4:** the same → PASS; review capture of the Connections area (`REVIEW_AREAS`), look at the screenshots.
- [ ] **Step 5: Commit** `Web: connecting Garmin with a key (link to Garmin's key page, optional expiry and its notice), and the kinds of dive to fetch`.

### Task 7: Docs

**Files:**
- Modify: `docs/spec/clients.md` (the key link and expiry duties, the kinds setting, the two new skip reasons), `docs/spec/data-model.md` (dives as files from a Provider; the two columns), `docs/glossary.md` (only if a new term was needed), `docs/references/garmin-connect-personal-api.md` (Notes: "used by `providers/garmin/`")

- [ ] **Step 1:** write them; link ADR 0062.
- [ ] **Step 2: Commit** `Docs: Garmin as a Provider in the client contract and the data model`.

### Task 8: Finish

- [ ] **Step 1:** `pnpm check` → green.
- [ ] **Step 2:** the `architecture-review` subagent; fix what it finds with `path:line` and a rule; `pnpm check` again.
- [ ] **Step 3:** if PR #14 (`desloppify-cleanup`) is still open and its CI check passed, merge it on GitHub
  (`gh pr merge 14`, never locally; owner, 2026-10-31); if its CI failed or is still running, leave it and say so.
- [ ] **Step 4:** once PR #14 is merged, rebase `garmin-provider` onto `main` and run `pnpm check` again; then push
  `garmin-provider` and open its PR against `main`. With PR #14 still open, push and open the PR against
  `desloppify-cleanup` instead, and say so in the PR text.
