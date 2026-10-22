---
title: How the SSI app reads its API answers (app 5.0.43)
summary: Which keys the MySSI app takes from each answer, how strictly it checks them, and what a wrong or missing field or a non-2xx status does; for checking Dive Hub's reading of SSI answers.
status: open
date: 2026-10-22
---

# How the SSI app reads its API answers (app 5.0.43)

Read from the app with Blutter; [R] = read in the code. Companion to [the API surface](2026-10-22-ssi-app-api-surface.md),
[the dive body](2026-10-22-ssi-save-divelog-keys.md) and [the write bodies](2026-10-22-ssi-write-bodies.md).

## The rule for every download [R]

- **Success is HTTP 200–299.** `requireSuccessful` throws "HTTP <code>: …" for anything else. So the 404 with a 2-byte body
  that this account got for `get_gearsets` and `get_emergency_contacts` is an **error for that sync** in the app, not an
  "empty" answer (what the user sees is not read; probably a failed sync [?]).
- **The status inside the body is a second channel:** a body `{"status":401,…}` signs the user out
  ([interceptors](2026-10-22-ssi-app-api-surface.md#the-two-error-interceptors-r)), whatever the HTTP code.
- **Dates:** the app stores the time of each successful download (`Last…Sync` keys) and decides by an update rate when to
  download again; not part of the API.

## Row answers use the same classes as the uploads [R]

Dives, sites, buddies, gear, gear sets and emergency contacts are read with the database row's own `fromJson`
(drift). The key and type tables of the write notes therefore hold **in both directions**: the 345 dive keys,
and the row keys of site (21), buddy (21), gear (20), gear set (10) and emergency contact (14).

- **Only the keys of the row are read.** Other keys in the answer are ignored (the reference lists 387 keys SSI returns for
  a dive; the app reads 345 of them).
- **A key that is absent reads as `null`**, which is fine for every nullable column. For a non-nullable column the cast
  fails. Non-nullable in the dive: only `odin_user_log_dive_type` (`int`) from the server side; `internalPk` is local.
  Site: `odin_dive_sites_deleted` (`bool`). Gear set: `gearset_deleted` (`bool`). Emergency contact: `uec_priority`
  (`int`), `uec_deleted` (`bool`). Buddy and gear: none from the server.
- **The app sets before reading:** for a dive, `needsUpload = false` and `odin_user_log_deleted = false`; for a site and
  the others, `needsUpload = false` (and the row id of the matching local row). So deletion is not read from the answer
  for dives: a deleted dive is simply **absent** (the reference says so too).
- **A wrong type is not tolerated.** A dive that fails to convert is checked by a schema check
  (`validateJsonAgainstSchema`: "Missing required (non-nullable) field", "Expected <type>, but got <type>. Value: …"), the
  app sends itself a critical feedback (`get_divelog`, with the dive's ID and number) and **rethrows**: the whole logbook sync
  fails, not just that dive. A site that fails the same way is reported as "get_divelog -> site".
- **Numbers and strings:** the types are strict (`int`, `double`, `String`, `bool`, `DateTime` as text, `List<int>` for
  `…_buddy_ids`-style lists, `Map` for `gear_images`). Whether a number given as a string is accepted is not verified; assume
  no.

## Top-level keys per answer [R]

| Call | Keys the app reads |
|---|---|
| `get_divelog` | `logbook_details` (dives), `logbook_sites`, `logbook_stats` (kept as statistics), `logbook_history` (kept as a local summary) |
| `get_buddies` | `user_buddies` |
| `get_gear` | gear rows; gear images are downloaded as files separately |
| `get_gearsets` | gear set rows (HTTP 404 = error) |
| `get_emergency_contacts` | contact rows (HTTP 404 = error) |
| sites | `divesites` (the site list; also the `APP_CACHE_SITES.zip` file) |
| `get_user_data` | `authenticated`, `token`, `mid`, `email`, `user_no_dives`, `user_no_freedives`, `apis`, `my_divessi_url`, `ems_apis`, `status`; the rest is the `User` object |
| gear reference data | `gear.zip` containing `gear.json` with `gear`, `manufacturers`, `main_category`, `main_product` |

## What this means for Dive Hub

- A client that reads an answer must check, in this order: HTTP 2xx, a body `status` of 401, the expected top-level key,
  then each field's **type**. The app fails a whole sync on one wrong type; Dive Hub should decide the opposite on
  purpose (skip one record, report it).
- Dive Hub's Dive rows should keep treating an absent key as "no value", which is what the app does for every nullable
  column.

## Not read / open

- The exact behaviour of the sync for `get_buddies`/`get_gear` when keys are missing (the same rule as above is assumed).
- A key-by-key comparison of a **fresh** `get_divelog` answer with the 345 keys the app reads: the capture stores no body
  for it (`size` 1.8 MB, no text), so this needs a new read-only call with the owner's token. Not done.
- The `User` object's own keys when read (the write side lists what it sends).
