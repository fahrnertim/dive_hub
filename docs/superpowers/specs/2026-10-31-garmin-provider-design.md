---
title: Garmin as a Provider - fetching a User's dives with their own Garmin Connect personal API key
summary: An import-only `garmin` Provider adapter on the existing Provider layer (ADR 0027), dive import (ADR 0030) and scheduled fetch (ADR 0056) - token sign-in with the User's own personal API key (link to Garmin's key page, optional expiry date), the original FIT file of each dive stored as the Original and read by the FIT adapter, idempotent with the same dive uploaded as a file, and a generic per-Connection choice of which kinds of dive to fetch (scuba, apnea) that SSI gets as well.
status: draft
date: 2026-10-31
---

# Garmin as a Provider

Design from the owner's answers on 2026-10-31 to the questions in
[the research note](../../research/2026-10-31-garmin-personal-api.md). "Owner" marks what the owner decided; "my call"
marks what the designer decided and the owner may overturn. The API's facts: [reference](../../references/garmin-connect-personal-api.md).

## Why

Garmin Descent divers today download each dive's file from Garmin Connect and upload it. Garmin now has an official
Personal API: every dive of an account with its original FIT file, read with a key the User creates. A Garmin
Provider lets Dive Hub fetch those dives by itself, the way it fetches SSI's, with the full computer data.

## Goals

- A User connects Garmin by pasting their own personal API key; Dive Hub fetches their dives by hand or on the
  scheduled fetch, with the preview of the existing Provider dive import; each dive is then placed as an uploaded
  file would be.
- Each dive arrives as a full Recording from Garmin's original FIT file, which is kept as its Original.
- A dive that is already here as an uploaded file, and the same dive fetched from Garmin, are one Recording, in
  either order, however often it is fetched (owner: idempotent).
- Per Connection, the User chooses which kinds of dive to fetch: scuba, apnea or both, both by default (owner:
  fetch everything, a setting per Provider Connection; SSI gets the same setting).

## Non-goals

- Sending anything to Garmin: the API is read only. The Garmin Connection has no Push, no read-back, no automation of
  sending (`sendChanges`, `sendNewDives`, `deleteAtProvider` stay off and hidden for it).
- Garmin's activity name, wellness data, sites, buddies: not taken (owner: the name isn't needed, the original file is
  kept).
- One shared key for several Users, or the owner's key used for others.
- A terms notice: Garmin makes the User accept the terms before giving a key (owner).

## Anti-goals

- Fetching twice what is here once: no duplicate Recordings or Dives, ever.
- Calls Garmin could see as abuse: Garmin publishes no limits and may revoke keys.
- The key in a log, an error message, a test fixture or the repository.

## What exists and is reused

| Need | There |
|---|---|
| Provider adapters, capabilities, Connections, sealed credentials, token sign-in | ADR 0027, `providers/provider.ts`, `connection-service.ts`, `Connections.tsx` (token field) |
| Import a Provider's dives: preview, trust per computer, matching, Recordings | ADR 0030, `providers/dive-import/dive-import.ts` |
| Scheduled fetch | ADR 0056, `providers/dive-import/scheduled-fetch.ts`, `connection.fetch_every_minutes` |
| Read a Garmin FIT dive | `imports/formats/fit/fit-adapter.ts` (ADRs 0006, 0037) |
| Dive kinds and modes | `DIVE_KINDS` (`scuba`, `apnea`, ADR 0044), dive mode (ADR 0057) |

## Decided

### Sign-in (owner)
- `signIn: { kind: 'token' }`. The User pastes their own key; the form links to
  `https://connect.garmin.com/app/settings/personalApiToken` ("Create a key at Garmin Connect"). The key is kept,
  sealed, always: without it there is no next fetch (the "don't keep" choice is not offered for Garmin; my call).
- **Expiry date, optional (owner).** Garmin has no endpoint that tells a key's expiry (probed 2026-10-31; the 24-hour
  token only shows it on the key's last day). The User may enter the date the key expires; from a week before,
  the Connection shows that the key expires on that date and links to the key page. Without a date, nothing is
  shown until the key stops working. A new key replaces the old one through the Connection's sign-in again.
- The adapter trades the key for a token (`POST …/personal-api-key/token`, `Authorization: ApiKey`, `Accept: */*`,
  plain-text answer) and reuses it until a minute before its `exp` (my call); it never logs the key or the token.
  401/403 on the token call is `signed_out` (the generic layer then shows `needs_sign_in`); no retry with the same key.
- **The account** (my call): its ID is the token's `garmin_guid` claim (seen 2026-10-31), its label the profile's
  display name (`/userprofile-service/userprofile/settings`, or the listing's `ownerDisplayName`; the builder checks
  which the fake can mirror). A key of another Garmin account on signing in again is refused as today
  (`provider_other_account`, `connection-service.ts:244`). The token credentials' `access` is the key itself.

### Fetching (owner: everything; my call: how)
- `dives` import with `list`: `GET /activitylist-service/activities/search/activities?activityType=diving&start=&limit=`,
  page size 100, until a page is shorter: **always the whole account's dives, a complete read** (my call; 29 dives were
  one call on the owner's account). So the kinds setting changed later takes in older dives at the next fetch, a dive
  that failed is tried again, and gone-dive findings (ADR 0051) work as for SSI.
- The listing gives the preview what it shows (local start, depth, duration, kind). A dive is downloaded only when it
  is new: its `activityId` isn't the remote ID of a Recording or link this Connection has already. The worker
  downloads one at a time, with a 1 s pause between downloads (my call; Garmin publishes no limits). Scheduled fetch
  minimum: 60 minutes (the existing smallest interval).
- **Every Garmin dive is a computer dive placed like an uploaded file** (my call). The listing has no serial number,
  so the per-computer choice of ADR 0030 doesn't apply: there is no `unchosen`, an unattended fetch never waits on a
  choice, and matching to existing Dives happens after the worker has read the FIT, through the same placement as an
  upload (`imports/placement.ts`). A dive entered by hand at Garmin (`isManualActivity`) has no computer file: listed
  as skipped ("entered by hand at Garmin").
- **No Provider fields** (my call): the adapter declares no `fields` for import, so the sync and Conflict path of
  ADR 0056 doesn't run for Garmin; everything comes from the FIT. A Dive changed at Garmin later (its name, notes) is
  not followed, as for a file.
- The download (`GET /download-service/files/activity/{id}`, `Accept: */*`) is a zip with one `.fit`; the FIT is
  unzipped and stored as the Original (`application/vnd.ant.fit`, file name `<activityId>.fit`), and read by the
  FIT adapter. Not the zip, not the JSON (owner: the original file is kept).
- **The generic layer grows by one optional operation** (my call): an adapter whose dives come as files declares
  `file(remoteId)` returning `{ bytes, mediaType, fileName }`; `dive-import.ts` stores it as the Original and reads it
  with the file format adapters instead of `parse(record)`. SSI is unchanged.

### One Recording per dive (owner: idempotent)
- A Recording from Garmin takes the FIT file's own identity as its `recordingKey`, the key an uploaded copy of the
  file gets (`${manufacturer}:${serial}:${startSeconds}`, `fit-adapter.ts:224-227`), not `garmin:<activityId>`. The
  Garmin `activityId` is kept as the remote ID, so a known dive isn't downloaded again.
- **Which copy stays** (my call): a fetch never replaces a Recording that is already here under that key; it only
  records the `activityId` as the Recording's remote ID at Garmin. An upload by hand keeps today's behaviour (the
  User's explicit file replaces, `placement.ts` reimport). A byte-identical file shares its Original by sha256 as
  today. So: file then fetch, fetch then file, fetch twice: one Recording each time.
- The ADR 0030 rule "skip a Provider's Recordings when Dive Hub has this Device from files already (its files are
  better)" doesn't apply to Garmin: its Recordings *are* the files. The adapter declares that its dives come as the
  computer's original files (my call: as the presence of `file`).

### Which kinds to fetch (owner)
- A new Connection setting, generic for every Provider with a dive import: the kinds of dive to fetch, a subset of
  `DIVE_KINDS`, both by default. The import skips a dive whose kind isn't chosen, by its dive mode (`apnea` is apnea,
  everything else is scuba); the preview lists it as skipped with the reason, so the User sees why.
- Garmin: the kind is known from the listing (`apnea_diving` and the other apnea types, as `fit-vocabulary.ts` maps
  them), so a skipped dive is never downloaded. SSI: from `odin_user_log_dive_type` (`ssi-dive-type.ts`).
- Stored as a new column on `connection` (a migration: owner path; my call for the shape, e.g. `fetch_kinds
  dive_kind[] not null default '{scuba,apnea}'`). Settable through the Connection's settings route, shown in the
  Connection's settings in the web.

### Capabilities and clients
- `GET /api/providers` lists Garmin with `dives: { import: { operations: ['list'] } }` and no export: the web shows no
  "send", no read-back fields, no automation of sending for it. Its token field label and hint name the Garmin key,
  with the link. The client contract gets the expiry notice and the kinds setting
  ([clients.md](../../spec/clients.md)).
- Problem codes stay the generic `provider_*` ones.

### Tests
- A fake Garmin server in `apps/server/test/` (like the fake SSI): token, listing, download, 401/403/406 behaviours.
  Its FIT files are the repository's existing Garmin test files; no data from the owner's account.
- Tests first for: the token exchange and its reuse, the listing pages, the file as Original, the kinds setting
  (Garmin and SSI), and idempotence both ways (file then fetch, fetch then file, fetch twice).
- A browser test (area tag of the Connections page) for connecting Garmin with a key and an expiry date, and for the
  kinds setting.

## ADR

One new ADR, `proposed` until the owner accepts it: "Garmin as an import-only Provider", covering the generic
`file` operation, the file identity as `recordingKey` across Providers and uploads, the kinds setting on every
Connection, and the optional key expiry. It amends ADR 0030 (the "files are better" rule and the per-computer
choice don't apply to a Provider whose dives are files; a fetch never replaces a Recording already here) and ADR 0027
(a dive may come as a file).

## Left to the builder

- Where in `dive-import.ts` the file path branches off, and how the worker's Original reading picks the format adapter.
- How the FIT file's identity is formed today for uploads, and reusing exactly that.
- The texts (en, de) and where the expiry notice sits on the Connection.
