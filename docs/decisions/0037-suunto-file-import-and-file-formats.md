---
title: "ADR 0037: Suunto file import; file formats as adapters behind one registry"
summary: The Suunto app's FIT and JSON exports both become Recordings, each read on its own - no merging; the JSON (serial, NDL, ceiling, tank pressure, alarms) replaces the thin FIT's Recording of the same dive in place. File formats sit behind a registry and are recognised by content. New words - Suunto's RGBM models, four computer events, OTU, the pod's SAC, tank size and pressures per gas, channels `ceiling` and `tankPressure`. The matching window stays 5 minutes; legacy formats later; slice 18a.
status: accepted
date: 2026-10-07
---

# ADR 0037: Suunto file import; file formats as adapters behind one registry

## Status
Accepted – 2026-10-07 (owner: "as recommended"). Built as slice 18a on 2026-10-07; what the build settled is in the
[amendment](#amendment-2026-10-07-as-built-slice-18a). Designed in [Suunto file import](../research/2026-10-07-suunto-import.md)
on two real D5 dives. Amends [ADR 0015](0015-overrides-vocabulary-and-browser-tests.md) (vocabulary),
[ADR 0036](0036-dive-assessment.md) (computer events, the ceiling channel) and scenario 1 of the
[data model](../spec/data-model.md). Slice 18a, before the logging slice (19).

## Context
- "FIT + JSON file import, later phase" was all that was decided. The data model assumed two Originals combined into one
  Recording, the FIT supplying the gas the JSON lacks.
- Two real Suunto D5 dives (with a tank pod) show otherwise. The app's **FIT** is thin: no serial number, no events, no
  positions, depth and temperature every 10 s, the summary in `session` and developer fields. The app's **JSON** holds
  every FIT value and far more: serial and firmware, "Suunto Fused2 RGBM", NDL, ceiling, time to surface, tank pressure
  with tank size and the pod's SAC, alarms to the millisecond. The FIT adds nothing. Neither has a position.
- Start second, duration and maximum depth are identical in both files of a dive.
- The import service knew one adapter (FIT), and today's FIT adapter already imported Suunto files with losses, under a
  key (`fit:suunto:<start>`) that two buddies' computers can share.
- Other Suunto models (Ocean, EON) and a dive recorded by both a Garmin and a Suunto were not available.

## Decision
1. **Both formats, each read on its own; no merging.** A Suunto JSON and a Suunto FIT each give a Recording by
   themselves. For the same dive the JSON wins: arriving after the FIT, it **replaces that Recording's data in place**
   (new key, Device, samples, events; a Revision; both Originals stay kept, the Recording points at the JSON). A FIT
   arriving when the JSON's Recording is here changes nothing: `skipped`, reason `fuller_copy_here`. Scenario 1's
   "two Originals, one Recording" is dropped. Merging files comes if a model's JSON turns out to lack something its FIT
   has (an Ocean's gas mix, by public reports).
2. **File formats behind a registry** (`src/imports/formats.ts`): each format has `format`, `mediaType`, `parser`,
   `parserVersion`, `detect(bytes)` and `parse(bytes) → ParsedRecording[]`. The import service, the zip reader and the
   position backfill ask the registry and name no format. Formats are recognised **by content, never by file name**:
   FIT by its header, Suunto JSON by a JSON text that opens with a `DeviceLog` member. FIT is one format with
   **dialects by manufacturer** (Garmin, Suunto) inside its adapter. The reason `no_fit_file` becomes `no_dive_file`;
   the old word stays valid for Imports already stored.
3. **Recording keys.** JSON: `suunto:<serial>:<start second>`. A Suunto FIT without a serial:
   `suunto:fit:<start second>:<duration s>:<max depth cm>`. The two are tied in placement, among the Recordings of
   Divers the User manages: the JSON names the FIT key it replaces; the FIT looks for a `suunto:<any serial>:<start
   second>` Recording with the same duration and maximum depth. A FIT-only dive has no Device and goes to the User's own
   Diver.
4. **Vocabulary.**
   - Dive mode: Suunto's Air, Nitrox, Mixed, EAN, Trimix → `open_circuit`; Gauge → `gauge`; Free → `apnea`; CCR modes →
     `ccr`; others to `extras`.
   - Deco models `suunto_fused_rgbm`, `suunto_fused2_rgbm` (proper names).
   - Summary: `otuStart`, `otuEnd`, `sacLpm` (the pod's average at the surface), `conservatism`, `surfacePressureBar`;
     per gas `tankVolumeL`, `startPressureBar`, `endPressureBar`. FIT's `session` is read where `dive_summary` is missing.
   - **Suunto's number in a series is not a dive number** (it restarts at 1): it goes to `extras`, and the Dive gets no
     number from a Suunto Recording.
   - Channels: `ndl`, `tts`, new `ceiling` (m; the assessment's ceiling rule reads `nextStopDepth`, else `ceiling`), new
     `tankPressure` (bar).
   - Computer events, only when the computer switched them on: "Ascent Speed" → `ascent_critical`, "PO2 High" →
     `po2_high`, the first "Safety Stop" → `safety_stop_started`; new `safety_stop_mandatory`, `deep_stop_started` (the
     first), `deep_stop_broken` ("Deep Stop Broken", "Violated Deep Stop"), `tank_pressure_low` (the warning). Notices
     ahead, no-fly, penalties and device states are stored as raw events without a word.
5. **Tank pod pressure is stored now**, as `tankPressure` (the first gas) and `tankPressure:<n>` (further gases), readings
   after the dive's end left out. Nothing is shown or computed from it yet: Cylinders (slice 19), SAC per Dive (22) and
   the pod as a Device (23) read it later.
6. **The matching window stays 5 minutes.** Not judged on real files: no dive of both computers exists yet.
7. **The UTC offset in Suunto's files is the dive's** (source `device`): the owner's two dives were in Germany and carry
   CET and CEST; the file names carry the exporting phone's zone and are ignored. A JSON time without an offset is kept
   as wall-clock time (`unknown`, ADR 0030).
8. **Legacy formats** (SML, DM5 XML, SDE) later, on request: SML first.
9. **Slice 18a**, before slice 19.

## Consequences
- A Suunto owner gets a profile from either file and the full picture from the JSON; importing both, in any order or in
  one zip, ends in one Recording.
- Adding a format is one adapter and one line in the registry.
- Clients translate two new import reasons, two deco models and four computer events.
- The FIT key rests on values the app rounds; if Suunto changes that, a re-exported FIT becomes a Duplicate candidate
  (it overlaps its own Dive), never a second Dive.
- `po2_high` means "above the limit set for the gas" on a Suunto and a fixed threshold on a Garmin.
- A FIT-only Suunto Recording feeds only the profile rules of the dive assessment; with the JSON also the NDL and
  ceiling rules and the computer's events.
- Unknown: Ocean and EON exports, a second tank pod, multi-gas dives, whether exports repeat byte for byte.

## Amendment 2026-10-07: as built (slice 18a)
- **No migration.** Summaries are JSON and reasons, channels and event types are text, so the model's tables did not
  change.
- **The dive number.** Suunto writes only a number within a series of repetitive dives (1 on both real dives). It is kept
  in `extras` (`Diving.NumberInSeries`, `session.dive_number`), and a Dive made from a Suunto Recording has no number.
- **Repeats.** Only a *notice* switching on again is marked `repeat` and left out of the computer events (the safety
  stop and the deep stop, which toggle as the diver drifts); alarms and warnings count every time.
- **Garmin files** also get `otuEnd` (FIT's `o2_toxicity`) and read `session` where `dive_summary` lacks a value.
- **Tying FIT and JSON together** needs the JSON's serial number: the FIT looks for `suunto:<any serial>:<start second>`
  with the same duration and maximum depth. A FIT arriving after a JSON *without* a serial is not recognised and attaches
  as a second Recording of the Dive. The JSON taking over a FIT works either way.
- **A Device first seen on a Recording that is already on a Dive** (the JSON taking over a FIT's Recording) is created
  for that Dive's Diver, not blindly for the User's own.
- **Checked on the owner's two real dives:** each FIT equals its JSON in every shared value; the assessment ran on 10 s
  samples without a change to its rules (findings on the deep dive that agree with the computer's own alarms, none on the
  shallow one).
- **Not read:** an Ocean's positions and its gases from gas switches (no file to check against), a pod as a Device.
