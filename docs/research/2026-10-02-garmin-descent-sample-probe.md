---
title: Garmin Descent Mk3 sample file probe
summary: What a real Descent Mk3 dive FIT file contains, how the USB and Export Original copies compare, and how the official SDK and fit-file-parser read it.
status: done
date: 2026-10-02
---

# Garmin Descent Mk3 sample file probe

## Question

Does a real Garmin Descent FIT file match what the [FIT parsing research](2026-10-02-fit-parsing-libraries.md)
and the [data model](../spec/data-model.md) assume, and is `fit-file-parser` (MIT,
[ADR 0006](../decisions/0006-license-apache-2-and-fit-parser.md)) good enough?

## Method

One real dive, provided by the project owner in two copies (kept in git-ignored
`samples/private/`, see [samples](../../samples/README.md)):
- **USB:** copied from the watch's `GARMIN/Activity/` folder.
- **Export Original:** zip downloaded from Garmin Connect web, containing `<activityId>_ACTIVITY.fit`.

Both were compared byte by byte, then decoded with `@garmin/fitsdk` 21.217.0 (with unknown
data included) and `fit-file-parser` 6.1.2, on Node 22. Probe scripts lived outside the repo.
GPS values, serial numbers and the dive date are deliberately left out of this note.

The dive: Descent Mk3 (product 4222, firmware 27.19), single gas (air), fresh water,
about 74 min, max depth about 8 m. No tank transmitter, no developer fields.

## Findings

### USB copy = Export Original
- Same size and **same SHA-256**. The zip is only a wrapper. So an Original uploaded twice
  (once from the watch, once from Garmin Connect) is recognised by its hash.
  This is one file from one model; other models or firmware may differ.

### What the file contains
| Area | Found | Data model target |
|---|---|---|
| `file_id` | manufacturer, product (`descentMk3`), serial, time created | Device, Recording key |
| `device_info` (10) | creator device with firmware; local sensors (barometer, wrist heart rate) | Device, firmware |
| `sport` | `diving` / `singleGasDiving`, profile name "Single-Gas" | dive mode |
| `dive_settings` | deco model `zhl16c`, GF 35/75, water type `fresh`, density 1000, PO2 limits, safety stop, CCR setpoints (unused) | Recording summary |
| `dive_gas` (1) | O2 21 %, He 0 %, open circuit | gas mix |
| `dive_alarm` (1) | depth alarm | Recording summary (optional) |
| `dive_summary` (2) | one for the **session** (dive number, avg/max depth, bottom time, surface interval, avg ascent rate, N2 and CNS start/end), one for the **lap** (subset) | Recording summary; use the session one |
| `session` | start time, elapsed time, avg/min/max temperature, heart rate, **end position** and bounding box; **no start position** in this file | Dive entry/exit position (both optional) |
| `activity` | `local_timestamp`, giving a **UTC+7** offset here | Dive local offset (A8) |
| `record` (3,171) | depth, absolute pressure, temperature, heart rate, PO2, ascent rate, N2 load, CNS load, next stop depth/time, time to surface, NDL (only 87 values) | Sample series |
| `event` (7) | timer start/stop, gas switch, dive alerts (with codes) | Sample events |
| Unknown messages | 147 ×5 (`sensor_profile`, undocumented), 233 ×4,434 (unknown, about one per second), 22, 79, 140, 141, 288, 325–327, 394, 499 | kept only in the Original |
| Unknown record fields | 107, 135, 136, 143 | kept only in the Original |

- **The sample interval varies** (1–3 s): 3,171 records over about 4,435 s. Sample series must
  store their own timestamps, not assume a fixed rate.
- **Sparse channels exist:** NDL is set in only 87 of 3,171 records.
- No compressed-timestamp headers in this file: the official JS decoder read it without errors
  and the integrity check passed.

### fit-file-parser vs official SDK
- Both decode the same named messages and the same 13 named record fields, with equal values
  (spot-checked: depths, summaries, gases, settings, events).
- **`fit-file-parser`'s convenience fields keep only the last message of a type.**
  `data.dive_summary` holds only the *lap* summary and loses dive number, CNS and N2.
  Its `data.messages.<type>` arrays keep every message. **Our adapter must read `messages`.**
- **`fit-file-parser` drops unknown messages and fields** (147, 233, record fields 107/135/136/143).
  The official SDK keeps them with `includeUnknownData`. For phase 1 nothing we model needs them.
  Message 147 will matter for tank pods (cylinder size, see [Garmin FIT](../references/garmin-fit.md)),
  so tank pod support needs either our own decoding of message 147 or another parser.
  Because Originals are kept, this can be added later by re-parsing.

## Implications

- The data model holds up for this file. Every named field has a place.
- ADR 0006 stands: `fit-file-parser` is sufficient for phase 1, provided the adapter reads
  `messages` and the test cross-check against the official SDK covers the summaries.
- Entry and exit positions must both be optional; this Mk3 file has only an end position.
- First committed fixture candidate: this dive, anonymised (GPS, serials and time shifted or removed),
  possibly trimmed.

## Open points
- Meaning of unknown message 233 (about one per second) and of 325–327.
- Whether files from other Descent models or firmware also match byte for byte between USB and Export Original.
- A tank pod dive (not available yet) and a multi-gas dive.
- How Garmin Connect edits (title, notes) relate to Export Original; this file has no title or notes.

## Sources
- Local probe of the owner's sample files (not committed).
- [`@garmin/fitsdk` 21.217.0](https://www.npmjs.com/package/@garmin/fitsdk), [`fit-file-parser` 6.1.2](https://www.npmjs.com/package/fit-file-parser)
