---
title: "ADR 0027: Providers as adapters that declare their capabilities"
summary: Outside services with Connections (SSI now, PADI later) are Providers - one adapter each, declaring how Users sign in, what it imports or exports per kind of data, with which operations, how delivery is confirmed and how fast it may be called; a generic layer owns Connections, sealed credentials, Pushes, "outdated", locking, pacing, problem codes, the routes and asking every Provider when a Dive is deleted. Routes and problem codes become generic; GET /api/providers hands the capabilities to clients; existing Connections sign in again once. Amends 0024 and 0026.
status: accepted
date: 2026-10-05
---

# ADR 0027: Providers as adapters that declare their capabilities

## Status
Accepted – 2026-10-05. Amends [ADR 0024](0024-ssi-target-via-app-api.md) (where the SSI code sits, the Connection's
credentials, the routes and codes, the pause between actions) and [ADR 0026](0026-deleting-dives.md) (deleting asks
every Provider the Dive is at, not SSI by name).

## Context
The [SSI integration review](../research/2026-10-05-ssi-integration-review.md) found the SSI code sound but not generic:
one service mixed what every outside service needs (Connections, Pushes, "outdated", one action per Dive, token
renewal) with SSI's own steps, read SSI's raw `odin_*` record in eleven places, and gave clients SSI-shaped routes,
codes and a Connection that assumes e-mail and password. Deleting a Dive called SSI by name. ADR 0024's pause between
Pushes wasn't built, and each send read SSI's whole logbook twice.

The remaining SSI work (buddies, the QR payload, importing dives from SSI) and a later PADI would each have repeated
that. PADI has no logbook API ([dive data sources](../research/2026-10-02-dive-data-sources.md)), so a QR code or
browser automation hands a dive over without an ID back; another service may sign Users in through OAuth in their
browser.

The project owner decided on 2026-10-05: refactor before the remaining SSI work; capabilities live in the adapter
and pass through to clients; Users see no change, apart from signing in to SSI once more after the migration.

## Decision

### Words
- **Provider** (German *Dienst*): an outside service Dive Hub talks to through an adapter, such as SSI and later PADI.
  It is a Source for the kinds of data it imports and a Target for those it exports. Files and open datasets (Garmin
  FIT, UDDF, OpenStreetMap, Wikidata) stay plain Sources; they have no adapter of this kind and no Connection.
- The UI names the Provider ("SSI"), not the word.

### The adapter declares
`apps/server/src/providers/provider.ts` holds the interface and the capability types. An adapter declares:
- **Sign-in:** `none`, `password` (the login is an e-mail or a user name; the User may let Dive Hub keep the password,
  sealed, so it renews by itself) or `token` (the User pastes one). OAuth in the User's browser is designed below but
  not built: no Provider offers it yet.
- **Per kind of data** (`dives`, `diveSites`, later `buddies` and more): `import`, `export` or both, each with its
  **operations**: `create`, `update`, `delete`, `link` (to a record already there), `find` (with how: by our reference,
  by a time window, near a position), `list` (a whole list without a Connection) and `readBack`.
- **Delivery** of an export: `confirmed` (an ID comes back) or `handed_over` (QR, browser automation: no ID, so no
  update, delete or link).
- **What an export needs**, e.g. the Dive site's External ID at the Provider's site Source (SSI site ID).
- **Read-back fields**, the names under which differences are reported (clients translate them).
- **Notices** a client must show, e.g. `shows_unconfirmed` (SSI shows dives sent this way as unconfirmed).
- **Limits:** the pause between actions on one Connection. One action at a time per Connection holds for every Provider,
  so it isn't declared.

Its behaviour is a small interface: `signIn`, and per kind an `open(context)` that returns the operations for one
action. Everything the Provider says comes back as typed values: an adapter error carries a reason (`wrong_credentials`,
`signed_out`, `refused`, `unavailable`, `bad_response`); a remote dive is `{ remoteId, number, startsAt, maxDepthM,
durationMinutes }`. No `odin_*` field is read outside the SSI adapter.

### The generic layer owns
- **Connections** (one per User, Diver and Provider), their **sealed credentials** and their state. Signing in again
  after `signed_out` with a kept password is silent; otherwise the Connection is `needs_sign_in`.
- **Pushes:** recording each action, the current remote record of a Dive, "outdated" by the adapter's fingerprint, one
  action per Dive at a time (`provider_busy`).
- **Pacing:** actions on one Connection run one after another, with the adapter's pause between them; a second request
  waits its turn instead of failing. In one process, like the Dive lock.
- **Problem codes:** adapter reasons become `provider_*` codes, with the Provider named in the answer.
- **Routes** and the **capabilities endpoint**.
- **Deleting a Dive:** asks every Provider the Dive is at (ADR 0026, now not SSI by name).

The registry (`providers/registry.ts`) is built once in `main.ts` with the production adapters. Tests build it with
the fake SSI and a test-only adapter.

### SSI as an adapter
`apps/server/src/providers/ssi/`: the client, the record mapping, the logbook read, the ±2 min match, SSI's dive
numbers, the SSI site ID and the site list for the admin's Site import (`ssi-sites.ts`, still a `SiteSourceAdapter`).
Its fingerprint is unchanged, so Pushes sent before stay up to date.
- **One logbook read per action, shared with the read-back:** an action reads the logbook at most once before it
  saves. The read-back after a save is kept for two minutes per Connection and serves the next action's duplicate
  check and dive number, so sending several new dives in a row reads n + 1 times instead of 2n. Updates and deletes
  always read afresh: they write SSI's current record back, and a stale copy could bring back a dive just deleted in
  SSI's app. A delete takes the dive out of what is kept.
- **Pause:** 2 s between actions on one Connection.

### Dive site import
The SSI adapter declares `diveSites` with `find` (near a position, from the User's logbook) and `list` (SSI's whole
list, no Connection). The admin's Site import still takes its Sources from `createSiteSources`, which now gets SSI's
from the adapter's folder. OpenStreetMap and Wikidata stay `SiteSourceAdapter`s; folding them in can come later.

### API (the client contract changes)
Replacing the SSI routes:

| Route | Does |
|---|---|
| `GET /api/providers` | every Provider with its capabilities, and whether this server can keep passwords |
| `GET /api/connections` | the User's Connections, any Provider |
| `POST /api/connections/{provider}` | connect a Diver (`login`, `password` or `token`, `keepSignedIn`) |
| `POST /api/connections/{id}/sign-in` | sign in again |
| `DELETE /api/connections/{id}` | disconnect |
| `GET /api/dives/{id}/providers` | the Dive at every Provider that exports dives |
| `GET /api/dives/{id}/providers/{provider}` | the Dive at one Provider |
| `POST`/`DELETE /api/dives/{id}/providers/{provider}` | send (create, update, link) / delete there |
| `GET /api/dives/{id}/providers/{provider}/sites` | the Provider's sites near the Dive, to pick its site ID from |

- `DELETE /api/dives/{id}` takes `alsoAt: [provider…]` instead of `inSsi`, and answers
  `{ providers: [{ provider, copy: 'deleted' | 'kept' }] }`. `GET /api/dives/deleted` gives each Dive's
  `stillAt: [{ provider, remoteNumber }]`.
- **Problem codes** are generic, and the answer names the Provider (`provider`, `providerName`):
  `provider_wrong_credentials`, `provider_sign_in_needed`, `provider_unavailable`, `provider_refused`,
  `provider_already_connected`, `provider_account_taken`, `provider_other_account`, `provider_not_connected`,
  `provider_site_id_missing`, `provider_not_sent`, `provider_dive_gone`, `provider_busy`, and new
  `provider_unsupported` (an operation the Provider doesn't offer). `ssi_not_confirmed` stays: it is the SSI Site
  import's licence confirmation, not a Provider error.
- A Push says whether the remote record was found gone (`remoteGone`) instead of reusing a failure code for it.
- `{provider}` in a path is a string, not an enum of today's Providers: clients take the list from `GET /api/providers`,
  and the registry answers others with `provider_unsupported`.
- **Texts:** clients word a Provider's things generically with its name ("Send to SSI"); where a sentence states a fact
  of one Provider (SSI's app can't bring a deleted dive back), the web client has that Provider's own text.

### Data
- `target` becomes `provider`, a text column the registry checks instead of an enum, so a test-only adapter needs no
  migration. `connection.account_email` becomes `account_label`.
- **One sealed `credentials` field** per Connection, shaped by sign-in kind (password: login, token, password when
  kept; token: the token), bound to the row and purpose `connection:<id>`. `keep_signed_in` stays.
- **Existing Connections sign in again once:** the migration drops the old token and password (re-sealing needs the
  key, which SQL can't reach) and sets them `needs_sign_in`. The owner, the only User so far, accepted this.
- Stored failure codes are renamed; "gone" becomes `push.remote_gone`.
- **Connection Diver mappings** (ADR 0024) get their table with buddies, not now.

### OAuth, when a Provider needs it (designed, not built)
`POST /api/connections/{provider}/start` returns the Provider's authorisation URL; the server keeps `state` and the
PKCE verifier for ten minutes, bound to the User's session. `GET /api/connections/{provider}/callback` checks `state`,
exchanges the code, stores access and refresh tokens in `credentials` and returns to the account page. Renewal uses the
refresh token the way `password` uses a kept password.

### Still as before
Sending and deleting run in the request ([ADR 0010](0010-graphile-worker-job-queue.md)'s worker comes with batch sending or
importing). Behaviour and texts for SSI are unchanged.

## Considered options
- **Keeping Source and Target as the only words:** they are roles; SSI is both, and the code needed one name for the
  thing with an adapter.
- **Folding OSM and Wikidata in now:** risk without anything for Users; they have no Connection.
- **SSI routes beside generic ones for a while:** the web client is the only client; two sets double tests.
- **Codes per Provider** (`ssi_*`, `padi_*`): the enum grows with every Provider and clients translate the same
  sentence again.
- **Capabilities only inside the status answers:** the account page needs them before any Dive is open.
- **Re-sealing secrets at server start** instead of signing in again: needs a one-off step with the key; not worth it
  for one User.
- **Deferring the read-back to the next action** (truly one read per action): differences would show up an action late.
- **Sending in a worker now:** the `exists` question and "nothing was deleted" rely on a synchronous answer.

## Consequences
- A new Provider is an adapter plus its fake, run through the contract suite (`test/provider-contract.ts`); the
  routes, the panels and the delete dialog follow from its capabilities.
- The client contract ([clients.md](../spec/clients.md)) changes routes, codes and fields, and gains a duty: render
  from `GET /api/providers`.
- A test-only adapter (token sign-in, handed-over delivery) proves the layer generic; it is never registered in
  production.
- Pacing and the Dive lock live in one process; several app processes would need a database lock.
- A logbook snapshot can be up to two minutes old: a dive logged in SSI's app within that time isn't offered as
  "already in SSI" on the next create.
