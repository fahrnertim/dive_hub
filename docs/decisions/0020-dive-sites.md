---
title: "ADR 0020: Dive sites shared by all Users, positions without PostGIS, no map yet"
summary: Dive sites are instance-wide; any User edits them (optimistic locking, Revisions), the creator or an admin deletes unused ones; Recordings keep entry/exit positions as plain latitude/longitude; an imported dive is linked to the only site within 200 m; no map, an "open in maps" link instead; merging later.
status: accepted
date: 2026-10-04
---

# ADR 0020: Dive sites shared by all Users, positions without PostGIS, no map yet

## Status
Accepted – 2026-10-04

## Context
The [data model](../spec/data-model.md) puts Dive sites in the instance tier: shared by every User,
unlike everything built so far, which belongs to one User or one Diver. Garmin FIT files carry the
dive's position (the Mk3 sample has an exit position, `session.end_position_*`, in degrees after
parsing; other files also have `start_position_*`), but the import kept only a flag that it existed.
UDDF export and SSI Pushes (scenario 4) both need a Dive's site.

The project owner chose on 2026-10-04 (slice 7): any User edits a site and only its creator or an
admin deletes it; no map for now; auto-link on import when exactly one site is close; no PostGIS;
merging duplicate sites later; a site's position is visible to all Users, a Dive's own position is not.

## Decision
- **Dive site** (`dive_site`): name, optional position (latitude/longitude, WGS84, both or neither),
  country (ISO 3166-1 alpha-2, shown in the UI language through `Intl.DisplayNames`), body of water
  (free text, e.g. "Red Sea"), description, creator, `merged_into` (unused until merging is built),
  `version` for optimistic locking, soft delete. Aliases, entry points, external IDs and depth ranges
  come later.
- **Who may do what:** every signed-in User sees and uses every site, creates sites and **edits any
  site**. An edit names the version it started from (409 `site_changed` otherwise, as with Dives) and
  writes a Revision (entity `dive_site`), so changes are traceable. **Deleting** is for the site's
  creator or an admin, and only while no Dive (of any User) is at the site (409 `site_in_use`).
  Users never see who created a site or which other Users dive there; the API says only whether the
  signed-in User may delete it.
- **Positions:** a Recording keeps its **entry and exit position** (`entry_latitude`, …, `exit_longitude`,
  double precision) from the Device. A Dive's position is its Primary recording's (exit, else entry); it is
  not an Override for now. Positions stay private like the rest of the Dive. Creating a site from a Dive's position
  copies the position into the shared site, and the form says that every User will see it.
- **No PostGIS.** Plain columns, a B-tree index on (latitude, longitude), "nearby" as a bounding box
  plus the haversine distance in SQL. An instance holds hundreds of sites, not millions. The stock
  `postgres:18-alpine` image stays: `postgis/postgis` publishes no arm64 image for PostgreSQL 18
  (checked 2026-10-04), and the multi-arch alternatives are one person's account or our own image to maintain.
- **Auto-link on import:** when an Import creates a Dive whose Recording has a position and **exactly
  one** site lies within **200 m**, the Dive is linked to it (Revision, actor Import, cause `auto-site`).
  With several or none, nothing is linked; the dive page lists sites within 2 km to pick from.
  Attaching a Recording to an existing Dive never changes its site.
- **A Dive's site is the Dive's own value** (like notes), set in `PATCH /api/dives/:id` with `siteId`
  under the Dive's version. Its Revision records the site's id and name at that time, so the history
  stays readable after a site is renamed.
- **No map yet.** Positions show as coordinates ("27.2345° N, 33.8412° E") with an "Open in maps" link
  to openstreetmap.org (a plain link: the page itself sends nothing anywhere). A map with tiles needs its
  own ADR (tile source, privacy, Content Security Policy).
- **Backfill:** Recordings imported before this slice get their positions by re-reading their Originals
  once, in the background after start.
- **Merging** duplicate sites comes later; `merged_into` is there for it.

## Considered options
- **PostGIS** (`geography(Point)`, GiST index): the right tool at scale; rejected for the image and
  arm64 reasons above. If we need polygons, routes or heavy spatial queries, a new ADR revisits it.
- **Only the creator (or admins) edits:** safer against vandalism, but on a family or club instance
  fixing a typo shouldn't need someone else. Revisions make every edit traceable.
- **Only suggest, never auto-link:** more clicks for every dive at a known site. A wrong link is
  one change on the dive page, and its Revision says the Import did it.
- **Rounding shared positions:** declined; the site position is meant to be shared.

## Consequences
- The first shared, editable entity: Operators (and later shared catalogs) follow the same rules:
  everyone edits with version checks and Revisions, the creator or an admin deletes when unused.
- Revisions now exist for entities without an owning Diver; a site's history is readable by every User.
- Deleting a User keeps the sites they created (`created_by` becomes null); only admins can delete those.
- Positions from new Sources (Suunto, UDDF) go into the same Recording columns.
