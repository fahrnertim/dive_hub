---
title: Oceanic+ (the app's UDDF logbook export)
summary: The Oceanic+ app (Apple Watch Ultra, Oceanic+ computers) exports its logbook as one UDDF 3.2.1 file - its generator, ids, sites named by their id, waypoints every 15 s, an offset written as -00:04 for UTC-4 - and how Dive Hub reads it; from one public, sanitised sample and the owner's own export (2026-11-04).
status: living
date: 2026-11-04
url: https://www.oceanicworldwide.com/oceanic-plus/
---

# Oceanic+ (the app's UDDF logbook export)

## What it is
Oceanic+ is Huish's dive app for the Apple Watch Ultra and Oceanic+ dive computers. Since Oceanic+ 2.0 it exports the
whole logbook as **one UDDF file**, sent by email as a zip ([research](../research/2026-11-03-oceanic-plus-uddf.md)).
The menu path in the app is a best guess (*Logbook → Share/Export (UDDF)*), shown on the import page until the owner
confirms it. There is no public API; a cloud API is
later work and needs reverse engineering ([backlog 0018](../backlog/0018-oceanic-plus-import.md)).

## The file, as read from the one public sample
Source: the Submersion project's test file
[`issue_279_oceanic_plus_export.uddf`](https://github.com/submersion-app/submersion/blob/main/test/dives/issue_279_oceanic_plus_export.uddf)
(GPL-3.0; read, not copied: our fixture is hand-made in its shape). Its maintainer
[sanitised it](https://github.com/submersion-app/submersion/pull/1458): site coordinates rounded to 0.1°, dates moved
back eight years; samples and structure unchanged.

- `<uddf version="3.2.1" xmlns="http://www.streit.cc/uddf/3.2/">`; the generator has **no name**, only
  `manufacturer/contact/homepage` (`https://www.oceanicworldwide.com/it/oceanic-plus/`) and `version` `0.0.1`.
- Ids are `site_`, `dive_`, `tank_`, `repetition_group_` plus **24 hex digits** (they look like database ids; one
  dive's site, tank and group share its digits). A site's `name` and `location` are its id, not a place name.
- Sites have `latitude`, `longitude`, `altitude` (odd values: −10 m to 380 m); presumably the GPS fix of the dive.
- One mix `air` (0.21/0.79). Each dive has one `tankdata` linking `air`, without volume or pressures.
- `informationbeforedive`: the site `link`, `datetime`, `altitude`. **The offset is written in the minutes' place**:
  `2017-01-26T11:15:52.000-00:04`. Every offset in the file fits the sites' zones as hours (Puerto Rico in January
  −4, Florida Keys in February −5, Pennsylvania in October −4 with daylight saving), none as minutes.
- `samples/waypoint`: `depth` (m), `divetime` (s, written `15.0`), `temperature` (K) every 15 s; the first waypoint
  has `switchmix ref="air"` and `divemode type="opencircuit"` and no temperature. The waypoints run past
  `diveduration` (3285 s against 3034 s in one dive).
- `informationafterdive`: `lowesttemperature`, `greatestdepth`, `diveduration`, `equipmentused` (lead 0, the tank
  link), sometimes `rating/ratingvalue`.
- Not seen: heart rate, tank pressure, deco, ppO2, gas switches, the computer's name or serial number, exit
  positions, surface intervals.

## The owner's export (probed 2026-11-04)
Kept in `samples/private/oceanic-plus/` only (gitignored, never committed). The anonymised fixture
`apps/web/e2e/fixtures/oceanic-plus.uddf` (and `.zip`) keeps four of its dives ([samples/README.md](../../samples/README.md)).

- **A zip** with one entry `exports/<account id>-<export epoch>.uddf` (550 kB): the whole logbook, 18 dives, each in its
  own repetition group. It is uploaded as it is; `exports/` is walked like any folder in a zip (ADR 0044's limits).
- **Ids** are 24-hex database ids whose first 4 bytes are a creation time just after the dive, so they stay the same
  across exports; `oceanicplus:<id>` is the key.
- **Sites** are named by their id (`site_<24 hex>`) in all 18 dives, never by a place. Only their position is read.
- **The offset quirk holds** on the unsanitised file: `+00:02` on all 18 dives, whose places and seasons were all at
  UTC+2 (checked against each place's zone and daylight saving at the dive's date).
- **14 open-circuit dives and 4 breath-hold sessions** (`divemode type="apnoe"`). A session has two made-up waypoints
  (0 m at the start, the deepest point at about half the duration) and no gas or temperature samples.
- **Mixes:** `air` and one `nitrox_<dive id>` per nitrox dive (31 %, 32 %), linked from the dive's `tankdata`.
- **Gas switches:** each scuba dive has one `switchmix`, at `divetime` 0: the starting gas, no switch. None mid-dive.
- **Tank pressure:** one dive has 220 bar at the start and the end, the app's default and no reading. No waypoint has
  a pressure.
- `notes/para` (user text) on 4 dives; `rating/ratingvalue` 0 on most; `leadquantity` 0, 6 or 10 kg.
- Waypoints every 15 s, running past or short of `diveduration`; the duration is `diveduration`.

## How Dive Hub reads it
The UDDF adapter (`apps/server/src/imports/formats/uddf/`, ADR 0003's lenient reader) reads any UDDF; the Oceanic+
dialect is recognised by the generator's homepage or name containing "oceanic".
- **Key** `oceanicplus:<24 hex>` from the dive's id, so a later export of the same logbook changes nothing; other
  UDDF dives are keyed `uddf:<start second>:<duration>:<max depth cm>` (UDDF ids hold only within one file).
- **Time:** an offset `±00:MM` with MM 1-14 is read as `±MM:00` (no zone is a few minutes off UTC); the source is
  `device`.
- **No Device:** the file doesn't name the computer (Apple Watch or Oceanic+ computer), so the Recording has none.
- **Position:** the linked site's coordinates are the entry position, so site matching works as for a FIT file.
- **Gases:** each `tankdata`'s linked mix. Pressures that are the same at the start and the end are dropped (a default,
  not a reading, which would make the gas use 0). A dive without `tankdata` (a breath-hold session) has no gas, not air.
- **Profile:** none for fewer than 3 waypoints (a breath-hold session's two are made up); duration, depth and the
  lowest temperature still come from `informationafterdive`. The mix a dive starts on is no gas switch.
- **Kept as extras:** the generator (`Oceanic+ 0.0.1`), the notes, the rating and the lead (`leadKg`) when above 0
  (0 is the app's default). Notes moving into the Dive's own notes is a follow-up (backlog 0018).
- **XML reader of our own** (`xml.ts`), not a library: UDDF needs only elements, attributes and text, and the
  libraries bring several dependencies. It refuses a document type, so nothing expands entities or loads outside
  files; it decodes only the five predefined entities and character references. Limits: 32 MB per file, 1,000,000
  elements, nesting 64 deep, an attribute value under about 4,000 characters; tank pressures only of the dive's own
  tanks (without tank data, the first 8 named).

## Still open
- The menu path in the app (the import page shows a best guess; the owner confirms it).
- Whether the offset is the zone at the dive or the phone's: every dive so far was at +2, so the two can't be told apart.
- What other users' files add: heart rate, tank pressures, mid-dive gas switches, entry and exit GPS, a site with a
  real name. The owner's file has none of them.
