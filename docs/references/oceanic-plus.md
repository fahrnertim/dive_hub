---
title: Oceanic+ (the app's UDDF logbook export)
summary: The Oceanic+ app (Apple Watch Ultra, Oceanic+ computers) exports its logbook as one UDDF 3.2.1 file - its generator, ids, sites named by their id, waypoints every 15 s, an offset written as -00:04 for UTC-4 - and how Dive Hub reads it; from one public, sanitised sample, not yet from the owner's files.
status: living
date: 2026-11-03
url: https://www.oceanicworldwide.com/oceanic-plus/
---

# Oceanic+ (the app's UDDF logbook export)

## What it is
Oceanic+ is Huish's dive app for the Apple Watch Ultra and Oceanic+ dive computers. Since Oceanic+ 2.0 it exports the
whole logbook as **one UDDF file**, sent by email ([research](../research/2026-11-03-oceanic-plus-uddf.md)). The menu
path in the app and the file ending are not yet confirmed (`.uddf` assumed). There is no public API; a cloud API is
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

## How Dive Hub reads it
The UDDF adapter (`apps/server/src/imports/formats/uddf/`, ADR 0003's lenient reader) reads any UDDF; the Oceanic+
dialect is recognised by the generator's homepage or name containing "oceanic".
- **Key** `oceanicplus:<24 hex>` from the dive's id, so a later export of the same logbook changes nothing; other
  UDDF dives are keyed `uddf:<start second>:<duration>:<max depth cm>` (UDDF ids hold only within one file).
- **Time:** an offset `±00:MM` with MM 1-14 is read as `±MM:00` (no zone is a few minutes off UTC); the source is
  `device`.
- **No Device:** the file doesn't name the computer (Apple Watch or Oceanic+ computer), so the Recording has none.
- **Position:** the linked site's coordinates are the entry position, so site matching works as for a FIT file.
- **Kept as extras:** the rating and the generator (`Oceanic+ 0.0.1`).
- **XML reader of our own** (`xml.ts`), not a library: UDDF needs only elements, attributes and text, and the
  libraries bring several dependencies. It refuses a document type, so nothing expands entities or loads outside
  files; it decodes only the five predefined entities and character references. Limits: 32 MB per file, 1,000,000
  elements, nesting 64 deep, an attribute value under about 4,000 characters; tank pressures only of the dive's own
  tanks (without tank data, the first 8 named).

## Open until the owner's files arrive
- Is the offset quirk in an unsanitised file too? Do real files carry the hours there?
- File ending, one file per logbook or per selection, and whether ids stay the same across exports.
- What an Apple Watch Ultra adds: heart rate, more tanks, gas switches, entry and exit GPS.
- Does a site ever carry a real name?
