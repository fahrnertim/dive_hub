---
title: Garmin Connect Personal API as a Provider - what it offers and a proposed design
summary: The Garmin Connect Personal API (official, read-only, one person's own data, key -> 24 h token) gives every dive of an account with its original FIT file, which Dive Hub's FIT adapter already reads in full; a Garmin Provider fits ADR 0027/0030/0056 as an import-only adapter with token sign-in, no new layer. Probed on the owner's account 2026-10-31. Ends with the proposed decisions and the questions for the owner (the terms and who may hold a key, key expiry, Recordings vs files of the same computer, apnea).
status: current
date: 2026-10-31
---

# Garmin Connect Personal API as a Provider (2026-10-31)

## Question

Can Garmin's new Personal API serve as a Provider, and what can it give Dive Hub? The facts with their sources are in
the [reference](../references/garmin-connect-personal-api.md); this note draws the conclusions.

## How it was found

- Web research (Garmin's developer pages and FAQ, the official Python client, community clients and reports); the
  sources are in the reference.
- A light read-only probe with the owner's key (2026-10-31): one token, two activity lists, one detail, one file
  download, a few list filters. Nothing written to the account; responses kept out of the repository.
- The downloaded file run through `createFitAdapter().parse`.

## Findings

1. **Every dive with its original file.** `activityType=diving` lists all of an account's dives (single gas, multi
   gas, apnea) newest first; the download gives the dive computer's own FIT in a zip (`isOriginal: true`). Dive Hub's
   FIT adapter reads it as a full Recording: device, depth and nine more series, events, entry and exit position.
   This is the same data as Garmin's "Export Original", without the User downloading files.
2. **Read only.** No upload, no edit: Dive Hub can be a Target of nothing here. No Push, no read-back, no link.
3. **Sign-in by key.** The User pastes a key (`GCDC_…`); each action trades it for a 24-hour JWT. The key must be
   kept (sealed) to fetch again; it expires after 30 days to one year, and the JWT doesn't say when.
4. **Quirks:** `Accept: */*` on the token call and the download (406 otherwise); the token comes as plain text.
5. **Limits unknown.** Nothing published; Garmin may throttle without notice. The listing is one call for a
   whole account, so a fetch is 1 + (new dives) calls.
6. **The detail adds** what a FIT file has as well (gases, tank pressures, GF, water type) plus a name Garmin may
   have changed later; no position, no site, no buddies, no notes beyond the name.
7. **Terms.** The key is personal; "not intended for commercial applications serving multiple end users" (FAQ).

## Fit with what exists

| Need | Already there |
|---|---|
| A Provider with token sign-in | `SignIn` `{ kind: 'token' }` ([ADR 0027](../decisions/0027-providers-as-adapters.md)) |
| Import a Provider's computer dives as Recordings, with preview, trust per computer, matching to Dives | [ADR 0030](../decisions/0030-importing-dives-from-providers.md), `providers/dive-import/` |
| Fetch by itself on an interval | [ADR 0056](../decisions/0056-two-way-exchange-and-automation.md), `scheduled-fetch.ts` |
| Read a Garmin FIT dive | `imports/formats/fit/` ([ADR 0006](../decisions/0006-license-apache-2-and-fit-parser.md), [0037](../decisions/0037-suunto-file-import-and-file-formats.md)) |
| Recording identity per Provider dive | `recordingKey` `<provider>:<remoteId>` |

So a Garmin Provider is an adapter in `providers/garmin/`, not a new layer.

## Proposed decisions (for an ADR once the owner has answered the questions)

- **Provider `garmin`**, sign-in `token`: the User pastes their own personal API key; it is kept sealed like a kept
  password, so fetching renews the JWT by itself. A token call answering 401/403 means `signed_out` and the
  Connection becomes `needs_sign_in` (a new key), never retried.
- **`dives`: import only**, operations `list` (one listing with `activityType=diving`, from the newest Dive known
  for the Connection, paged with `start`/`limit`) and the parse of one dive: download, unzip, the FIT adapter.
  No `diveSites`, no `buddies`, no export: the capabilities endpoint says so, and clients show no "send" for it.
- **remoteId** = Garmin's `activityId`; the Original stored is the downloaded FIT (not the zip, not the JSON).
- **Pacing:** one action at a time per Connection (generic), a conservative pause between downloads (proposal:
  1 s) and a scheduled-fetch minimum of one hour; the JWT is reused within its 24 hours instead of one per action.
- **The adapter's client** sends `Accept: */*` where needed and reads the plain-text token; tests use a fake Garmin
  server with made-up FIT files (from the test fixtures already in the repository), never the owner's data.

## Questions for the owner

1. **The terms and who may hold a key.** The key may be used only by its owner, with tools they operate for their
   own use, and not disclosed to a third party. Fine when a User runs Dive Hub for themself. When the admin of a
   shared Dive Hub (a club) runs it, the User's key sits on someone else's server. Options: (a) offer Garmin only
   on an instance where the User is the admin; (b) offer it to every User, with a notice that they accept Garmin's
   terms for their key; (c) offer it to every User without a notice. Proposal: (b), and the docs say (a) is the safe
   reading.
2. **Key expiry.** The JWT doesn't carry the key's expiry. Ask the User for the expiry they chose (30/90/180/365
   days) when pasting the key, to warn a week ahead like Garmin's e-mail? Proposal: yes, optional.
3. **Recordings vs files.** ADR 0030 skips a Provider's Recording when Dive Hub has that Device's files already
   ("its files are better"). Garmin's file *is* the original file. Treat Garmin as files (import its Recordings even
   then, matched by the FIT's own identity so a dive uploaded by hand and fetched from Garmin is one Recording)?
   Proposal: yes; this needs a look at how a file Recording's key is formed.
4. **Apnea dives.** Fetch them too (the FIT adapter's support for apnea sessions is untested), or only scuba?
   Proposal: scuba first, apnea listed as skipped in the preview.
5. **The activity name.** Garmin's later edits of the name aren't in the file; take `activityName` from the
   list as the Dive's title on a new Dive? Proposal: no, Dive Hub has no title from files either; leave it.

## Not checked

- The Swagger page's full parameter list (renders only in a browser).
- Rate limits in practice; a key's expiry behaviour; whether a deleted activity disappears from the list (likely).
- An apnea or CCR dive through the FIT adapter.
