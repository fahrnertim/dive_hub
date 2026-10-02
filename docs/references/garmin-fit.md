---
title: Garmin FIT (dive messages)
summary: Garmin's binary activity format; primary inbound format for Garmin Descent and Suunto dives.
status: living
date: 2026-10-02
url: https://github.com/garmin/fit-javascript-sdk/blob/main/src/profile.js
---

# Garmin FIT (dive messages)

## What it is
Garmin's binary activity file format, with official SDKs. Dive-specific messages:
`dive_settings` (258), `dive_gas` (259), `dive_alarm` (262), `dive_summary` (268),
`tank_update` (319), `tank_summary` (323), `dive_apnea_alarm` (393), plus dive fields
in `record`/`session` and `dive_alert` events. Source: SDK profile 21.217.0.

## What we take from it
- Primary inbound format (Garmin export, and Suunto app export).
- Field list for samples and summaries (SAC/RMV, CNS/N2/OTU, TTS, ascent rate, tank pods).

## Notes
- Suunto writes FIT differently: developer fields, no `dive_summary` or `tank_*`.
  See [dive data sources](../research/2026-10-02-dive-data-sources.md).
- Official SDKs: C, C++, C#, Java, JavaScript, Objective-C, Python, Swift; v21.217.0
  (2026-09-22) on npm/PyPI/NuGet/Maven. Proprietary FIT Protocol License (no
  copyleft combination, no redistribution beyond its terms). JS/Python decoders
  don't support compressed timestamps. See
  [FIT parsing libraries](../research/2026-10-02-fit-parsing-libraries.md).
- Tank pod metadata (name, cylinder volume, rated pressure) is in message 147
  (`sensor_profile`), which is **not** in the public profile; libdivecomputer
  reverse-engineered it.
- Entry/exit GPS: `session.start_position_*` (3/4) and `session.end_position_*` (38/39),
  in semicircles. Tank pressure is bar ×100, not SI.
- A real Descent Mk3 file: USB copy and Export Original are byte-identical; two `dive_summary`
  messages (session and lap); variable 1–3 s sample interval; only an end position. See
  [sample probe](../research/2026-10-02-garmin-descent-sample-probe.md).
