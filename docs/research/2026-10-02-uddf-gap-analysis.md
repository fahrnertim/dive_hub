---
title: UDDF gap analysis
summary: What UDDF 3.2.3 covers, where it falls short for a multi-user, multi-source dive hub, and how to use it.
status: done
date: 2026-10-02
---

# UDDF gap analysis

## Question

Can the Universal Dive Data Format (UDDF) define the data scope of Dive Hub, and
what gaps does it have for a self-hosted, multi-user hub that ingests from several
sources and forwards to services like SSI?

## Method

The official XML schema [`uddf_3.2.3.xsd`][xsd] (1,890 lines) was read in full and
compared against Dive Hub's requirements ([spec](../spec/README.md)). Ecosystem
facts are in the [Ecosystem](#ecosystem-and-adoption) section with their sources.

## UDDF at a glance

- XML format for exchanging dive data between programs ([intro][intro]).
- Latest version **3.2.3**, schema last changed **2018-11-14** (only change: `<heartrate>`
  per sample). 3.2.2 (2017) added `<pulserate>`, `<bodytemperature>`, `<certificatenumber>`,
  `<setmarker>`. Every entry in the schema's change log (2015–2018) is by a single author (Kai Schröder).
- Units are fixed SI: metres, seconds, Kelvin, Pascal, cubic metres.
- References use XML `ID`/`IDREF`, so they only resolve within one file.

### Top-level sections and what they cover

| Section | Covers |
|---|---|
| `generator` | Software that wrote the file |
| `mediadata` | Audio / image (with EXIF-like data) / video, by file name |
| `maker` | Equipment manufacturers |
| `business` | Shops |
| `diver` | **One** `owner` + any number of `buddy`: personal data, address, contact, equipment, medical exams, certifications, dive permits, insurances |
| `divesite` | Dive bases (prices, guides, ratings) and sites (environment, geography, fauna/flora taxonomy, wrecks, caves, depth/visibility) |
| `divetrip` | Trips → trip parts with dates, accommodation or liveaboard (operator + vessel), related dives |
| `gasdefinitions` | Gas mixes (O2/N2/He/Ar/H2, MOD/maxPO2, EAD) |
| `decomodel` | Bühlmann/RGBM/VPM tissue parameters |
| `profiledata` | Repetition groups → dives: before-dive info, tank data, samples (waypoints), after-dive info |
| `tablegeneration` | Inputs for computing dive tables/plans |
| `divecomputercontrol` | Reading and configuring dive computers, raw binary dumps |

### What UDDF covers well

- Dive log basics: date/time, max/avg depth, duration, surface intervals,
  altitude and flying after diving, water/air temperature, visibility, current,
  workload, thermal comfort, problems, malfunctions, rating, notes.
- Sample profiles: depth, time, temperature, tank pressure (per tank), PO2
  (set/measured/calculated), CNS, OTU, deco stops, NDL, remaining bottom time,
  gradient factor, heading, heart rate, gas switches, dive mode (OC/CCR/SCR/apnea), alarms, markers.
- Technical diving: multi-gas, trimix, rebreathers with O2 sensors, deco models.
- Equipment inventory with purchase data and next service date.
- Certifications, medical exams, insurances, permits.
- Dive sites with rich environment and marine-life data; trips with liveaboards.
- Raw dive computer dumps (`dcdump`), useful for keeping the original data.

## Gaps

Severity for Dive Hub: **H** = blocks a core requirement, **M** = needs an extension, **L** = nice to have.

### A. Structural gaps (UDDF is a file format, not a system data model)

| # | Gap | Sev. |
|---|---|---|
| A1 | **Single owner per document.** `diver` has exactly one `owner`; buddies are embedded copies of personal data, not references to other users. No multi-user, roles or permissions. | H |
| A2 | **No stable global identifiers.** `xs:ID` is unique only within a file. No UUIDs or source IDs (Garmin activity ID, Suunto workout ID), so re-imports can't be deduplicated reliably. | H |
| A3 | **No provenance.** No record of which source or device a dive, sample or edit came from (only one `generator` per file). | H |
| A4 | **One profile per dive.** A dive has one `samples` block. The same dive recorded by two computers (e.g. Garmin plus Suunto backup) can't be stored side by side or merged with attribution. | H |
| A5 | **No change tracking.** No created/modified timestamps, versions or deletion markers, so incremental sync in either direction isn't possible. | H |
| A6 | **No sharing/broadcast state.** No record of which targets (SSI, …) a dive was pushed to, the remote IDs, or visibility (private/buddies/public). | H |
| A7 | **Closed extension mechanism.** `applicationdata` only allows five hard-coded vendors (decotrainer, hargikas, heinrichsweikamp, tausim, tautabu). Garmin- or Suunto-specific data has no valid place. | M |
| A8 | **Timezone ambiguity.** Dive `datetime` is `xs:dateTime` with an optional offset; timezone exists only on the site, as a float. | M |

### B. Content gaps

| # | Area | Gap | Sev. |
|---|---|---|---|
| B1 | Logbook validation | No signatures or stamps (buddy, instructor, dive center), which a digital logbook such as SSI's relies on. | H |
| B2 | Training | No courses, training dives or skills; only `purpose=learning/teaching` and a `student` marker on buddies. | M |
| B3 | Certifications | `level`/`organization` are free text: no agency or level catalog, card image, e-card reference or verification status; `notes` is commented out. | M |
| B4 | Membership | At most **one** `membership` per person (DAN, club, agency usually several). | M |
| B5 | Insurance | Only name and dates: no policy number, insurer contact or coverage. | L |
| B6 | Dive location | Dives have no own coordinates. No entry/exit GPS (recorded by e.g. Garmin Descent), and no GPS or underwater track per sample. | H |
| B7 | Dive roles | No per-dive roles (guide, instructor, student, buddy team), no dive center or operator per dive (only a generic `link`). | M |
| B8 | Computed metrics | No SAC/RMV, ascent rate, TTS, ceiling, surface GF or GF99 per sample or summary; CNS/OTU only per sample. | M |
| B9 | Conditions | No salt/fresh water per dive (only site density), surface conditions, waves or weather; `current` is a fixed scale. | L |
| B10 | Equipment | Fixed categories (no hood, SMB/reel, weight system, AI transmitter, undergarment); **tank has no working pressure**; tank material limited to alu/steel/carbon; no service history (only `nextservicedate`); `serviceinterval` has no unit; no firmware version for dive computers. | M |
| B11 | Equipment usage | Equipment per dive is a list of links; no per-dive configuration such as which transmitter sat on which tank, apart from `tankdata` links. | L |
| B12 | Freediving | Only `divemode=apnea`; no session concept (many short dives), disciplines or recovery. | L |
| B13 | Media | File name only; no URI/hash, no position in the dive (time offset), no geotag; images attach to dives only via generic links. | M |
| B14 | Dive sites | No external IDs (shared site databases), entry points, datum or polygon; fauna/flora forced into a fixed taxonomy. | L |
| B15 | Person data | Dated `sex` enum; `smoking` buckets; single `passport` string. | L |
| B16 | Gas logistics | No fill records (who filled, analysis result, date). | L |

### C. Quality issues in the schema itself

- `decomodel` uses `xs:all` with `buehlmann`, `rgbm` and `vpm` all required. A valid
  document must contain all three, which is very likely unintended.
- Enumeration value `"unknown "` (trailing space) in `site/environment`.
- `"apnoe"` and `"apnea"` are both allowed (backward-compatibility fix from 2017).
- Commented-out elements and German comments are left in the schema.
- The documentation says top-level sections must appear in a fixed order, but the
  schema uses `xs:all` (any order).

### D. Out of scope for Dive Hub (probably)

`tablegeneration` (dive tables/planning), `decomodel` tissue tables, and
`divecomputercontrol/setdcdata` (configuring dive computers). These may matter once
a direct dive-computer app exists.

## Ecosystem and adoption

Markers: **[V]** checked against the primary source; **[S]** secondary source
(forum, blog, third-party doc); **[?]** not verified.

### Maintenance

- Maintainers per the spec are Kai Schröder and Steffen Reith; there is no formal body
  or working group, and feedback goes by email [V][index].
- The schema zip/tgz download links on the intro page return 404, although the
  individual `.xsd` files still download [V].
- uddf.org serves a wrong, expired TLS certificate (expired 2025-07-01). Over plain HTTP it
  redirects to a static page that lists versions only up to 3.2.1 [V][uddf-org].
- SourceForge `uddf-xsd` was last updated in 2013 [V][sf].
- UDDO, an OWL ontology based on UDDF, is a one-person project and dormant since 2022 [V][uddo].
- **Verdict: frozen.**

### Who supports UDDF

| App / service | UDDF | Notes |
|---|---|---|
| Subsurface | import + export | Exporter writes `version="3.2.0"` [V][ss-xslt]; open bug: Shearwater UDDF imports only the first tank [V][ss-4360] |
| Shearwater Cloud | import + export | Many UDDF fixes in its release notes [V][sw-notes] |
| MacDive, DiveMate | import + export | [S] |
| Diving Log 6 | UDDF, UDCF, DL7 | [V][divinglog] |
| divelogs.de | import + export (3.2.1) | Also FIT import and a public REST API [V][divelogs] |
| Submersion (OSS) | import + export | Also FIT, Subsurface, DL7; uses libdivecomputer [V][submersion] |
| divetracx (OSS, self-hosted) | export 3.2.3 | Pulls Garmin FIT; concept close to Dive Hub [V][divetracx] |
| Garmin Connect / Dive | **none** | FIT export only [V][garmin-uddf] |
| Suunto app / DM5 | **none** | App: FIT/GPX/JSON; DM5: SDE/XML/SML/DL7 [V][suunto-dm5] |
| MySSI | **no file import found** | [?] |
| PADI app | **none found** | [V][padi-sync] |

### Dialect problems in practice
- Files in the wild use four different root forms: the 3.2 namespace, the 3.1
  namespace, no namespace, and uppercase `<UDDF>` (2.x) [S][divejson-uddf].
- The child order of `dive` changed between 3.2.1 and 3.2.2 without a namespace change,
  so a file valid under one is order-invalid under the other [S][divejson-uddf].
- Real exports fail XSD validation; Subsurface writes invalid IDs such as `mix(21/0)` [S][divejson-uddf].
- Round-trips reportedly lose trips, gear, weights and UTC offsets [S][divejson].

**Consequence:** a UDDF importer must be lenient: accept any namespace, ignore element order,
and not depend on validation.

### Richer alternatives (details in [dive data sources](2026-10-02-dive-data-sources.md))
- **Garmin FIT dive messages** cover several of the gaps above: SAC/RMV, ascent rates,
  CNS/N2/OTU start/end, TTS, tank pods, water type, GF settings, CCR setpoints [V][fit-profile].
- **libdivecomputer**'s parser model is the de-facto lowest common denominator for
  direct downloads, and it includes tank work pressure, salinity and location [V][libdc].
- **Subsurface** supports multiple dive computers per dive, weight systems and
  sensor-to-tank mapping (gaps A4, B10, B11) [V][ss-git].
- **DiveJSON**: a new (2026-08) JSON Schema draft with mappings to UDDF, FIT, Subsurface
  and Suunto. It has no adoption yet, but its mapping docs are valuable [V][divejson].

## Conclusion

UDDF is a good **checklist for scope** and a reasonable **import/export format**, but
it is **not suitable as Dive Hub's internal data model**. Gaps A1–A6 (multi-user,
identity, provenance, multiple profiles, change tracking, broadcast state) are
fundamental to a hub and can't be added without leaving the schema. The format is
frozen since 2018, and real-world files come in incompatible dialects. Garmin and
Suunto, our first sources, don't speak UDDF at all.

**Recommended approach** (to be confirmed as an ADR):
1. Own internal data model, with UDDF's entities as the baseline scope: person,
   equipment, certification, site, trip, gas, dive, sample, media. Sample and summary
   fields come from the union of libdivecomputer and FIT dive messages; structure
   (multiple computers per dive, cylinders, weights) borrows from Subsurface.
2. Add what the hub needs: users and permissions, global IDs, provenance per record,
   multiple profiles per dive, change tracking, sync state per target, signatures.
3. Map losslessly to UDDF where possible; keep each source's original raw data
   (FIT file, JSON, `dcdump`) alongside, so nothing is lost.
4. Support UDDF import/export as one adapter among others, not the core.

## Sources

- [UDDF 3.2.3 documentation][index]
- [UDDF 3.2.3 introduction][intro]
- [UDDF 3.2.3 XML schema][xsd] (schema page: [schema.html][schema-page])
- [General structure of a UDDF file][structure]

[index]: https://www.streit.cc/resources/UDDF/v3.2.3/en/index.html
[intro]: https://www.streit.cc/resources/UDDF/v3.2.3/en/introduction.html
[xsd]: https://www.streit.cc/resources/UDDF/v3.2.3/schema/uddf_3.2.3.xsd
[schema-page]: https://www.streit.cc/resources/UDDF/v3.2.3/en/schema.html
[structure]: https://www.streit.cc/resources/UDDF/v3.2.3/en/general_structure.html
[uddf-org]: https://wrobell.dcmod.org/uddf/
[sf]: https://sourceforge.net/projects/uddf-xsd/
[uddo]: https://gitlab.com/wrobell/uddo
[ss-xslt]: https://github.com/subsurface/subsurface/blob/master/xslt/uddf-export.xslt
[ss-4360]: https://github.com/subsurface/subsurface/issues/4360
[sw-notes]: https://downloads.shearwater.com/swc_release_notes/desktop_pdf/Shearwater-Cloud-Desktop-Release-Notes_2.12.1.pdf
[divinglog]: https://www.divinglog.com/english/tutorials/compatibility.php
[divelogs]: https://divelogs.org/news.php
[submersion]: https://github.com/submersion-app/submersion
[divetracx]: https://github.com/michidk/divetracx
[garmin-uddf]: https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/150966/uddf-import
[suunto-dm5]: https://www.suunto.com/Support/faq-articles/dm5/how-do-i-import--export-dive-logs-to-dm5/
[padi-sync]: https://github.com/obartra/padi-sync
[divejson]: https://github.com/divejson/divejson
[divejson-uddf]: https://github.com/divejson/divejson/blob/main/docs/uddf-mapping.md
[fit-profile]: https://github.com/garmin/fit-javascript-sdk/blob/main/src/profile.js
[libdc]: https://github.com/libdivecomputer/libdivecomputer/blob/master/include/libdivecomputer/parser.h
[ss-git]: https://github.com/subsurface/subsurface/blob/master/core/save-git.cpp
