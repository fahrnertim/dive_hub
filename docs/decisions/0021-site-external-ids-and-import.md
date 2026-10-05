---
title: "ADR 0021: External site IDs and an admin import of Dive sites from OpenStreetMap and Wikidata"
summary: Sites carry external IDs per Source (osm, wikidata, ssi), which also show where a site comes from; admins import sites from Wikidata (CC0) and OSM (ODbL, confirmed after an explanation) by country, box or everywhere as a worker job; re-imports merge per field (3-way) and leave User edits alone; matching by link, then 100 m plus name; SSI IDs by hand; a maximum depth field.
status: accepted
date: 2026-10-04
---

# ADR 0021: External site IDs and an admin import of Dive sites from OpenStreetMap and Wikidata

## Status
Accepted – 2026-10-04. Amended by [ADR 0025](0025-ssi-site-import-and-site-water-type.md) (2026-10-05): precedence per
field (SSI first for name and country, OSM for position); references on hand-made sites keep the Source's values as
an offer any User can take; a typed SSI ID on an imported site provides data once an SSI import finds it.
Amended by [ADR 0029](0029-push-requirements-and-buddies.md) (2026-10-05): a typed site ID has its own route
(`PUT /api/dive-sites/{id}/external-ids/{source}`); the site API's `ssiSiteId` is gone.

## Context
ADR 0020 built Dive sites without external IDs. The [dive site sources](../research/2026-10-04-dive-site-sources.md)
research found two open datasets worth importing: OpenStreetMap (1,401 objects with
`scuba_diving:divespot=yes`, ODbL 1.0) and Wikidata (345 *recreational dive site* items, 313 with
coordinates, CC0). It recommended an optional admin import over bundling data, and SSI site IDs entered by hand
(SSI publishes no list). A site also needs to say where it comes from: ODbL requires attribution.

Checked on 2026-10-04 while deciding:
- Few cross-links exist. Only 39 OSM dive spots carry a `wikidata=` tag, and only 12 Wikidata items name an OSM
  object. Most OSM↔Wikidata pairs have to be matched by distance and name.
- Depth is sparse. On OSM dive spots, 177 have `scuba_diving:maxdepth`, 164 have `scuba_diving:depth`
  (typical depth, sometimes several values) and 46 have `depth`. On Wikidata, 2 items have a depth (P4511).
- In the actual data (all 1,401 OSM dive spots and all 345 Wikidata items, fetched 2026-10-04) **no** cross-link
  connects the two sets:
  - The 37 `wikidata=` tags point to items not classed as dive sites (reefs, wrecks).
  - Wikidata's 12 OSM IDs point to objects without the dive-spot tag.
  - Only 6 Wikidata items lie within 1 km of an OSM dive spot, and one (Vortex Spring, 96 m, same name) meets
    the 100 m + name rule.
  - 302 of the Wikidata items are in South Africa.
  - So duplicates between the Sources are rare today. Duplicates with hand-made sites are the common case.
- Usage policies. Overpass (overpass-api.de) asks for a User-Agent or Referer that identifies the app,
  no parallel queries, a 30 s pause after 429/406, and a self-hosted or paid server for commercial use.
  The Wikidata Query Service has a 60 s query limit and 60 s of processing per minute per client
  (User-Agent + IP). It answers 429 with `Retry-After` and blocks clients without a User-Agent that
  carries contact information (Wikimedia User-Agent policy).

The project owner decided the points below on 2026-10-04.

## Decision

### External IDs and Sources
- **External ID** (`dive_site_external_id`): `(site, source, external id)`. It is unique on `(source, external id)`,
  and a site has at most one ID per Source. The Sources are `osm` (`node/123`, `way/…`, `relation/…`), `wikidata` (`Q…`)
  and `ssi` (digits).
- **Each Source is defined once in code** (`apps/server/src/sites/sources.ts`, like `problems.ts`): its display name,
  license (name and link), attribution text and link pattern. Nothing of this is stored per site. The API returns each
  external ID with its link and the Source's attribution, so the web client repeats nothing.
- **Where a site comes from:** an external ID either **provides data** (the site was created or filled
  from that Source) or is only a **reference** (an import linked an existing site, or a User entered an SSI ID).
  - A site with a data-providing OSM ID says "From OpenStreetMap", with a link to the object and
    "© OpenStreetMap contributors" linked to the OSM copyright page.
  - A reference says "Also in OpenStreetMap", without the attribution, since none of its data was taken.
  - A site without data-providing IDs was made in this instance, and the page shows nothing extra.
  - The Dive sites page carries the OSM attribution line once whenever any listed site has OSM data.
- **SSI site ID:** a field in the site's edit form ("SSI site ID", digits). Any User may set it, under the site's
  version and with a Revision, like the other fields. OSM and Wikidata IDs are read-only, set only by imports.
  A taken SSI ID is refused (409 `external_id_taken`).

### Site import
- **Admins only** ("Import dive sites" on the Admin page). Operators carry the license obligations, and one
  import changes sites every User shares.
- **Sources per run:** Wikidata, OpenStreetMap, or both.
- **Area:** a country (ISO 3166-1 alpha-2), a bounding box (south, west, north, east in degrees), or everywhere
  (about 1,700 objects in all).
  - Country imports query OSM's country boundary, which in OSM includes territorial waters, and Wikidata's
    country (P17).
- **ODbL before an OSM import:** the form explains in plain words what ODbL asks: credit OpenStreetMap
  wherever the data is shown (Dive Hub does this), and if the site list is made available to the public, offer it
  under ODbL. The admin ticks "I understand" before an OSM import can start, and the Site import records who
  confirmed and when. A Wikidata-only import needs no confirmation (CC0).
  - A public instance needs nothing more from Dive Hub for now. The operator docs
    ([architecture](../spec/architecture.md#dive-site-imports-and-licenses)) say what such an operator must do.
  - An export of the OSM-derived site table is not built.
- **Runs as a worker job** (`import_dive_sites`, Graphile Worker, one attempt). A **Site import** record holds the
  Sources, area, language, who started it, status (`queued`, `running`, `done`, `failed`), progress, counts and
  findings.
  - Only one Site import runs per instance at a time. A partial unique index enforces it, and a second
    start gets 409 `site_import_running`.
  - The admin page polls the record. A worker start marks Site imports left `running` by a crash as failed.
- **What is imported:**
  - OSM objects with `scuba_diving:divespot=yes` (nodes, ways, relations; ways and relations at their centre).
    Objects without a name are skipped and counted.
  - Wikidata items that are instances of *recreational dive site* (Q2141554) or a subclass.
  - **Name:** local name first. That means OSM `name`; for a Wikidata-only site, the label in the language
    the admin picks in the form (default: their UI language), then English, then any label.
  - Position.
  - **Country:** the queried country, or Wikidata P17. A box or worldwide OSM-only site gets none.
  - **Body of water:** Wikidata P206, its label in the chosen language.
  - **Description:** OSM `description`. Wikidata's one-line descriptions are skipped.
  - **Maximum depth (new site field, below):** OSM `scuba_diving:maxdepth` only. "30", "30 m", "30 metres", "-40M"
    and "100 ft" are understood. Anything unclear (">30", lists) is left empty.
    `scuba_diving:depth` is the *typical* depth (OSM wiki, several values separated by ";"), so it is not
    taken as a maximum. The owner first agreed to take the upper end of its ranges, then the wiki's definition
    corrected that on the same day.
  - When OSM and Wikidata both describe a site, OSM's value wins for every field both have.
- **Matching an incoming object**, in this order:
  1. its own external ID on a site;
  2. the link between the Sources: an OSM object's `wikidata=` tag, or a Wikidata item's OSM ID (P11693/P10689/P402);
  3. **within 100 m and the same name** after normalising: case, accents and punctuation are ignored, and so
     are generic words such as "dive site" and "Tauchplatz". One name containing the other also counts.
     This step checks the other Source's incoming objects and existing sites.

  An existing site that already has an ID from the incoming object's Source never matches again.
  Without a match, a new site is created.
- **Existing sites:**
  - A site that already has import data gets the new Source's ID as another data-providing ID.
  - A **hand-made** site (no data-providing IDs) gets the ID as a **reference** only. Its fields are never
    overwritten.
  - Sites created within 200 m of an existing site are listed in the Site import's findings, so the admin
    can look (merging comes later, ADR 0020).
- **Re-import: a 3-way merge per field.**
  - Each data-providing external ID keeps the values its Source delivered last. The site's imported value of
    a field is the one from the Source with precedence (OSM, then Wikidata).
  - When a run changes that imported value, the site's field follows **only while it still equals the
    previous imported value**. A field a User changed stays, and no Conflict is raised.
  - A User fixing a name doesn't freeze position updates.
- **What a re-import never does:**
  - Sites deleted in the hub are never re-created: their external IDs stay and are counted as skipped.
  - Objects gone from the Source are left alone and counted.
  - Hand-made sites are never changed.
  - Earlier Dives are never linked to imported sites (ADR 0020).
- **History:** every site an import creates, updates or links gets a Revision with the actor **Site import**
  (`actor_type` `site_import`, its id) and cause `create`, `update` or `link`. The history names the Sources and the date.
  Imported sites have no creator, so only admins delete them (ADR 0020).
- **The site page gets its history** (`GET /api/dive-sites/:id/revisions`), which slice 7 recorded but didn't show.
  Every User reads it. To keep ADR 0020's rule that Users don't see who created a site, the history names a User
  only when it is the signed-in User ("you"). Anyone else is "another User".
- **Counts on the Site import:** created, updated, unchanged, kept (fields left because Users changed them),
  linked, skipped (no name, deleted in the hub), gone from the Source, failed.
  Findings list the new sites near existing ones.

### Talking to Overpass and Wikidata
- Both services sit behind our own interface (`SiteSource`: fetch the sites of an area in a language), one
  adapter each. Tests replay **recorded responses** (`apps/server/test/fixtures/site-sources/`, refreshed by a
  script run by hand), never the live services. The browser tests' server uses the same recordings.
- One query per Source and run, one after the other, never in parallel. The query carries a server-side timeout.
- On 429/406/503/504 the client waits (`Retry-After`, else 30 s) and tries once more, then the import fails with a reason.
  An answer that isn't the expected JSON (Overpass sends an HTML page when it is overloaded) counts as unavailable.
- **User-Agent:** `DiveHub (+<project URL>)`, plus the operator's contact from `DIVEHUB_CONTACT` when set
  (`DiveHub (+https://github.com/fahrnertim/dive_hub; ops@example.org)`).
  It carries nothing about the instance or its Users.
- The endpoints can be configured (`DIVEHUB_OVERPASS_URL`, `DIVEHUB_WIKIDATA_SPARQL_URL`), so a commercial operator
  can use their own or a paid Overpass server.

### Maximum depth
- Dive sites get **maximum depth** (`max_depth_m`, metres, optional, 0 < depth ≤ 400). It is shown in the User's
  units, editable by any User, and merged per field on re-import. Typical depth, entry type and difficulty come later.

## Considered options
- **ODbL:**
  - Also build an export of the OSM-derived table, so a public instance can meet share-alike. Deferred: most
    instances are private.
  - Turn OSM off unless the operator enables it with a setting. Rejected: the explanation and the tick do the
    job, and the operator is the admin on most instances.
- **Any User imports:** rejected (license obligations, shared data).
- **Synchronous import:** simpler, but Overpass can take a minute and proxies cut long requests.
- **Re-import per site** (any User edit freezes the whole site) or **never update:** simpler. Per field keeps
  imported positions and depths current where Users only fixed a name.
- **Matching by link only, or by distance alone:** links are rare (39 + 12). Distance alone merges neighbouring
  sites with different names.
- **Always creating new sites, or skipping near hand-made ones:** both leave work for later. Linking only by
  reference adds the ID without touching what Users wrote.
- **An "External IDs" section where Users add OSM/Wikidata IDs by hand:** more power than needed. A wrong OSM ID
  would pull foreign data into a hand-made site on the next import.
- **A depth range (from–to):** OSM rarely has a reliable minimum. One maximum is enough for now.

## Consequences
- The glossary's **Source** now also covers site data. **External ID**, **Attribution** and **Site import** are
  new terms. Revisions get the actor type `site_import`.
- Data imported from OSM makes the site table of an instance a derivative database under ODbL. The obligations
  fall on the operator, and are explained before every OSM import and in the operator docs.
- Imports use public services with fair-use limits. A run is one query per Source, which is far below them.
- Merging duplicate sites (ADR 0020, later) has to move external IDs and their last imported values to the kept site.
- An SSI Push (later) reads the SSI site ID from the external IDs.
