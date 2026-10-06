---
title: Suunto file formats (the Suunto app's JSON and FIT exports)
summary: What the Suunto app exports for a dive - a JSON of the computer's own log in SI units and a thin FIT - field by field as Dive Hub reads them, from two real Suunto D5 dives; what other models are reported to write; legacy DM5 formats.
status: living
date: 2026-10-07
url: https://apizone.suunto.com/fit-description
---

# Suunto file formats

## What it is
The Suunto app exports a dive two ways (the dive, then the ⋯ menu: "Download JSON file", "Download FIT file"; owner,
2026-10-07): as **JSON**, the computer's own log, and as **FIT**,
written by the app (`SuuntoFitExport1`), not the computer. Suunto documents only the FIT's dive fields
([FIT description](https://apizone.suunto.com/fit-description)); the JSON has no documentation. What follows was read from
two real Suunto D5 dives with a tank pod ([probe](../research/2026-10-07-suunto-import.md)). File names carry the local
time of the exporting phone, not of the dive.

## What we take from it
Both are import formats ([ADR 0037](../decisions/0037-suunto-file-import-and-file-formats.md)); the adapters are
`apps/server/src/suunto/suunto-json.ts` and the Suunto dialect in `apps/server/src/fit/fit-adapter.ts`, the words in
`suunto-vocabulary.ts`.

### JSON (`{"DeviceLog": {"Header", "Samples", "Windows", "Device"}}`)
Units are SI: Pa, K, m³, m³/s, fractions (0–1), seconds, metres.

| In the file | In Dive Hub |
|---|---|
| `Device.SerialNumber`, `.Name`, `.Info.SW` | Device (manufacturer `suunto`), product, firmware; key `suunto:<serial>:<start second>` |
| `Header.DateTime` (ISO with milliseconds and an offset) | start and UTC offset (`device`); without an offset: wall-clock time, `unknown` |
| `Header.Duration`; `Header.Depth.Max`, `.Avg` | duration; maximum and average depth |
| `Header.Diving.DiveMode` ("Air", "Nitrox", …) | `diveMode` |
| `Header.Diving.Algorithm` ("Suunto Fused2 RGBM") | `decoModel` `suunto_fused2_rgbm` |
| `Diving.Conservatism`, `.SurfacePressure`, `.SurfaceTime` | `conservatism`, `surfacePressureBar`, `surfaceIntervalSeconds` |
| `Diving.StartTissue` / `EndTissue`: `CNS` (fraction), `OTU` | `cnsStart`/`cnsEnd` (%), `otuStart`/`otuEnd` |
| `Diving.Gases[]`: `Oxygen`, `Helium`, `TankSize`, `StartPressure`, `EndPressure` | `gases[]`: `o2`, `he` (%), `tankVolumeL`, `startPressureBar`, `endPressureBar` (0 = no pod) |
| `Header.Ventilation.Avg` (m³/s at the surface) | `sacLpm` |
| `Diving.NumberInSeries` | `extras` (it restarts at 1; not a dive number) |
| `Samples[]` with values, every `Header.SampleInterval` (10 s): `Depth`, `Temperature`, `NoDecTime`, `TimeToSurface`, `Ceiling`, `Cylinders[].Pressure` | channels `depth`, `temperature` (°C), `ndl` (s; −1 = none, 6000 = "more than 99 min", 0 = decompression), `tts`, `ceiling`, `tankPressure` (bar; `tankPressure:<n>` for further gases) |
| `Samples[]` with `Events` between them: `GasSwitch`, `Alarm`, `Warning`, `Notify`, `State`, each `{Type, Active}` | events `gas_switch`, `suunto_alarm`, `suunto_warning`, `suunto_notify`, `suunto_state` with `name`, `active`, and `repeat` on a notice switching on again |
| `AscentMode`, `DeepStopEnabled`, `SafetyStopTime`, `NoFlyTime`, `DesaturationTime`, tissue pressures, batteries, `GasTime`, `Ventilation` per sample, `DeviceInternalAbsPressure`, `TransmitterID` | only in the Original |

Events seen: alarms "Ascent Speed", "Violated Deep Stop"; warnings "PO2 High", "Mandatory Safety Stop", "Deep Stop
Broken", "Deep Stop Penalty", "Tank Pressure"; notices "Safety Stop Ahead", "Safety Stop", "Deep Stop Ahead", "Deep Stop",
"Tank Pressure", "NoFly Time"; states "Dive Active", "Below Surface", "Wet Outside", "Below Wet Activation Depth", "Tank
pressure available", "Surface Calculation". Which of them are computer events: ADR 0037.

### FIT (the app's export)
`file_id` (manufacturer `suunto`, `product_name`, **no serial**), one `dive_gas`, `record` with depth and whole-degree
temperature every 10 s, two timer events, `session` with `dive_number` (in the series), `surface_interval`, `end_cns`,
`o2_toxicity` (OTU), `avg_depth`, `max_depth` and the developer fields `max_depth`, `dive_number_in_series`, `dive_mode`
(OFF 0, GAUGE 1, FREE 2, AIR 3, EAN 4, MIXED 5, CCR 6, NITROX 7, TRIMIX 8, CCR_NITROX 9, CCR_TRIMIX 10), `surface_time`;
`activity` with the local time. No `sport`, `dive_settings`, `dive_summary`, `device_info`, alarms, positions or tank
pressure. Every value is also in the JSON; the FIT lacks the JSON's last sample. Key:
`suunto:fit:<start second>:<duration s>:<max depth cm>`.

## Notes
- **Neither export has a position** on a D5.
- `fit-file-parser` lets the float developer field `max_depth` overwrite the native one (34.209999 for 34.21): the adapter
  rounds it back.
- A transmitter may keep sending after surfacing; readings later than one sample interval past the end are left out.
- **Not seen, from public write-ups** ([DiveJSON's Suunto JSON mapping](https://github.com/divejson/divejson/blob/main/docs/suunto-json-mapping.md),
  [its FIT mapping](https://github.com/divejson/divejson/blob/main/docs/fit-mapping.md)): a Suunto **Ocean**'s JSON has no
  `Header.Diving` (gases only as gas switches, events under `DiveEvents`, which the adapter also reads; 1 Hz pressure;
  positions in radians and a `DiveRouteOrigin`, not read yet), and the Ocean writes its own, rich FIT without a serial.
  EON files, a second pod and multi-gas dives are untested.
- **Legacy (DM5):** SDE, SML, XML, DL7. SML is the structure this JSON mirrors; DM5 XML is one `<Dive>` per file with
  millibar and litres and no UTC offset. Not imported (ADR 0037: later, on request).
- Test fixtures are hand-made in this shape (`apps/server/test/fixtures/suunto-dive.ts`), never taken from real files.
