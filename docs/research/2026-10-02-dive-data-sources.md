---
title: Dive data sources and targets
summary: How data can be obtained from Garmin and Suunto, how it could reach SSI/PADI, and the formats involved.
status: done
date: 2026-10-02
---

# Dive data sources and targets

Markers: **[V]** checked against the primary source; **[S]** secondary source; **[?]** not verified.

## Summary

| | Official API for us? | Realistic path for a self-hosted hub |
|---|---|---|
| **Garmin** | Business-only; new applications **paused** since ~2026-03/04 [S] | User-supplied FIT files (upload, watched folder, USB/MTP) |
| **Suunto** | Partner program, organizations only [V] | User-supplied FIT (+ JSON) export; direct download via libdivecomputer for some models |
| **SSI** (target) | No public API found [?] | QR-code payload (summary only), or unofficial login automation |
| **PADI** (target) | No public logbook API [V] | Browser-form automation only |

Consequences for Dive Hub:
- **File ingestion is the baseline** for every source. Cloud APIs are a later, optional extra.
- **Pushing to SSI or PADI is best-effort.** No supported API exists today.

## Garmin (Descent)

- **Format:** native FIT with dive messages: `dive_settings`, `dive_gas`, `dive_alarm`,
  `dive_summary`, `tank_update`, `tank_summary`, `record` fields (depth, NDL, TTS,
  CNS, N2, SAC, RMV, ascent rate, PO2) and `dive_alert` events [V][fit-profile].
- **Export:** per-dive "Export Original" (FIT in a zip) [S][garmin-export]; full account
  export as a zip of FIT files [S][gneta]; Descent watches mount as USB/MTP storage.
- **Subsurface:** reads Garmin directly, via **Subsurface's libdivecomputer fork** (not
  upstream) [V][ss-libdc].
- **Developer Program:** Activity API delivers FIT/GPX/TCX; business use only [V][garmin-faq].
  New applications paused, no timeline [S][5krunner]. Whether dive activities are
  delivered is unknown [?].
- **SSI:** SSI reports Garmin switched off dive data access for partners [S][garmin-ssi].
- **Unofficial access:** `garth` was deprecated on 2026-03-27 after Garmin changed its
  auth flow [V][garth]. Treat scraping as fragile and against the terms of service.

## Suunto

- **Suunto app exports** FIT/GPX [V][suunto-export], plus JSON (Subsurface manual).
  The JSON lacks the gas mix, so it has to be paired with the same dive's FIT [V][ss-manual].
- **FIT quirks:** dive data comes as standard messages plus Suunto developer fields (`dive_mode`)
  [V][suunto-fit]. There's no `dive_summary` or `tank_*`, some fields are duplicated, and
  GPS is encoded differently from Garmin's [S][divejson-fit].
- **Cloud API (API Zone):** organizations only; OAuth; FIT delivery; webhooks [V][suunto-api].
- **Direct download:** libdivecomputer supports EON Steel / D5 over USB HID and BLE [V][ss-libdc];
  Ocean/Nautic support [?].
- **Legacy DM5 formats:** SDE, XML, SML, DL7 [V][suunto-dm5].
- **Syncing to SSI** is "not possible" according to Suunto [S][suunto-ssi].

## SSI (MySSI)

- **No public API, and no UDDF or FIT import** found [?].
- **Native sync** comes only from partner computer brands (Mares, Shearwater, Suunto app,
  Aqualung, Scubapro) [S][ssi-news].
- **QR-code payload** (reverse-engineered): about 500 bytes,
  `dive;noid;dive_type:0;datetime:…;divetime:53;depth_m:18;site:3314;…`. It uses SSI
  database IDs for site and conditions, and carries summary only, no profile [S][ssi-qr], [S][takken].
- **Third-party apps** (FitDive, DiveDrop) log in as the user. Dives arrive as "unconfirmed" [V][fitdive].

## PADI

- No public logbook API; the only automation found drives web forms [V][padi-sync].

## Formats worth supporting

| Format | Role for Dive Hub |
|---|---|
| Garmin FIT | Primary inbound format (Garmin, Suunto) |
| Suunto app JSON | Supplements FIT for Suunto |
| UDDF | Import/export with other logbooks; lenient reader ([gap analysis](2026-10-02-uddf-gap-analysis.md)) |
| Subsurface XML / git | Import from the largest open-source logbook; no XSD, the code is the spec [V][ss-core] |
| DAN DL7 | Possible later (Shearwater, DM5 export it) [S] |
| libdivecomputer | Direct dive-computer download (future app); its model is a good minimum for samples [V][libdc] |
| DiveJSON | Watch: new draft spec (2026-08); mapping docs useful as reference [V][divejson] |

## Related projects

- [divetracx][divetracx]: MIT, self-hosted, imports Garmin FIT, Subsurface and DiveMate,
  exports UDDF. The closest existing project to Dive Hub [V].
- [OpenDiving][opendiving]: self-hostable FastAPI/Postgres dive log; reference
  implementation of DiveJSON [S].
- [Submersion][submersion]: GPL-3 dive log app with broad import support (FIT, UDDF,
  Subsurface, DL7, CSV) [V].
- [Subsurface][subsurface]: GPL-2 desktop/mobile logbook, very active [V].

[fit-profile]: https://github.com/garmin/fit-javascript-sdk/blob/main/src/profile.js
[garmin-export]: https://forums.garmin.com/outdoor-recreation/outdoor-recreation-archive/f/descent-mk1/140389/export-tcx-file-of-diving-activity-from-garmin-connect
[gneta]: https://www.gneta.app/blog/export-garmin-data-guide
[ss-libdc]: https://github.com/subsurface/libdc/blob/Subsurface-DS9/src/descriptor.c
[garmin-faq]: https://developer.garmin.com/gc-developer-program/program-faq/
[5krunner]: https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/
[garmin-ssi]: https://forums.garmin.com/outdoor-recreation/outdoor-recreation/f/descent-mk2-mk2i/337533/import-dives-in-ssi-app-qr-code-or-ssi-beta-access
[garth]: https://github.com/matin/garth/discussions/222
[suunto-export]: https://www.suunto.com/Support/faq-articles/suunto-app/what-type-of-files-can-i-export-from-the-suunto-app/
[ss-manual]: https://subsurface-divelog.org/subsurface-user-manual/
[suunto-fit]: https://apizone.suunto.com/fit-description
[divejson-fit]: https://github.com/divejson/divejson/blob/main/docs/fit-mapping.md
[suunto-api]: https://apizone.suunto.com/faq
[suunto-dm5]: https://www.suunto.com/Support/faq-articles/dm5/how-do-i-import--export-dive-logs-to-dm5/
[suunto-ssi]: https://forum.suunto.com/topic/14507/ability-to-sync-dive-to-ssi-app
[ssi-news]: https://www.thescubanews.com/2026/08/21/ssi-reimagines-myssi-app-ai-dive-wizard/
[ssi-qr]: https://groups.google.com/g/subsurface-divelog/c/VFrNahh8UAc
[takken]: https://takken.io/tools/garmin-to-ssi-dive-log-helper
[fitdive]: https://fitdive.app/
[padi-sync]: https://github.com/obartra/padi-sync
[ss-core]: https://github.com/subsurface/subsurface/tree/master/core
[libdc]: https://github.com/libdivecomputer/libdivecomputer/blob/master/include/libdivecomputer/parser.h
[divejson]: https://github.com/divejson/divejson
[divetracx]: https://github.com/michidk/divetracx
[opendiving]: https://github.com/opendiving/opendiving-api
[submersion]: https://github.com/submersion-app/submersion
[subsurface]: https://github.com/subsurface/subsurface
