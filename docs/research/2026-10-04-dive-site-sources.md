---
title: Open data for preseeding Dive sites; external site IDs
summary: Which public dive site datasets could seed an instance (OSM, Wikidata, OpenDiveMap, others), their size and licenses, and what external IDs (SSI) need. Recommendation - optional import from OSM + Wikidata, no bundled data.
status: draft
date: 2026-10-04
---

# Open data for preseeding Dive sites; external site IDs

Question from the project owner (2026-10-04, after slice 7 / [ADR 0020](../decisions/0020-dive-sites.md)):
can we preseed Dive sites from public, open data, and does the model hold external site IDs, e.g. for SSI?

## External site IDs

- The [data model](../spec/data-model.md) has them: a Dive site carries **external IDs** (B14), and
  scenario 4 needs the **SSI site ID** for the QR payload (`site:3314`, see
  [dive data sources](2026-10-02-dive-data-sources.md)). The cross-cutting identity rule asks for
  `(source, external id)` unique per source.
- **Not built yet:** slice 7 left them out on purpose (ADR 0020: "external IDs come later").
- Shape when built: a table `dive_site_external_id (site_id, source, external_id)`, unique on
  `(source, external_id)`, several per site (SSI, OSM, Wikidata, …), changed with the site's version
  and Revisions. Seeding (below) would fill `osm`/`wikidata` IDs, so a second import updates instead of duplicating.
- **SSI's site IDs are not public.** No API or list was found; the IDs appear only in the QR payload, which
  was reverse-engineered by others. SSI's app scans a site's QR code to get its data. So an SSI ID would be
  entered by hand per site (or read from a scanned SSI site QR code), not seeded.

## Datasets

Counts checked 2026-10-04 (taginfo API, Wikidata SPARQL).

| Source | Size | License | Notes |
|---|---|---|---|
| **OpenStreetMap**, `sport=scuba_diving` + `scuba_diving:divespot=yes` | 1,401 dive spots (of 4,694 objects with `sport=scuba_diving`, the rest mostly dive shops) | ODbL 1.0 | Best maintained; tags for depth, max depth, entry (shore/boat), hazards. Strong in Central Europe (lakes, quarries), thin on reefs. Query by Overpass API; stable IDs (`node/123`). |
| **Wikidata**, instances of *recreational dive site* (Q2141554) | 345, 313 with coordinates | CC0 | Small but free of conditions; multilingual names; links to Wikipedia and often to OSM. Wrecks are other classes (many more, but not all dived). |
| **OpenDiveMap** (opendivemap.com) | 3,123 sites, 59 countries | ODbL (stated) | GeoJSON download. Provenance not stated; its GitHub organization has no public repositories. Not usable until we know where the data comes from. |
| **dive-vibe-community** (GitHub, jbunderwater) | ~2,800 sites | not stated ("for community use") | Built with AI agents from OSM plus web research; divers on ScubaBoard found wrong facts in descriptions. Reject: unclear license, unreliable. |
| **Wannadive.net** | large community atlas | unclear (some derived datasets say CC BY 3.0) | No documented export or license for the whole database. Don't scrape. |
| PickADive (pickadive.com) | aggregator | per source (OSM, Wikidata, NOAA, GBIF) | Shows the same approach: OSM + Wikidata with kept provenance. |

## What the licenses mean for us

- **CC0 (Wikidata):** no conditions.
- **ODbL (OSM):** attribution ("© OpenStreetMap contributors"), and if a *derivative database* is publicly
  used, it must be offered under ODbL too. A Dive Hub instance mixing OSM sites with Users' own sites is
  arguably a derivative database; most instances are private (family, club), which is not "public use",
  but a public instance would have to offer the site table under ODbL. Users' own dive data is not
  part of it (OSM's guidance: a "produced work" or separate database).
- **Our code stays Apache-2.0**: we'd ship an importer, not the data. Each operator imports, so the license
  obligations are theirs and visible at import time.

## Recommendation

1. **No data bundled in the image** (license mixing, size, stale snapshots).
2. **An admin-only "Import dive sites" action** with two sources: Wikidata (CC0) and OSM (ODbL, with the
   attribution shown on site pages and the obligation explained before import), by country or bounding box.
3. Imported sites keep their **external IDs** (`wikidata:Q…`, `osm:node/…`) and a source attribution; a
   re-import updates sites still unchanged in the hub and leaves edited ones alone (the same 3-way idea as
   for Recordings). Duplicates between OSM and Wikidata are matched by the Wikidata link on OSM objects, then by distance.
4. **SSI IDs** stay a manual field per site, needed only when Pushes to SSI are built.
5. **Show where a site comes from.** Today a site stores only `created_by` (not shown to other Users,
   ADR 0020) and its Revisions; nothing says "from OpenStreetMap". With the import, a site's **Source**
   (glossary term, as for dive data) is its external-ID rows: `osm`, `wikidata`, `ssi`. License, attribution
   text and link pattern belong to the Source, defined once in code (like problem codes), not stored per site.
   No rows means the site was made in this instance. The site page shows "From OpenStreetMap" with a link
   to the object (ODbL requires the attribution); the history shows the import that created or updated it.
   Decided with the owner on 2026-10-04 to build this with the import slice, not before.

## Follow-up while building the import (2026-10-04)

All 1,401 OSM dive spots (Overpass) and all 345 Wikidata items were compared:
- **Cross-links: none in practice.** The 37 OSM `wikidata=` tags name reefs and wrecks that Wikidata doesn't class
  as dive sites. Wikidata's 12 OSM IDs name objects without `scuba_diving:divespot=yes`.
- **Distance:** 6 Wikidata items lie within 1 km of an OSM dive spot. One (Vortex Spring, 96 m) has the same name.
- **Where:** 302 of the Wikidata items are in South Africa, 17 in Egypt, and none in Malta or Austria. OSM's
  Egyptian dive spots are on the mainland coast and the Tiran area, not near Wikidata's (27–96 km).
- **Names:** 88 OSM dive spots have no name. One Wikidata item's English label is "P31" (vandalism or a mistake).
- **Depth:** `scuba_diving:maxdepth` is mostly a plain number ("30", "30m", "30 m", "30 metres"; rarely ">30" or
  "-40M"). `scuba_diving:depth` is the *typical* depth, sometimes several values separated by ";" (OSM wiki).
- **Overpass under load** answered once with an HTML page ("Dispatcher_Client … timeout") instead of JSON. A
  retry after half a minute worked.

Decisions: [ADR 0021](../decisions/0021-site-external-ids-and-import.md).

## Sources

- OSM wiki: [Tag:sport=scuba_diving](https://wiki.openstreetmap.org/wiki/Tag:sport=scuba_diving),
  [Key:scuba_diving:divespot](https://wiki.openstreetmap.org/wiki/Key:scuba_diving:divespot); counts from
  [taginfo](https://taginfo.openstreetmap.org/) API.
- [Open Database License](https://en.wikipedia.org/wiki/Open_Database_License); [OSM and Wikidata](https://wiki.openstreetmap.org/wiki/Wikidata).
- Wikidata: [recreational dive site (Q2141554)](https://www.wikidata.org/wiki/Q2141554), counted with the Wikidata Query Service.
- [OpenDiveMap](https://opendivemap.com/), [its GitHub organization](https://github.com/opendivemap).
- [ScubaBoard: "I open-sourced a database of 2,800+ dive sites"](https://scubaboard.com/community/threads/i-open-sourced-a-database-of-2-800-dive-sites-across-122-destinations-free-for-everyone.667171/).
- [PickADive](https://pickadive.com/) (sources and licenses on its site).
- [SSI: new MySSI app features](https://www.divessi.com/en/blog/new-myssi-app-features-1077) (dive site QR codes);
  QR payload: [dive data sources](2026-10-02-dive-data-sources.md).
