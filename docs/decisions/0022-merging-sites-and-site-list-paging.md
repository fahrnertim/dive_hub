---
title: "ADR 0022: Merging duplicate Dive sites; paging the site list; a client contract"
summary: Any User merges a duplicate site into another (kept site wins, gaps filled, no undo, warned first); Dives and External IDs move, imports follow the merged site; the site page lists sites within 200 m to merge; the Dive sites list pages, sorts and filters like the logbook; docs/spec/clients.md lists what every client must do.
status: accepted
date: 2026-10-04
---

# ADR 0022: Merging duplicate Dive sites; paging the site list; a client contract

## Status
Accepted – 2026-10-04

## Context
ADR 0020 left merging duplicate sites for later and reserved `merged_into`. The Site import (ADR 0021) now
reports new sites close to existing ones but offers nothing to do about them, and a worldwide import
(~1,700 sites) overflows the Dive sites list, which stops at 500.

A native mobile client is planned. What a client must do (licenses, privacy, versions, error codes, units)
lives only in the web client's code so far.

The project owner decided the points below on 2026-10-04.

## Decision

### Merging
- **Any User merges** a site into another, like editing (ADR 0020). Fixing duplicates shouldn't need an admin,
  and both sites' histories record it.
- **The kept site wins, gaps are filled.** Its fields stay, and empty ones (position, country, body of water,
  description, maximum depth, SSI site ID) take the merged site's values. The dialog shows the result and
  warns before merging.
  - It says how many of the User's own Dives move.
  - If other Users have Dives there, it says that theirs move too, without counting them (ADR 0020 keeps
    who dives where private).
- **No undo.** A wrong merge is corrected by creating a site again.
- **What moves:**
  - **Dives** at the merged site move to the kept one. Each gets a Revision with the actor *system* and the
    cause `site-merge`, so a Dive's history never names the User who merged.
  - **External IDs** move to the kept site where it has none from that Source. So data used to fill gaps
    keeps its Attribution, and the next import merges against it per field. Where the kept site already has
    one from that Source, the merged site keeps it.
  - **Earlier merges** into the merged site are re-pointed to the kept one, so there are no chains.
- **The merged site:** `merged_into` is set, and it leaves every list, the nearby search and the picker.
  `GET /api/dive-sites/:id` still answers with `mergedInto`, so old links lead to the kept site. Editing,
  deleting or merging it again answers 404.
- **Both histories** get a Revision with the actor User and the cause `merge`. The kept site's names the
  merged site, the filled fields and the moved IDs. The merged site's names the kept site.
- **Versions:** the request names both sites' versions (409 `site_changed` otherwise). Merging a site into
  itself is refused (400 `invalid_input`).
- **Imports follow merges.** An incoming object whose External ID sits on a merged site is skipped and
  counted (`skippedMerged`), never re-created.
- **Finding duplicates:** the site page lists the other sites within 200 m, each with
  "Merge into this site". Import findings link to the new site's page, where that list is. There is no
  instance-wide duplicate scan.

### The Dive sites list
- `GET /api/dive-sites` returns `{ sites, total }` with `limit` (1–200, default 50) and `offset`, like the
  logbook (ADR 0017).
- **Sorting** by `sort` = `name` (default), `country` or `diveCount`, with `order`. Ties fall back to the
  name, then the id.
- **Filters:** `q` (name or body of water), `country`, and `mine=true` (only sites with the User's own Dives).
- **Nearby:** with `latitude`/`longitude` the order is by distance, as before.
- **The web client keeps the settings in the address** (`#/sites?q=…&country=…&mine=1&sort=…&order=…&page=…`).
  The 500-site cap and its hint are gone.

### Client contract
- `docs/spec/clients.md` lists what every client of the API must do: legal and privacy obligations first,
  then conventions. Each rule has its reason and ADR, and says where the web client does it.
- A slice that gives clients a new duty updates it in the same change (AGENTS.md).

## Considered options
- **Merging only by creator/admin, or admins only:** imported sites have no creator, so in practice only
  admins could merge. Revisions make every merge traceable.
- **Choosing per field:** more control, but a side-by-side form for a rare task. Users can edit the kept
  site afterwards.
- **Undo:** it would have to remember which Dives and IDs moved, and other edits since could conflict.
- **A duplicates page** scanning the instance: the nearby list where duplicates are seen is enough for now.
- **Moving all External IDs:** a site can hold one per Source. Dropping the second would make the next
  import create the duplicate again.

## Consequences
- `GET /api/dive-sites` changed shape (array → `{ sites, total }`). Our web client is the only client, so
  this is acceptable before 1.0.
- The `site_merged` state is visible in the API (`mergedInto`). Clients follow it.
- Other Users' Dives can change site without their action. Their history shows "Dive Hub" with the cause
  `site-merge`, and their open edit forms get `dive_changed`.
