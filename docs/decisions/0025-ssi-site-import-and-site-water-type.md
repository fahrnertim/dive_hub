---
title: "ADR 0025: SSI site import, offers on hand-made sites, and the water type on the Dive site"
summary: Admins import SSI's site list like OSM (confirmed explanation, no SSI data in image or repo, private sites and comments never kept); per-field precedence (SSI first for name and country, OSM for position); hand-made sites keep a Source's values as an offer any User can take ("Use SSI's data"); "only fill" runs; the water type moves from the Dive to its site (fresh, salt, brackish), with a hint when the computer was set to other water. Amends 0015, 0021, 0024.
status: accepted
date: 2026-10-05
---

# ADR 0025: SSI site import, offers on hand-made sites, and the water type on the Dive site

## Status
Accepted – 2026-10-05. Amends [ADR 0015](0015-overrides-vocabulary-and-browser-tests.md) (the water type is no longer a
Dive value or Override), [ADR 0021](0021-site-external-ids-and-import.md) (precedence per field; references keep an
offer; typed references on imported sites provide data) and [ADR 0024](0024-ssi-target-via-app-api.md) (what the SSI
site import takes: no alias names; sending uses the site's water type).

## Context
ADR 0024 decided an admin import of SSI's site list "the same way as OSM", at the operator's risk. Building it raised
questions the ADRs left open, and the project owner decided a second change alongside: the water type belongs to the
place, not the dive.

What SSI's file looks like, checked once on 2026-10-05 against a download kept in `samples/private/` (never committed):
- `APP_CACHE_SITES.zip` holds one `sites.json` (19 MB): `{ created, divesites_total, divesites_locked_total,
  divesites_deleted_total, divesites: [...] }` with 24,510 sites.
- Per site: `odin_dive_sites_id`, `_name` (4 are numbers), `_lat`, `_lon` (rounded: 2,276 to 3 decimals, 245 to 2,
  34 to 1), `odin_countries_code_iso` (ISO **alpha-3**; 639 empty; the withdrawn `ANT` still used), `_deleted`
  (`0` or `""`), `_is_private` (43 sites, with `_is_private_owner`, an SSI user ID), `_geo_locked`, `_comment`
  (moderation notes with IP addresses), `bow` (salt 20,664, fresh 2,992, artificial 835, missing 19), `alias_names`
  (7,623 sites), `iso2` (a **language** code, not a country), `current` and `odin_user_log_animal_ids` (statistics,
  wildlife), meta address/region/country.
- Details: [SSI app API reference](../references/ssi-app-api.md#the-site-list-app_cache_siteszip).

The owner decided the points below on 2026-10-05.

## Decision

### SSI site import
- **Source `ssi` in `IMPORT_SOURCES`**, adapter `apps/server/src/sites/import/ssi-sites.ts`: one GET of the zip
  through the polite HTTP client (User-Agent, retry rules of ADR 0021), unpacked with yauzl, the first JSON file read.
  Anything else (HTML, a broken zip, no JSON, no `divesites`) is `source_unavailable`. The URL can be configured
  (`DIVEHUB_SSI_SITES_URL`). No SSI sign-in.
- **Kept per site:** the SSI ID, name, position, country (alpha-3 → alpha-2; `ANT` and unknown codes → none) and water
  type from `bow` (salt → salt, fresh → fresh, artificial or missing → none). **Never kept:** comments, private sites
  (with their owners), statistics, wildlife, alias names, addresses. Sites whose `_deleted` is truthy are left out;
  `""` counts as not deleted.
- **Areas:** country, box and everywhere, applied after the one download.
- **"Only fill dive sites that are already here"** (`createSites: false`): the run matches and fills, and creates
  nothing (counted as `skippedNew`). Lower risk for operators who only want SSI IDs and water types on their sites.
- **Confirmation:** before an SSI run the admin ticks an explanation (no licence; EU database right; the operator's
  decision and risk; what is taken and never stored). The Site import records `ssi_confirmed_at`; the API refuses
  without it (`ssi_not_confirmed`).
- **Alias names are skipped** for now: there is no field for them. They could later help matching.
- No SSI data in the image or repository. Tests use a hand-made file in SSI's format
  (`apps/server/test/fixtures/site-sources/ssi-sites.json`), zipped at run time.

### Which Source wins, per field
Replaces ADR 0021's "OSM, then Wikidata" for every field. SSI's list is moderated (only position-checked sites are
in the file, and a third of a million were deleted); OSM has names that join several places. But SSI rounds
positions, some to a kilometre.

| Field | Order |
|---|---|
| Name, country, water type | SSI → OSM → Wikidata |
| Position | OSM → SSI → Wikidata |
| Body of water, description, maximum depth | OSM → Wikidata (SSI has none) |

The first SSI run renames OSM sites SSI also lists, unless a User changed the name (3-way merge, with Revisions).

### Hand-made sites: an offer, never a change
- Imports still never change a hand-made site by themselves (ADR 0021). Its reference now **keeps the Source's
  values** (`imported` on a reference), and the site page offers them: **"Use SSI's data"** (any Source).
- **Any User** may take it, like editing and merging (ADR 0022). It works like a merge of the Source's record into the
  site: **empty fields take the Source's values, filled ones stay**. The dialog lists what fills and what differs.
  The reference then provides data: the site shows "From SSI" (or OSM's Attribution), and later imports keep the
  taken fields current. One Revision, cause `adopt`, actor the User. API: `POST /api/dive-sites/:id/adopt`.
- The Site import lists the hand-made sites that got an offer (finding `offer`, count `offered`).
- An SSI ID a User typed on a site that **already has import data** becomes data-providing when an SSI import finds it
  (the site is not hand-made, so it merges per field like any imported site).
- The SSI ID stays editable. Changing it drops the old ID with its values; the next import treats the old SSI site
  as another place.

### Speed
Matching uses latitude bands as wide as the report distance (200 m), so a worldwide run of ~24,000 SSI sites plans in
well under a second instead of comparing every object with every other. Findings are all stored; the page shows 50
per kind and the rest as a number.

### The water type moves to the Dive site
1. **Dive sites get a water type:** fresh, salt or brackish (not the device-only EN 13319 and custom). Editable by any
   User (version, Revisions), merged per field on re-import, a gap filled on merge (ADR 0022). The site form says that
   changing it changes the water type of every Dive at the site. Stored in the existing `water_type` enum, limited to
   the three words by a check constraint.
2. **The SSI import fills it** from `bow`. OSM and Wikidata don't.
3. **A Dive's water type is its site's.** It is no longer a Dive value: removed from `OVERRIDABLE_FIELDS`, the Dive's
   column (migration 0011), the edit form and the API's Dive values; existing Overrides of it are dropped (custom
   migration 0012, without Revisions). A Dive without a site has no water type, and the dive page suggests choosing a
   site. The API gives it as the Dive's `waterType`, read-only; an old client's `set.waterType` is dropped.
4. **The computer's setting stays on the Recording** (summary `waterType`, `waterDensity`) and is shown with the
   device data as "Water setting on the computer" / "Wassereinstellung am Computer".
5. **Mismatch hint:** when the Primary recording's setting differs from the site's water type, the API sets
   `waterMismatch` and the dive page says so, e.g. "Your computer was set to salt water; this site is fresh water. Its
   depths read about 2 % shallow." The percentage comes from densities (fresh 1000, salt 1025, EN 13319 1020 kg/m³, or
   the density the computer recorded): recorded/true depth = site density / set density. Below 1 % (EN 13319 in salt
   water) nothing is said; with brackish water or an unknown density it says the depths may read a little off. No
   depth correction.
6. **Sending to SSI uses the site's water type** (fresh 4, salt 5, brackish nothing). Pushes sent before this change
   show as outdated once, because the fingerprint covered the computer's setting; sending again changes nothing at SSI
   where the site has no water type (an empty value keeps SSI's).
7. **Old Revisions** that mention a Dive's water type stay readable in the history.

## Considered options
- **OSM first for every field** (ADR 0021 extended): keeps names stable, but keeps OSM's merged-place names.
- **Imports filling gaps on hand-made sites automatically:** simpler, and a 3-way merge never overwrites what Users
  wrote. Rejected by the owner: a hand-made site changes only when a User decides.
- **"Update only sites that already have an SSI ID":** helps only where someone typed one. "Only fill" covers it and
  also matches by name and position.
- **A depth correction** when the computer was set to other water: later, if wanted; the hint comes first.
- **A new enum for the site's water type:** cleaner names, but drizzle-kit's interactive rename prompt and two enums
  for the same words; a check constraint is enough.

## Consequences
- The glossary's Site import includes SSI; water type of a site and the computer's water setting are separate terms;
  "offer" and "adopt" are new.
- The client contract gains duties: the mismatch hint and the missing-site suggestion, the site form's note, the SSI
  explanation and its confirmation, offering a Source's data with what it fills.
- Editing a site's water type changes what every Dive there shows, also other Users' Dives, without a Revision on
  them (the Dive didn't change; its site did).
- The operator carries the risk of an SSI import; the operator docs ([architecture](../spec/architecture.md#dive-site-imports-and-licenses)) say so.
