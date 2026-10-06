---
title: Suunto file import (probe and proposal)
summary: What the Suunto app exports for two real Suunto D5 dives - a thin FIT (no serial, no events, depth and temperature every 10 s) and a JSON that holds everything the FIT has and far more (serial, firmware, algorithm, NDL, ceiling, tank pressure and SAC from a tank pod, alarms) - and the decisions taken (ADR 0037), with the implementation prompt (done, slice 18a).
status: done
date: 2026-10-07
---

# Suunto file import (probe and proposal)

Markers: **[P]** seen in the owner's files; **[S]** from a public source, not seen in a file of ours; **[?]** not verified.

## Question

How does a Suunto dive become a Recording like a Garmin one ([data model](../spec/data-model.md), scenario 1), from the
files the Suunto app exports: FIT and JSON? Nothing was decided beyond "FIT + JSON file import, later phase"
([spec](../spec/README.md)).

## Method

- Two real dives of the owner (Suunto D5 with a tank pod), each as the Suunto app's **FIT export** and its **JSON
  export**, kept in git-ignored `samples/private/suunto/` ([samples](../../samples/README.md)). Still missing: a dive
  that a Garmin recorded too, and one dive exported twice.
- Decoded with `@garmin/fitsdk` 21.217.0 (unknown data included, integrity check) and `fit-file-parser` 6.1.2 on Node 22,
  then run through today's `createFitAdapter()`. Probe scripts were temporary and are not in the repository.
- Dates, times and depths of the dives are left out of this note.
- The JSON files were read with a script (structure, channels, intervals, events) and compared with their FIT sample by
  sample. Public write-ups (DiveJSON's mapping docs, Suunto's FIT description) cover other models.

## Findings: the app's FIT export of a D5 dive [P]

Both files are about 2 KB. Both decoders read them without errors, the integrity check passes, and both give the same
messages and values. **They are complete, not cut off in transit:** each file's length equals the header's declared data
size plus header and checksum, the checksum over all bytes matches the stored one, and the samples run to the end of
the dive with `session` and `activity` after them. 10 s samples of depth and temperature are simply about 2 KB.

| Area | Found | Compared with the Garmin file |
|---|---|---|
| `file_id` | manufacturer `suunto`, product 39, `product_name` "Suunto D5", `time_created` = end of the dive. **No serial number.** | Garmin: serial |
| `device_info` | **none** | Garmin: 10 |
| `developer_data_id` | application ID is the ASCII text `SuuntoFitExport1`: the file is written by the app, not the computer | none |
| `field_description` | `max_depth` (m, float), `dive_number_in_series` (uint8), `dive_mode` (enum), and in one file `surface_time` (s) | none |
| `sport`, `dive_settings`, `dive_summary`, `dive_alarm`, `lap` | **none** | all there |
| `dive_gas` (1) | O2 and He percent, `status: enabled`; one file 21 %, one 32 % | same |
| `session` | start, elapsed and timer time, `sport: diving` (no `sub_sport`), `dive_number`, `surface_interval`, `end_cns`, `o2_toxicity`, `avg_depth`, `max_depth`, `training_stress_score`; the developer fields repeat max depth, number and surface time and add `dive_mode` | this is what replaces `dive_summary` |
| `activity` | `timestamp`, `local_timestamp`, `type: manual` | same fields |
| `record` (176 and 202) | **timestamp, depth, temperature only**; every **10 s** (a few 11 s) | Garmin: 13 fields, 1–3 s |
| `event` (2) | timer start and stop. **No alarms, no gas switches.** | Garmin: dive alerts |
| Positions | **none** (no session, lap or record position) | Garmin: end position |
| Tank pressure | **none, although both dives had a tank pod** (the JSON has it) | – |
| Unknown messages or fields | none | many |

Details:

- **No Device.** Without a serial number the Recording has no Device: it goes to the User's own Diver and can't be told
  from another D5's dive by its device.
- **`dive_mode`** was 3 on the air dive and 7 on the nitrox dive. Suunto documents it as OFF 0, GAUGE 1, FREE 2, AIR 3,
  EAN 4, MIXED 5, CCR 6, NITROX 7, TRIMIX 8, CCR_NITROX 9, CCR_TRIMIX 10 [suunto-fit].
- **`o2_toxicity`** is described by Suunto as a CNS percentage [suunto-fit], but it is the JSON's `EndTissue.OTU`, rounded.
  `end_cns` is `EndTissue.CNS` as a percentage.
- **`surface_interval`** is missing on the dive without a recent dive before it, present (about 21 h) on the other.
- **`session.max_depth` is a few centimetres deeper than the deepest sample**: the computer's own maximum falls between
  10 s samples. The session value is the one to keep.
- The first record sits at the dive's start, already at 1.3 m (the D5 starts a dive at 1.2 m); the last one is up to 10 s
  before the end.
- **UTC offset: unclear.** `activity.local_timestamp − timestamp` gives +1 h for the dive in winter time and +2 h for the
  one in summer time (Central European time on both dates), and the JSON's `DateTime` carries the same offsets. The
  **file names** the app gave (`ScubaDiving_<date>T<time>`) are 7 h ahead of the UTC start for both. A D5 has a clock
  but no time zone, so the app adds one: either the zone of the dive (the files are right, the names were formatted in
  the phone's zone at export) or the phone's zone at some other moment. **The owner knows where the dives were; one
  answer settles it.**
- **Clock drift can't be judged**: there is no dive here that both a Garmin and the D5 recorded.

### What today's adapter does with them

It already imports them (`session.sport` is `diving`), silently and with losses: key `fit:suunto:<start second>`, no
Device, no dive mode, number, CNS, OTU, surface interval or average depth (it looks for them in `dive_summary`), and the
maximum depth from the samples instead of the session. The two timer events are stored as events.

### The dive assessment on such a Recording

`depth` every 10 s and nothing else: the profile rules run (their rates use 15 s windows, [ADR 0036](../decisions/0036-dive-assessment.md)),
the rules on `ndl`, `nextStopDepth`, `po2` and `cns` have nothing to read, and there are no computer events. A 15 s
window holds one or two 10 s samples, so "sustained for 5 s" needs a look in the tests (ADR 0036 was written for 1–5 s).

## Findings: the app's JSON export of the same dives [P]

48 and 57 KB, plain UTF-8, one object: `{"DeviceLog": {"Header", "Samples", "Windows" (empty), "Device"}}`. It is the
computer's own log turned into JSON by the app. Units are SI: Pa, K, m³, m³/s, fractions, seconds.

| Area | Found | Our model |
|---|---|---|
| `Device` (also `Header.Device`) | `Name` "Suunto D5", **`SerialNumber`**, `Info.SW` (firmware), `HW`, `BSL`, battery at start and end | Device, firmware |
| `Header` | `DateTime` (ISO, milliseconds, with an offset), `Duration` (s), `Depth.Max` and `.Avg`, `SampleInterval` 10, `PauseDuration`, `Activity` "Air/Nitrox", `ActivityType` 51, `Ventilation.Avg` (m³/s at the surface: **the pod's SAC**, about 17–18 L/min here). No `DiveTime`. | Recording values; SAC |
| `Header.Diving` | `Algorithm` "Suunto Fused2 RGBM", `Conservatism` 0, `DiveMode` "Air" / "Nitrox", `Altitude`, `SurfacePressure`, `NumberInSeries`, `DaysInSeries`, `SurfaceTime` (missing without a recent dive), `NoFlyTime`, `DesaturationTime`, `SafetyStopTime` 180, `DeepStopEnabled`, `LastDecoStopDepth`, `AscentMode`, `PreviousDiveDepth`, `AlgorithmBottomTime`, `AlgorithmAscentTime`, `AlgorithmBottomMixture` | summary; new words |
| `Diving.StartTissue`, `EndTissue` | `CNS` (fraction), `OTU`, `OLF`, 15 nitrogen and helium tissue pressures, RGBM factors | CNS and OTU start and end; tissues stay in the Original |
| `Diving.Gases[]` (1) | `Oxygen`, `Helium` (fractions), `State` "Primary", `PO2` (the limit, Pa), **`TankSize`** (m³), `TankFillPressure`, **`StartPressure`, `EndPressure`** (Pa), `TransmitterID`, transmitter battery | gas mix; a Cylinder with its pressures (slice 19); the pod is a Device |
| `Samples` with values (177, 203) | every **10 s**, all in one entry: `Depth`, `Temperature` (K, 0.1 steps), `NoDecTime` (s; 6000 means "more than 99 min"), `Ceiling` (m; 0 throughout), `TimeToSurface`, **`Cylinders[].Pressure`** (Pa, with `GasNumber`), `GasTime` (s of gas left), `Ventilation` (m³/s), `DeviceInternalAbsPressure` | channels |
| `Samples` with `Events` (10, 34) | between the value samples, to the millisecond, each with `Active` true or false: `GasSwitch.GasNumber`; **`Alarm`** "Ascent Speed", "Violated Deep Stop"; **`Warning`** "PO2 High", "Mandatory Safety Stop", "Deep Stop Broken", "Deep Stop Penalty", "Tank Pressure"; **`Notify`** "Safety Stop Ahead", "Safety Stop", "Deep Stop Ahead", "Deep Stop", "Tank Pressure", "NoFly Time"; **`State`** "Dive Active", "Below Surface", "Wet Outside", "Below Wet Activation Depth", "Tank pressure available", "Surface Calculation" | events; computer events |
| Positions, water setting, ppO2 and CNS samples, notes, a dive ID | **none** | – |

- **The FIT is a subset of the JSON.** Every FIT record equals a JSON sample (same second, same depth, the temperature
  rounded to whole degrees); the FIT lacks only the last sample. Start (the JSON's cut to the second), duration, maximum
  and average depth, number, surface time, gas, CNS and OTU are identical. **The FIT adds nothing** on a D5.
- **The same dive is recognisable across the two formats** by its start second and duration.
- One sample lies up to a second after `DateTime + Duration`; DiveJSON warns that a transmitter keeps sending after
  surfacing [divejson-suunto-json] (not seen here).
- The pressure samples start at the header's `StartPressure` and end within about 1 bar of `EndPressure`.
- `Active: false` entries end a state ("Safety Stop" toggles as the diver leaves and re-enters the stop depth), so only
  some `true` entries are something the computer "noted".
- **No position in either format**, also for a dive the app may show a place for.

### Other models [S]

A 2026 **Ocean** export has no `Header.Diving` block (gases only as gas switch events, events under `DiveEvents`, 1 Hz
pressure, positions in radians and a `DiveRouteOrigin`) [divejson-suunto-json] [submersion-1445]; an Ocean also writes
its own, rich FIT with sample positions and two `device_info` without a serial [divejson-fit]. Neither is in our hands.
How to export the JSON is not documented by Suunto (their FAQ lists FIT and GPX [suunto-export]); in the app it is the
dive's ⋯ menu, "Download JSON file" beside "Download FIT file" (owner, 2026-10-07).

## Legacy formats [S]

DM5 exports SDE, XML, SML and DL7 [suunto-dm5]. DM5 XML: one `<Dive>` document per dive, serial number and
`DiveNumberInSerie`, no UTC offset, millibar and litres [divejson-suunto-xml]. SML is the structure the app's JSON
mirrors. DM5 itself is no longer developed; Subsurface imports its files.

## Skills

`npx skills find` for "fit file", "suunto", "garmin fit", "file format parser", "dive computer", "binary parsing":
nothing fits (recorded in [skills](../skills.md)). `tdd`, `codebase-design`, `security-and-hardening` cover the work.

## Decisions

**Decided 2026-10-07: all as recommended** ([ADR 0037](../decisions/0037-suunto-file-import-and-file-formats.md)). The
recommendations as they were put to the owner, each judged on the two dives:

1. **FIT, JSON or both.** *Recommend both formats, each read on its own, no merging; the JSON wins.* On a D5 the FIT
   adds nothing, so combining two files into one Recording buys nothing. A JSON arriving for a dive whose FIT is here
   replaces that Recording's data in place (both Originals stay kept; the Recording points at the JSON and gets its
   Device). A FIT arriving when the JSON is here changes nothing and says so (a new reason, e.g. `fuller_copy_here`).
   Only one arrives: it is the Recording. *Trade-off:* scenario 1's "two Originals, one Recording, FIT supplies the gas"
   goes. An Ocean's JSON may lack the gas mix; its own FIT is rich, and merging can come when someone has such files.
2. **One adapter interface.** *Recommend a small registry of file formats:* each with `format`, `mediaType`, `parser`,
   `parserVersion`, `detect(bytes)` and `parse(bytes) → ParsedRecording[]`; the import service and `archive.ts` ask
   the registry and know no format. Recognised **by content, never by file name**: FIT by its header; Suunto JSON as a
   JSON object with `DeviceLog.Header` (parsed only when the file starts with `{` and is under a size limit); the same
   inside a zip. FIT stays one format with **dialects by manufacturer** (Garmin, Suunto). The reason `no_fit_file`
   becomes `no_dive_file` (old Imports keep the old word; clients translate both). *Trade-off:* an API enum changes;
   `ParsedRecording` moves out of `src/fit/`.
3. **Recording key.** *Recommend:* JSON `suunto:<serial>:<start second>`, as for Garmin. The app's FIT has no serial,
   and today's `fit:suunto:<start>` clashes when two buddies' D5s start in the same second:
   `suunto:app-fit:<start second>:<duration s>:<max depth cm>`. The two are tied together in placement: among the
   User's Divers, a Suunto Recording with the same start second and duration is the same dive (decision 1). Re-imports:
   the same file by its hash, a changed file by its key. *Trade-off:* the FIT's key rests on values the app rounds; if
   that changes, a re-export becomes a Duplicate candidate, never a second Dive. A FIT-only dive has no Device, so it
   goes to the User's own Diver.
4. **Vocabulary.**
   - *Dive mode:* JSON "Air", "Nitrox", "Mixed" and FIT 3, 4, 5, 7, 8 → `open_circuit`; "Gauge"/1 → `gauge`; "Free"/2 →
     `apnea`; CCR/6, 9, 10 → `ccr`; anything else → extras.
   - *Deco model:* a new word `suunto_fused2_rgbm` (and `suunto_fused_rgbm`), proper names like Bühlmann's.
   - *Summary:* number, surface interval, CNS start and end, new `otuStart`/`otuEnd`, new `sacLpm` (the pod's average;
     ADR 0032 planned both for FIT), new `conservatism`, new `surfacePressureBar`; per gas new optional
     `tankVolumeL`, `startPressureBar`, `endPressureBar` so slice 19 can offer a Cylinder without reading Originals again.
   - *Channels:* `depth`, `temperature`, `ndl`, `tts`, new `ceiling` (not `nextStopDepth`: a ceiling is not a stop;
     the assessment's ceiling rule reads either), new `tankPressure` (decision 5).
   - *Computer events* (only `Active: true`): "Ascent Speed" → `ascent_critical`; "PO2 High" → `po2_high`; the first
     "Safety Stop" → `safety_stop_started`; new words `safety_stop_mandatory`, `deep_stop_started`, `deep_stop_broken`
     ("Deep Stop Broken" and "Violated Deep Stop"), `tank_pressure_low` (the warning, not the notice). "… Ahead", "NoFly
     Time", "Deep Stop Penalty" and every `State` stay raw events without a word.
   - *To extras or only in the Original:* `AscentMode`, `DeepStopEnabled`, `SafetyStopTime`, `LastDecoStopDepth`,
     no-fly and desaturation time, tissues, batteries, `GasTime`, `Ventilation` samples, `DeviceInternalAbsPressure`.

   *Trade-off:* four new event words and a model word to translate (en, de); `po2_high` on a Suunto means "above the
   limit set for the gas" (1.4 here), on a Garmin a fixed threshold.
5. **Tank pod pressure.** *Recommend storing it now:* channel `tankPressure` in bar (one per gas number), cut at the
   dive's end, with the gas's tank size and start and end pressure in the summary (decision 4). Nothing new is shown or
   computed; SAC per Dive, Cylinders and the pod as a Device stay with slices 19, 22 and 23. *Trade-off:* the channel
   name and unit are fixed before Cylinders exist; a second pod means a second channel, untested.
6. **Matching window.** *Recommend keeping 5 minutes.* Matching compares whole dives, so a clock would have to be off by
   more than the dive is long plus 5 minutes to miss, and a wider window makes dives with a short break overlap. Not
   judged on real files: no dive of both computers is here.
7. **The UTC offset.** *Answered: the dives were in Germany and the export was made in Vietnam, so the files' offset is
   the dive's (`device`) and the file names carry the exporting phone's zone.* As it was asked: depends on the owner's answer: if the files' offset is the dive's, it is `device` as for Garmin;
   if it is the phone's zone, the adapter drops it (a true instant, local offset unknown) and nearby Dives give it.
8. **Legacy formats.** *Recommend later, on request:* SML first (the shape of this JSON), DM5 XML after, SDE never
   unless a User brings files. *Trade-off:* DM5 users go through Subsurface until then.
9. **Order.** *Recommend one slice now, 18a, before slice 19:* the registry, the Suunto dialect of FIT and the JSON
   adapter together, since the files are here and the FIT alone is poor. Slices 19 and 22 then find tank sizes,
   pressures and a measured SAC waiting. *Trade-off:* the logging slice moves back by one.

Also to settle while building: the assessment on 10 s samples (its "sustained for 5 s" inside a 15 s window), and
whether `NoDecTime` 6000 counts as "no limit" for the lowest-NDL rule.

## Files still wanted

1. A dive recorded by **both the Garmin and the D5**: both files (clock drift, start thresholds). The owner has none yet.
2. One dive **exported twice** in each format, to see whether the bytes repeat.
3. Exports of a Suunto Ocean or EON, and a multi-gas dive.

## Sources

- Local probe of the owner's two files (not committed).
- [suunto-fit] Suunto API Zone, FIT description: https://apizone.suunto.com/fit-description
- [suunto-export] Suunto, export file types: https://www.suunto.com/Support/faq-articles/suunto-app/what-type-of-files-can-i-export-from-the-suunto-app/
- [divejson-fit] DiveJSON, FIT mapping: https://github.com/divejson/divejson/blob/main/docs/fit-mapping.md
- [divejson-suunto-json] DiveJSON, Suunto JSON mapping: https://github.com/divejson/divejson/blob/main/docs/suunto-json-mapping.md
- [divejson-suunto-xml] DiveJSON, Suunto XML mapping: https://github.com/divejson/divejson/blob/main/docs/suunto-xml-mapping.md
- [submersion-1445] Submersion, Suunto dive route in the JSON export: https://github.com/submersion-app/submersion/issues/1445
- [suunto-dm5] Suunto, DM5 import and export: https://www.suunto.com/Support/faq-articles/dm5/how-do-i-import--export-dive-logs-to-dm5/

## What building it showed

- **Both real dives read cleanly** through both adapters: each FIT agrees with its JSON (offset, depths, gas, CNS, every
  sample), and each JSON names the key of its FIT.
- **The dive assessment on the real dives** (10 s samples): the deep nitrox dive gets `ascent_rate`, `safety_stop` and
  `ndl`, and the computer's own events agree (ascent alarms, a safety stop made mandatory, a deep stop left early); the
  shallow dive gets no finding and one computer event. The rules needed no change for 10 s data.
- **Suunto's dive number is a number within a series** (1 on both dives): taken as the Dive's number it would number
  every dive 1. It goes to `extras`.
- **A two-minute surface break is inside the 5-minute window**: a second Garmin dive starting 2 minutes after the first
  attaches to the first one's Dive. That is today's behaviour, older than this slice; it speaks against widening the
  window and is worth a look when a real pair of files exists.
- `fit-file-parser` lets Suunto's float developer field `max_depth` overwrite the native one; the adapter rounds it back.

## Implementation prompt

**Done 2026-10-07** (slice 18a in the [architecture](../spec/architecture.md)); kept for the record.

```text
We're continuing Dive Hub. Everything you need is in this repository; read it first and don't rely on any
local memory (AGENTS.md Rule #1).

Task: importing Suunto files - the Suunto app's JSON and FIT exports - behind one registry of file formats, as decided
in ADR 0037 and docs/research/2026-10-07-suunto-import.md. Everything is decided; don't re-litigate it. Ask me before
building only if something in the code makes it harder than it looks.

Read first:
- AGENTS.md, CLAUDE.md, docs/index.md, docs/skills.md, docs/glossary.md (Source, Original, Import, Recording, Primary
  recording, Device, Duplicate candidate, Computer event)
- ADR 0037 (this design), 0003, 0006, 0015, 0016, 0030 (offsets and their source), 0036 (what the assessment reads), 0023
- docs/research/2026-10-07-suunto-import.md (both exports field by field, the decisions), docs/spec/data-model.md
  (scenario 1), docs/spec/architecture.md (import flow), samples/README.md
- Code: apps/server/src/fit/ (fit-adapter.ts, fit-vocabulary.ts), src/imports/ (import-service.ts, archive.ts,
  placement.ts, matching.ts), src/vocabulary.ts, src/assessment/, test/fit-adapter.test.ts, test/fixtures/synthetic-dive.ts

Build:
- Server:
  - src/imports/formats.ts: the registry (format, mediaType, parser, parserVersion, detect by content, parse);
    ParsedRecording moves out of src/fit/; import-service.ts, archive.ts and the position backfill ask the registry and
    name no format. Reasons no_dive_file (no_fit_file stays valid for stored Imports) and fuller_copy_here.
  - src/suunto/suunto-json.ts: DeviceLog → Device (serial, name, firmware), start with its offset (device; without one
    unknown), duration, depths, the summary (dive mode, RGBM model, conservatism, surface pressure, CNS and OTU start and
    end, the pod's SAC, gases with tank size and pressures), channels depth, temperature, ndl, tts, ceiling,
    tankPressure (bar, cut at the dive's end), events (gas switch, alarm, warning, notify, state; active; repeat on a
    notice switching on again). SI units converted. Key suunto:<serial>:<start second>; replacesKey = the FIT's key.
  - The Suunto dialect in fit-adapter.ts: summary from session, developer field dive_mode, the computer's own maximum
    depth, no Device, key suunto:fit:<start second>:<duration>:<max depth cm>, fullerCopyLike.
  - placement.ts: a Recording with replacesKey takes over the poorer one in place (Revision); one with fullerCopyLike
    finds the fuller one by key pattern, duration and maximum depth and is skipped; only among Divers the User manages.
  - Vocabulary: suunto_fused_rgbm, suunto_fused2_rgbm; computer events safety_stop_mandatory, deep_stop_started,
    deep_stop_broken, tank_pressure_low; one function mapping stored events of any Source; the assessment's ceiling rule
    reads nextStopDepth, else ceiling. New summary fields in the API; regenerate packages/api-client. No migration
    expected (summaries are JSON).
- Web: the import texts name Suunto and JSON, .json in the picker, the new reasons, models and events (en, de).
- Tests: test-first; fixtures hand-made in Suunto's shape (test/fixtures/suunto-dive.ts: the JSON and the FIT of one
  dive), never the real files; samples/private/suunto cross-checks each FIT against its JSON when present. The same dive
  from a Garmin and a Suunto on one Dive, a clock three minutes off, one Recording overlapping two Dives as a Duplicate
  candidate, FIT then JSON and JSON then FIT, both in a zip, a re-import, an unknown Device, another User's Device; the
  assessment on 10 s samples (a clean dive, a fast ascent, a low NDL, a ceiling); a browser test (@dives).
- Docs: ADR 0037 (amend with what changed while building), data model (scenario 1), glossary, architecture (slice 18a),
  clients.md, docs/references/suunto-formats.md, samples/README.md, development.md, index.md; mark this prompt done.

Rules:
- Skills first (AGENTS.md); the search on 2026-10-07 found nothing.
- `pnpm check` while working, `pnpm check:full` before proposing a commit, review capture with REVIEW_AREAS=dives only if
  UI changed; look at the screenshots.
- Commit only when I say so (on main, short subject, blank line, body).
- End with a short summary: what was built, what you checked (which real files, what they showed), simplifications,
  what you need me to decide.
```
