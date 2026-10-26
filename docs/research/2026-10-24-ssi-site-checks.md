---
title: SSI checks of private sites (save_divesite, get_divesite)
summary: On the owner's account (app 5.0.43) save_divesite creates a private site and answers its ID at the top level (odin_dive_sites_id). get_divesite answers a one-element JSON array, 404 for an unknown ID. A new site with no dive is in logbook_sites at once, with is_private 1 and the account as owner. A site was not deletable with `odin_dive_sites_deleted` true or 1 ("update saved", not stored) [T], and the app has no delete [R]. Task 3 reads the new ID from the top level.
status: done
date: 2026-10-24
---

# SSI checks of private sites

Run by the controller with the kept token on 2026-10-24, announced in the session: `round-trip.ts site probe`, then `site get` and `site delete`. Account 3664600, public site 666, MySSI app 5.0.43. [T] tested on the owner's account, [R] read in the app's code. Background: [write bodies](2026-10-22-ssi-write-bodies.md) (`siteUpload`), [SSI app API](../references/ssi-app-api.md#sites-save_divesite-get_divesite).

## What was sent
`save_divesite`, query `token`, body `json_data` = the `siteUpload` row without `internalPk` and `needsUpload` (19 keys): `odin_dive_sites_id` null, `_name` "Dive Hub test", `bow` salt, `_lon`/`_lat` 0.001, `odin_countries_code_iso` null, `odin_dive_sites_is_private` (1; `true` was accepted too and stored as 1), `odin_dive_sites_is_private_owner` (the account's `mid`), `odin_dive_sites_deleted` 0, the rest null. `get_divesite`: query `token`, `dsid`.

## What SSI answered
- **Create** [T]: HTTP 200. The new ID (1083262) is at the answer's top level `odin_dive_sites_id`, in `success.New.odin_dive_sites_id` and in `result.site.odin_dive_sites_id`. `result.site` has `is_private` 1 and the owner set to the account.
- **`get_divesite`** [T]: a known site answers HTTP 200 with a JSON **array of one row**, not an object (the transport rejects a non-object top level as `bad_response`; Task 3 must accept a one-element array). The row has `odin_dive_sites_is_private` (1 for the own private site, 0 for public 666), `odin_dive_sites_is_private_owner` (for the private one) and `odin_dive_sites_deleted`. An unknown ID (999999999) answers HTTP 404 (the transport says `unavailable`).
- **`get_divelog`** [T]: the new site, with no dive, **is** in `logbook_sites` right after creation, with `is_private` 1 and the owner set to the account.
- **Delete** [T]: `save_divesite` with the same row, the ID and `odin_dive_sites_deleted` true, and again with 1: the answer is "update saved", but `result.site.odin_dive_sites_deleted` stays 0 and the site stays in `logbook_sites`.
- **Flags** are answered as the numbers 0/1.
- **App code** [R] (Blutter output of 5.0.43): the app never sets `odin_dive_sites_deleted`, it only reads it (`sites_store.dart`) and removes a server-deleted site from its local table. `ssi_api.dart` has only `save_divesite` and `save_divesite_descr` for sites; `site_create` and `site_select` have no delete.

## Result
A site created at SSI was not deletable with `odin_dive_sites_deleted` true or 1 [T], and the app has no delete [R]; other ways to delete were not tried, so Dive Hub plans as if a created site stays (consistent with the rule that deleting a site here never deletes it at SSI). The test site 1083262 "Dive Hub test" (private to the account) stays; Task 8 reuses it.

## Decision for Task 3
The new site's ID is read from the answer's top-level `odin_dive_sites_id`, with `success.New.odin_dive_sites_id` as fallback. `get_divelog` is not needed to learn it. No STOP.
