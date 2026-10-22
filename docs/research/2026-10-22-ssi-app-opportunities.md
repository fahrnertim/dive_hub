---
title: What the SSI app's code offers Dive Hub (app 5.0.43)
summary: A pass over the decompiled MySSI app for what Dive Hub could use. The sample record has 37 keys (tank pressure is `pr`, not `pressure`; `o` is open circuit); the surface interval is in minutes; `odin_user_log_dive_type` separates scuba, freediving and rebreathers, which Dive Hub always sends as 0; SSI's logbook history holds the dives before the logbook. With a ranked list of improvements, none decided.
status: open
date: 2026-10-22
---

# What the SSI app's code offers Dive Hub (app 5.0.43)

Read on 2026-10-22 from the Blutter output of the app (the same build and tooling as the
[API surface note](2026-10-22-ssi-app-api-surface.md)). That note and the ones beside it cover the calls, the save body, the
write bodies, verification and the QR codes; this note covers only what they left open, and compares it with what Dive Hub
sends and reads today (`apps/server/src/providers/ssi/ssi-record.ts`, `ssi-import.ts`). [R] read in the app's code,
[?] not settled. Nothing from the APK is stored in this repository.

## 1. The sample record (`odin_user_log_diveSamples`) [R]

From `ssi_core/dive/dive_record/dive_record.dart` (`DiveRecord.fromJson`, `toJson`, `toString`). Each key with its field name
in the app and the type the app's decoder accepts:

| Key | Field | Type | Key | Field | Type |
|---|---|---|---|---|---|
| `n` | sampleNo | num | `gn` | gfNow | num? |
| `t` | sampleTimestampMs | num | `gs` | gfSurf | num? |
| `d` | depth | num | `dt` | decoTime | num? |
| `p` | pressure (ambient? unit [?]) | num? | `de` | currentDecoStop | object, see below |
| `te` | temperature | num? | `dde` | deepestDecoStop | object, see below |
| `s` | speed | num? | `su` | showUpActive | bool? |
| `pr` | **tankPressureRecord** `{t: tank, v: value}` | object | `st` | scrTime | num? |
| `a` | maresAlarmsBitmask | num? | `ndl` | ndl | num? |
| `f` | flags | num? | `asc` | asc | num? |
| `mf` | mxFlags | num? | `dr` | decoRequired | bool? |
| `mi` | miscInfo | num? | `h` | hudStatus | num? |
| `hb` | heartbeat | num? | `o2l` | o2Loop | num? |
| `b` | bearing | num? | `o` | **oc** (open circuit) | bool? |
| `sp` | setPoint | num? | `rv` | recordVersion | num? |
| `cn` | cns | num? | `ba` | batteryLevel | num? |
| `gm` | gasMix `{index, o2, n2, he}` (all num?) | object | `loc` | location | object |
| `wa`, `ha`, `lda` | watch, housing, libdivecomputer alarm bitmasks | num? | `hpb` | housingPhoneBatteryLevel | num? |
| `sdid` | subDiveId | num? | | | |

- A deco stop (`de`, `dde`) is `{d: depth, t: time, ty: type, tts}`; the types are `decoStop`, `safetyStop`,
  `mandatorySafetyStop`, `deepStop` (how `ty` is written, name or index, [?]).
- **Corrections to the [reference](../references/ssi-app-api.md#samples-odin_user_log_divesamples):** the tank pressure is
  `pr` (an object with the tank's index and the value), not `pressure`; `o` is "open circuit", not "obligation"; `a` holds
  Mares alarm bits.
- **Types:** the decoder takes any JSON number for `d`, `s`, `te`, `gn`, `gs` and `rv` (`num`, then turned into a double).
  So an integer such as `0` does not break this version's decoder; the claim that it does [S] may come from an older
  version or another reader (the chart, iOS) [?]. Dive Hub's own decimals (`samplesJson()`) are harmless and can stay.
- **From a dive computer the app itself fills** `n`, `t`, `d`, the temperature, `pr` (tank index and value), deco stops,
  alarm bits and `rv = 3.0` (`LibDiveComputerDiveRecordUtils.toDiveRecord`). `rv: 3.0` is the app's own value [R].
- `odin_user_log_tankPressureDataset` is built like `depthDataset`: one value per sample (the Mares parser divides the
  raw value by 100, so bar [?]). `diveSamples` and the datasets are both filled by the app.

## 2. The surface interval is in minutes [R]

`odin_user_log_si_before` (double) is filled from a Mares header field that the app accepts only between 3 and 1440
(24 h in minutes) and turns into seconds elsewhere with `siBeforeInSeconds = siBefore × 60`. So the key holds **minutes**.
This settles the owner's open check in the reference (minutes, not seconds); a real record would confirm it.

## 3. The dive type [R]

`odin_user_log_dive_type` is the app's `DiveType`: 0 scuba, 1 scuba training, 2 extended range, 3 extended range training,
4 SCR, 5 SCR training, 6 freediving, 7 freediving training, 8 CCR, 9 CCR training (the enum's order; that the stored
number is the index is [?], no record of another type seen). From a computer the app derives it from the dive mode
(freedive → freediving, closed circuit → CCR, semi-closed → SCR, two or more gases → extended range).
**Dive Hub always sends 0**, so an apnea session or a rebreather dive pushed to SSI arrives as a scuba dive.

## 4. Other things found [R]

- **SSI's logbook history** (`get_divelog_history`) has `history_scuba_totaldives`, `_since`, `_totaldivetime`,
  `_totaldivesdeco`, `_totaldivesnitrox`, … and the same for freediving. The profile has `user_no_dives` and
  `user_no_freedives`. They are what Dive Hub calls "dives before this logbook" ([ADR 0048](../decisions/0048-dive-numbers.md)).
- **`reset_profile_divelog_number_with_deletion`** is the answer to a question the app asks when a dive is deleted
  ("reset the last dive log number in the profile?", text key `confirm_reset_last_divelognumber_in_profile`), passed to
  `DivesStore.setDiveToDeleted`. So SSI keeps a last dive number in the profile, and the flag decides whether a delete
  lowers it. What SSI does with it is server-side [?].
- **The app reads the whole logbook** on every sync (`get_divelog` with no date or offset parameter), as Dive Hub does.
  Its new dives take the highest number + 1 (`getDiveWithHighestDiveNumber`, a second one for freedives).
- **Mares computers' raw bytes** go up with a dive (`odin_user_log_divecomputer_raw_data_header`, `_details`, filled by
  `DiveBuilder`). Whether `get_divelog` returns them, and in what encoding, is [?].

## 5. What Dive Hub could do with it (ranked; nothing decided)

| # | Change | Why | Size | Needs |
|---|---|---|---|---|
| 1 | Send `odin_user_log_dive_type` from the Primary recording's dive mode (apnea → 6, CCR → 8, SCR → 4, else 0); or keep apnea sessions out of a Push | today an apnea session lands at SSI as a scuba dive and counts there | small | an owner's check that SSI shows a freedive sent this way; an ADR note on Push requirements |
| 2 | Send the tank: `_tank_vol_l`, `_pressure_start_bar` / `_end_bar` (and the psi / cuft twins), `_var_tanktype_id` (19 steel, 20 alu) for a Dive with one Cylinder | Dive Hub imports SSI's tank three-way (ADR 0045) but never sends one, so a tank typed in Dive Hub never reaches SSI | small | an ADR amendment (ADR 0045's "it sends no tank"); read-back comparison |
| 3 | Send the lead as `odin_user_log_weight_kg` / `_lb` | the import reads it (ADR 0031) but "not sent to SSI"; the same one-way gap | small | the same amendment to ADR 0031 |
| 4 | Send tank pressure in the samples (`pr: {t: 0, v: bar}`) and `tankPressureDataset` for a Cylinder tied to a pod series | SSI's app draws the pressure curve; Dive Hub has the series | medium | a check in the app that the curve shows |
| 5 | Send `odin_user_log_si_before` in minutes | Dive Hub has the surface interval (`surfaceIntervalSeconds`) | small | none beyond item 2's test pattern |
| 6 | Send CNS, heart rate (`cn`, `hb`; `heartRateDataset`, `_Min` / `_Max` / `_Avg`) and the NDL / deco stop / TTS of the computer (`ndl`, `de`, `dr`, `asc`?) | richer profile at SSI from FIT data | medium | the units of `asc` and `p` [?] |
| 7 | Offer SSI's `history_scuba_totaldives` as "dives before this logbook" on an SSI import | saves typing a number the person already keeps at SSI | small | a read of the answer's shape (one capture) |
| 8 | Import SSI's gear list into Equipment items | ADR 0034 put "SSI's gear later"; the write bodies are known | large | its own ADR |

Items 1–3 and 5 only fill keys that are `null` today, so an update still keeps what SSI's app set where Dive Hub has nothing.
Each sends to the owner's account and so starts with the owner's check, as ADR 0049 asks.
