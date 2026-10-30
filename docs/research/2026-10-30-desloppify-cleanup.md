---
title: The desloppify cleanup branch, what it decided and what waits for the owner
summary: Outcome of the desloppify cleanup on branch desloppify-cleanup (2026-10-29/30, first queue cycle) - the conventions it settled (one line each, with the commit), the behaviour changes, the owner's decisions of 2026-10-30 and what they led to (component tests, one QR library, ADR 0061's attempt limit, migrations 0044-0050), what is still open, and the scores after the rescan (strict 74.9, objective 82.2). Read before changing code the branch touched, and before a second desloppify cycle.
status: current
date: 2026-10-30
---

# The desloppify cleanup branch (2026-10-30)

The branch `desloppify-cleanup` worked through desloppify's whole first queue (about 75 items from its
subjective review; the starting point is [the code quality baseline](2026-10-29-code-quality-baseline.md)).
Items ran as agents, up to three at once, in batches of at most 10 items or 1,000 changed lines; each batch
was committed only after one green `pnpm check`. About a third of the items were already fixed by earlier
commits when they came up and were resolved without a code change.

## Scores after the rescan

| Score | Before (2026-10-29) | After |
|---|---|---|
| Strict | 75.5 (after the first subjective review) | 74.9 |
| Overall | - | 75.7 |
| Objective (mechanical) | 81.2 | 82.2 |

The 14 subjective dimensions are marked stale: they are still the scores of the first review, taken before
the cleanup. A second cycle starts with a fresh blind review; the rescan also lists 632 open mechanical
findings, most of them in Test health (20.8%).

Measured on the branch against `main`: ESLint suppressions went down (cognitive complexity 47 → 34, unused
vars 16 → 11, three rules gone), the dependency-cruiser known violations stayed empty, and
`packages/api-client/openapi.json` shrank from 132k to 51k lines once shared schemas became `$ref`s.

## Conventions the branch settled

Each line is a rule later code follows; the commit that introduced it is in brackets where one did.

### Server: modules and composition

- `createServices` (`src/compose.ts`) builds every service; `buildApp` only registers the routes with them
  (4d2545e). Boot is `start(config)` in `src/start.ts`; the logger is the Fastify instance's, made before
  the services.
- A service another service uses is passed in from the composition root, never built inside
  (`createMergingService(db, checks, providerLinks)`).
- A domain module never imports a root assembly file (`app`, `compose`, `start`, `main`, `worker`,
  `site-sources`): rule `modules-import-no-assembly` (bf42cdb).
- `dives/` imports only types from `providers/`; a Provider rule or answer a `dives/` service or route needs
  is passed in (`ProviderLinks`, `providerAnswers`) (85e528e). `centres/` and `sites/` don't import
  `providers/`; `src/site-sources.ts` wires a Provider's sites with OSM and Wikidata (6fbddec).
- There is no root `routes.ts`; each domain registers its own route plugins (feba233). Route files export
  only their plugin and deps; shared schemas go in `<thing>-view.ts` or `route-parts.ts`, refusal answers in
  `<domain>-answers.ts`.
- A route plugin gets only its declared deps.
- In a domain folder, a `<thing>-service.ts` reads the database for a route or tool, a plain-named file is a
  computation or shared part, and a domain's error goes in `<domain>-error.ts` (efb6ca0). A closure factory
  over the database is `createXService` in `x-service.ts`, its type `XService`; a pure builder is `build*`
  (3cf8f4e).
- A domain folder groups three or more files of one concern in a sub-folder (`dives/checks/`,
  `dives/candidates/`, `dives/calc/`) (e12018d). `providers/` keeps the Provider core at its root, one
  sub-folder per exchange (`push/`, `waiting-push/`, `dive-import/`, `conflicts/`, `buddies/`) beside the
  adapter folders (b3ce2e2). A file format adapter lives in `imports/formats/<format>/` (69f758a).
- `mcp/tools-*.ts` import no drizzle-orm or `db/client`; their queries go in `mcp/read-service.ts`. Every
  MCP tool is named in `INSTRUCTIONS` (enforced by `mcp-endpoint.test.ts`).

### Server: errors and HTTP

- A service signals failure by throwing a typed error (`XError` with a code union); its route plugin
  answers it with `app.setErrorHandler(answerErrors(answers(XError, STATUS)))` from `http/problems.ts`,
  `STATUS` exhaustive.
- One `Problem` schema carries every shared refusal extra; a module adds only extras of its own types
  (`ProviderProblem`, `DeleteProblem`).
- A schema used by more than one route has an `$id`, is registered once with `app.addSchema` and is referred
  to with `Type.Ref`; a test fails when a sizable schema is inlined in more than two places of the OpenAPI
  document (6212dda, 1f1ddf7).
- A caught error's text is `errorMessage(error)` (`src/errors.ts`); a rewrapping error passes `{ cause }`
  unless the original can quote a secret. An unreadable dive file throws `ParseError` with `{ cause }`.
- A lookup that may find nothing answers `null`, never `undefined`; one whose thing must exist throws.
- GET handlers never write; cleanup of stored state goes in the worker's tick.
- A tool with structured input is POST with a JSON body (ADR 0059); a paged list is
  `{ <resource>, total }`, every other list a bare array (ADR 0060).
- A nullable schema is `Nullable(t, options?)`. A stored text value becomes an enum through `oneOf`
  (`http/schemas.ts`), a stored problem code through `storedProblemCode`; a value set the database keeps as
  a pgEnum is read through `<enum>.enumValues`, never re-typed as literals.
- A Revision's changes are typed per field (`Changes`/`Change`/`Made` in `http/schemas.ts`); history routes
  send them as stored (8059c77).

### Server: auth and users

- The signed-in User comes from `userOf(request)`, the session id from `sessionIdOf(request)`;
  `request.user` is read directly only where it may be null.
- The admin rule is `isAdmin(user)`; `requireAdmin` is the one admin gate, and services don't re-check admin.
  Every admin route on Users is in `users/admin-routes.ts`, and an admin action is logged through `audit()`
  after it succeeds.
- Every route is session-guarded or on the `PUBLIC` list in `test/route-guards.test.ts`.
- Services over shared things take the signed-in `Caller` first.

### Server: Dives, Divers and Providers

- A Diver-management check goes through `divers/management.ts`; a helper that loads a thing and refuses one
  the User doesn't manage is `requireManaged<Thing>`.
- A Dive's local day is `localDay(d)`; a Provider dive's local start is `localStartOf(d)`.
- A Dive's values follow a new Primary recording through `followPrimary`; a User's Revision takes
  `userActor(userId)`; a write to a Dive row bumps it with `...nextVersion()`.
- A check on a Diver row that a later write in the same transaction relies on locks the row (`for update` to
  change it, `for share` to point at it), several rows in id order (1f4e1d1).
- A Dive's Participants are read through `participantsOfDives` / `participantsOf`.
- A route plugin whose requests can change a Dive registers `refreshAssessmentsAfterChange`.
- An assessment rule reports its worst part, never the first; every threshold is a named `LIMITS` entry.
- The context of one exchange with a Provider is `ProviderContext` (`pc`, from `contextOf`); "run" names
  only a Push run. Taking over is choosing the Provider's value (`take*`), filling is taking it only where
  the Dive has none (`fill*`), adopting is an Offer's. "Settle" names only site-ID visibility; a Waiting push
  entry is cleared through `clearIfUnchanged`.
- A Provider call's failure in `push-service.ts` is recorded through `recordFailed` / `recordGone`; an
  adapter's `Delivered.remoteNumber` comes from the read-back.
- A worker task constant is named after its value (`<VALUE>_TASK`); a task string, once shipped, never
  changes (queued jobs carry it).
- `q` names only a `Queryable` handle.

### Web

- A file `App.tsx` routes to is `<Thing>Page.tsx`; a page never imports another page.
- `api.ts` queries fetch inline (a helper only when two share it), mutations call `api` inline with
  `unwrap`; a query filter shared by several invalidations is a named filter next to `keys`.
- A request with no answer is a `NetworkError`, shown as `errors.network`.
- A Provider looked up by id is `useProviderOf()(id)`, a `ProviderRef`; a translation key built at run time
  is narrowed to its key union, never by casting `t`.
- Focus returns through `useFocusBackWhenClosed`; a missing thing shows `NotFoundPage`; a saved form
  releases its guard through `useLeaveGuard`'s release; per-User stores reset in `useUserChanged`.

### Tests and checks

- A test double lives in `apps/server/test/`, never in `src/`. A test that checks how long the app waited
  uses `resettableClock({ stopped: true })`; one that waits for another process polls with `vi.waitFor`.
- CI sets `REQUIRE_DATABASE=1`, so database tests fail there instead of skipping.
- A server test that writes Revisions without `createTestApp` calls `listenToNoChanges()`.
- A browser spec runs serial only when it tells one story in order; otherwise each test seeds what it needs.
- The lint baseline check follows renames: a moved file keeps its suppressions, and only those (a5b58c2).
  It sees only staged renames (`git mv`).

## Behaviour changes

- `stop_stability` reports the stop that wandered furthest, not the first; `ENGINE_VERSION` 2 → 3, so every
  Dive's assessment is recomputed at start-up.
- A Dive whose values are taken from a Provider now has its assessments refreshed.
- Removing, renaming or merging an external Diver locks the Diver rows.
- A deleted Dive's notice and Undo no longer survive sign-out into the next User's session.
- A blank account name on `POST /setup` and `/invitations/accept` gets 400.
- `divers.mergeExternal` no longer re-checks admin (the route gate does).
- `comparableOf` throws on an unreadable local start instead of returning null.
- CI fails when the test database is unreachable.

## Owner decisions (2026-10-30)

- The owner-path changes below are confirmed as they are: ADR 0059 and 0060 stay `accepted`, the ADR 0053
  amendment and the ADR 0033 edit stand, and `ConnectionRow` stays in `db/schema.ts`.
- `web_component_layer_untested_below_e2e`: add the dev dependencies component tests need.
- `two_qr_libraries`: drop uqr if qr serves both purposes (amends ADR 0043).
- `public_token_endpoints_unthrottled`: add a rate limiter on the public token routes (a new ADR).
- The four schema/migration items and `schema_single_file_hub`: `db/schema.ts` and new migrations may be
  changed for them.
- The confirmed owner-path changes: `ConnectionRow` in `db/schema.ts` (157cf38), ADR 0059 (POST
  `/api/tools/gas-plan`, 79bd9d4) and ADR 0060 (unpaged lists are bare arrays, 5b185dd), both breaking API
  changes, the ADR 0053 amendment (8dabed0) and the ADR 0033 edit.
- `mutual_domain_module_dependencies` and `web_src_root_flat`: later work, recorded in the backlog.

### What the decisions led to (2026-10-31)

- Component tests: Vitest has a `component` project (`*.test.tsx`, jsdom, Testing Library) beside `unit`;
  see [development.md](../development.md).
- `qr` both encodes and reads QR codes; uqr is gone (ADR 0043 amended).
- [ADR 0061](../decisions/0061-attempt-limit-on-token-routes.md): the five public token routes (`POST /setup`,
  invitation and password-reset lookup and complete) allow 30 attempts per 15 minutes per client IP, then
  answer 429 `too_many_attempts` with `Retry-After`. The count is in memory, so it restarts with the server.
- Migrations 0044–0045: `connection.credentials` is NOT NULL; old rows got label-only credentials.
- Migrations 0046–0047: the start-up backfills (`backfill_positions`, `backfill_gas_figures`,
  `fill_cylinders`) are gone. **0046 refuses to run while a live Recording's positions were never read**:
  a database that never ran the old backfill to the end must run it on the previous version first.
- Migrations 0048–0050: an Import's failure is `error_code` (enum) plus `error_detail`; the route passes the
  code through.

## Still open for the owner

- `schema_single_file_hub`: splitting `db/schema.ts` per domain is mechanical, but `OWNER_PATHS` in
  `scripts/agent-lib.mjs` (a protected path) names exactly that file; the owner widens it first.
- ADR 0053 doesn't yet name `compose.ts` / `start.ts` as assemblers, and its prose still says fit ↔ imports.

Items skipped as later work (temporary skips in desloppify's plan):

| Item | Why |
|---|---|
| `schema_single_file_hub` | see above |
| `mutual_domain_module_dependencies` | [backlog 0012](../backlog/0012-domain-module-layering.md) |
| `web_src_root_flat` | [backlog 0013](../backlog/0013-web-feature-folders.md) |

Small follow-ups: the web's `WATER_TYPES` copies could derive from the api-client; `db/schema.ts` still
names `providers/leases.ts` in two comments.
