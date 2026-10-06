---
title: "ADR 0030: Importing dives from a Provider (SSI first)"
summary: A Provider can import dives - SSI's logbook through its Connection (built in slice 15; amended - geo-tz's data is ODbL, "sent by Dive Hub" includes dives it sent values to, the computer choice is a Connection setting, sites are matched or made once an admin allowed it, changes made at the Provider come back). Trust is decided per dive by evidence (sent by Dive Hub, from a dive computer, typed by hand) and per computer by the User; dives from a computer become Recordings like FIT files, hand-typed ones fill Dives here or become Dives without a Recording; nothing changed here is overwritten (changes made only at the Provider come back, three-way, amended); matches are linked so sending updates instead of duplicating. A preview first, then an Import in the worker over one JSON Original per dive. Times without a zone get their offset from the position (geo-tz), else nearby dives, else stay unknown. Amends 0027, 0016.
status: accepted
date: 2026-10-06
---

# ADR 0030: Importing dives from a Provider (SSI first)

## Status
Accepted – 2026-10-06. Amended by [ADR 0031](0031-lead-suit-cylinders-and-lead-estimate.md) (planned: an import also
fills lead and the cylinder and takes them back three-way). Amends [ADR 0027](0027-providers-as-adapters.md) (dives get an `import` direction with `list`) and
[ADR 0016](0016-recording-decisions-and-divers.md) (a Recording that attaches to a Dive without one becomes its
primary). Designed in [Importing dives from SSI](../research/2026-10-06-ssi-import.md).

## Context
The owner's SSI logbook holds about 90 dives, typed by hand, with rounded times and depths. Another User may have synced
dives into SSI from a dive computer, which makes SSI as good a source as a FIT file. Dive Hub already reads the whole
logbook, profiles included, on every send. What SSI returns is in the [SSI reference](../references/ssi-app-api.md#a-dive-as-ssi-returns-it-checked-2026-10-06).

SSI keeps local wall-clock times without a time zone; Dive Hub keeps an instant and the offset at the dive. A dive made
from SSI with a wrong offset would no longer overlap its FIT file when that comes in.

The owner decided on 2026-10-06 (the design note's points 1–8 and the questions after them).

## Decision

### Trust
- **Per dive, by evidence in the Provider's record**, in this order:
  1. **Sent by Dive Hub** (our reference, or a Push already pointing at it): already ours, linked, never imported back.
  2. **From a dive computer** (a profile and a serial number; SSI's "imported" flag alone proves nothing, Dive Hub's
     uploads set it too): a **Recording**, like a FIT file.
  3. **Typed by hand:** a **logbook entry**.
- **Per computer, by the User:** the preview lists the computers found; for each, its dives are used as recordings or
  only as logbook entries. Default: recordings, unless Dive Hub has that Device from files already (the files are
  better; the Provider's 5 s copy only fills gaps). The choice is kept **on the Connection** (another User may have
  dives of the same, lent computer in their own logbook).

### What it may do (per Connection)
- **Import:** off, **only add to Dives here** (link and fill, never create), or **also create** Dives Dive Hub doesn't
  have.
- **Matching window** for logbook entries: 5, 15 (default), 30 or 60 minutes, compared in local time on the same day.

### Logbook entries
- **One Dive here in the window:** linked to the Provider's dive and **filled where it is empty**: site (only a site that
  already has that SSI site ID; SSI's site data has no licence, ADR 0024), Participants (buddy-list entries → Divers
  by SSI account), notes. Nothing is overwritten (amended below: changes made only at the Provider come back). Sending later updates that remote dive instead of making another.
- **Several:** the User decides in the preview (one of them, a new Dive, or leave it out); one that turns ambiguous
  after the preview is left out, with that reason in the outcome.
- **None:** with "also create", a **Dive without a Recording** with the entry's values, marked as from the Provider,
  linked as up to date.
- SSI's dive number is not taken (a topic of its own).

### Dives from a computer
- A **Recording** (parser `ssi-app-api`, key `ssi:<SSI dive ID>`) with the profile's depth, temperature and no-deco
  samples, its **Device by manufacturer and serial number** (created for the Connection's Diver if new). It is placed
  like a FIT Recording (create, attach, or a Duplicate candidate), then linked and filled like a logbook entry.
- **A file of the same computer wins:** when a file Recording attaches to a Dive whose primary is a Provider's copy, the
  file's becomes primary. A Recording attaching to a Dive without one becomes its primary (values follow).

### Time zones
`src/dives/time-zone.ts` turns a local time into an instant and records where its offset came from
(`dive.utc_offset_source`: `device`, `position`, `nearby`, `unknown`):
1. **Position:** the dive's own, else its site's at the Provider, through **geo-tz** (exact boundaries including
   territorial waters; ocean gets `Etc/GMT±n`; MIT; offline; lazy-loaded data). Summer time from the date (Node's
   `Intl`).
2. **Nearby dives:** the offset of the Diver's closest Dive within 7 days.
3. **Unknown:** the wall-clock time is kept as if it were UTC, the offset stays null, and matching compares such Dives
   by local time. The dive page says where the time zone came from when it isn't the computer.

### How it runs
- **Preview** (`GET /api/connections/{id}/dive-import`): reads the logbook (one paced action) and answers what would
  happen: computers with their dive counts and default; dives already linked, to link and fill, to create, to decide,
  from computers, deleted here. Nothing is stored.
- **Start** (`POST /api/connections/{id}/dive-import` with the computers' choices and the decisions): reads the logbook
  again (or its two-minute snapshot), stores **one Original per dive** (that dive's record as JSON; never the whole
  answer, which holds the buddy list's personal data), and creates an **Import** that the worker runs (ADR 0010) like an
  upload. Its context (buddy entry → SSI account, SSI site → name and position) is kept on the Import; no names of
  buddies. It can be run again: unchanged dives are skipped, linked ones only filled where still empty.
- A Dive deleted here stays deleted (ADR 0026).

### Adapter
`dives.import` declares `list`, and the adapter offers `dives.list(context)` (the raw records, the context) and
`dives.parse(record, context)` (a typed `ImportedDive`). No `odin_*` outside `providers/ssi/`.

## Amended while building (2026-10-06, slice 15)
- **geo-tz's data is ODbL, not MIT.** The code is MIT; its boundaries come from timezone-boundary-builder, built from
  OpenStreetMap, so they are under the Open Database License. The image ships them unchanged, which needs the
  attribution in `NOTICE` and the operator note in the [architecture](../spec/architecture.md#dive-site-imports-and-licenses);
  nothing derived from them is published. Checked 2026-10-06: 8.1.9 (pinned), 74 MB unpacked in three data products
  (the default, "alike since 1970", is the one used, right for dives in the past), lazy-loaded, a release about every
  two months, one maintainer; no network access.
- **Sent by Dive Hub** also covers a remote dive Dive Hub sent values to (a confirmed `create` or `update` Push), not
  only one with our reference. A `link` Push alone doesn't count: such a dive is linked and only filled.
- **A computer's dive imported before is placed again** (by its key `ssi:<id>`), so one changed at the Provider updates
  its Recording in place; unchanged (the same Original as an earlier Import) it is `unchanged`.
- **A computer dive linked as a logbook entry** (its computer wasn't recognised when it came in) becomes a Recording
  once it is, attached to its Dive (primary there when the Dive has none), unless that Dive has the computer's Recording
  already (its own file); only then is it left out of the computers listed. Found with SSI's older records
  (2026-10-06, SSI reference).
- **The preview reads afresh; the start may use the Provider's kept read** (`dives.list(context, { recent })`).
- **The choice per computer is a Connection setting** like the mode and the window (`PATCH /api/connections/{id}`), so
  the preview follows it; the start keeps the choices it is sent, and the Import keeps the ones it ran with.
- **Matching details:** a Dive that already has a remote dive at the Provider isn't a candidate (two entries never link to
  one Dive; the earlier, in local time, wins and the next is matched without it); a deleted Dive in the window, with no
  live one, keeps the entry out (`deleted_earlier`); Participants are filled only when the Dive has none, as buddies.
- **A computer another User's Diver keeps** brings its dives in as logbook entries (the research note's interim answer
  to lent computers), and the preview says so.
- **Offsets:** a file's Recording without an offset stays `device` (a true instant whose local time isn't known); only a
  wall-clock time kept as if UTC is `unknown`. The source follows the Primary recording like the start time; the dive
  page doesn't show it once the User set the start by hand. Clients show an `unknown` time in UTC without an offset.
- **Outcome and history:** an Import has `provider`; results gain `linked`, reasons `sent_by_dive_hub`, `no_match`,
  `ambiguous` and `left_out`; filling is the Revision cause `fill`; a Dive made from an entry has `from_provider`.

## Amended: the sites the dives name (owner, 2026-10-06, slice 15a)
Replaces "only a site that already has the SSI site ID is used" for a Dive that has no site yet:
- **A site here with that SSI ID** is used, as before.
- **Else the same site here by the Site import's rule** (`matchingSite`, shared with ADR 0021's import: within 100 m,
  the same name, no SSI ID yet) gets the SSI ID as a reference (Revision `link`). No SSI data is copied.
- **Else, if an admin allowed it, a new site** from the logbook's entry: name, position, country, water type (SSI's
  `bow`, salt or fresh, as in the SSI site import) and SSI's ID, marked
  "From SSI", the User as its creator (Revision `create`). SSI's site data still has no licence (ADR 0024), so it is the
  operator's decision: an admin confirms the same explanation as for an SSI site import, once per Provider
  (`provider_site_data`, `PUT /api/admin/provider-site-data/{provider}`), and can stop it again. Without it the Dive
  stays without a site, and the preview says an admin can allow it.
- The preview counts the sites the dives name: here already, matched, to create, missing. A linked dive is filled where
  still empty on every run (no longer skipped when its Original is unchanged), so allowing it later and running the
  import again gives the dives their sites.
- *Considered:* always creating (duplicates of hand-made and OpenStreetMap sites), only matching (dives in places Dive
  Hub doesn't know stay without a site), the User confirming per import (the risk is the operator's, as for the Site
  import), and running the admin's SSI site import for the IDs (SSI's whole list for a handful of sites).

## Amended: changes made at the Provider come back (owner, 2026-10-06, slice 15b)
Replaces "nothing here is overwritten" for dives linked to a Provider's dive. Found when the owner changed a dive's site
to a private one in SSI's app and the import, which only filled empty fields, couldn't bring it.
- **Three-way per field**, like the Site import's re-import (ADR 0021). The base is what the Provider had when Dive Hub
  last saw the dive: the newer of the Original an earlier finished Import brought and the payload of the last create or
  update Push (what Dive Hub sent). Compared as the Provider keeps values (minutes, a minute of duration, 0.1 for depths
  and temperatures):
  - unchanged at the Provider since the base: nothing;
  - changed there, not here: the Dive takes the Provider's value (Revision cause `update`, "Updated from its source");
  - changed in both, differently: a conflict, listed in the preview; the Dive keeps its value unless the User takes the
    Provider's. Kept, that import's Original becomes the base, so it isn't asked again until the Provider changes it again.
- **Fields:** the site (a new one found or made as in slice 15a; the Provider naming none never clears it), notes and
  buddies (Participants with an account at the Provider follow its list; the others stay) on every linked Dive; the start,
  duration, depths and water temperature only on a Dive without a Recording (a Recording's values are the computer's).
- **Also for dives Dive Hub sent** (base: what it sent): a change made in the Provider's app comes back, and a Dive that was
  up to date there stays so (a new `link` Push with its fingerprint). Without any base (linked by sending, never
  imported), the import only fills empty fields, as before.
- *Considered:* asking about every difference (rounding makes most of them noise), a "take from SSI" action per dive
  (no bulk), and the Provider winning for chosen fields (overwrites changes made here).

## Considered options
- **One trust switch per Connection:** one account can hold both kinds of dive.
- **The choice per computer on the Device:** a lent computer's Device belongs to another User's Diver.
- **Ambiguous entries in "Needs your decision":** that panel is about Recordings; an entry has none.
- **Creating Dive sites from SSI's site data:** no licence (ADR 0024); only sites already holding the SSI ID are used.
- **`@photostructure/tz-lookup`** (88 KB): 5–10 % wrong in inhabited places, worst on coasts and borders, where dive
  sites are. **Asking an online service:** sends positions out.
- **Reading the Provider in the worker:** the Originals stored at the start make the job the same as an upload's.

## Consequences
- The image grows by geo-tz's boundary data (~74 MB on disk); a time-zone rule change needs a library update.
- Dives can exist without a Recording; the dive page, lists and statistics handle that.
- A computer lent to another User of the instance stays a gap (design note, "holders over time").
