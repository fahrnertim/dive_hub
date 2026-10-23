---
title: SSI checks of the dive type, tank, lead, surface interval and pressure curve
summary: Checks on the owner's SSI account (MySSI app, German UI). Two throwaway dives were stored with every new key as sent (no read-back differences). The app shows an apnea dive as a freedive, the tank, the lead, the CNS start and the tank pressure curve (pr with t 0 is the first tank). The surface interval `odin_user_log_si_before` is in SECONDS, not minutes (90 showed as 1 minute, 5400 as 1 h 30 min). The heart rate is read by the app but shows no line of its own in a flat run. SSI gave the later-created dive the lower ID.
status: done
date: 2026-10-24
---

# SSI checks of the dive type, tank, lead, surface interval and pressure curve

Run by the controller with the kept token, announced in the session: `values start` on 2026-10-23, the owner's look in the app and `values finish` on 2026-10-24. Site 83913 (the one the earlier `write` check used). MySSI app on the owner's phone, German UI; app version 5.0.43 per the plan, not re-read on screen. Background: [the plan](../superpowers/plans/2026-10-23-ssi-both-ways.md), [the foundation checks](2026-10-23-ssi-foundation-checks.md), [the opportunities note](2026-10-22-ssi-app-opportunities.md). [T] means tested on the owner's account.

## What was sent, and what SSI stored

Two throwaway dives dated 2000-01-02, noted "Dive Hub test", sent by key name with the full record. The read-back comparison printed an empty list for both: every new key came back as sent [T].

- **Dive A** (SSI ID 30100182, number 93, 10:00): an apnea session, no gas, 2 minutes down to 10 m, heart rate 60.
  - Sent and stored: `odin_user_log_dive_type` 6; `_tank_*`, `_pressure_*`, `_weight_*` and `_si_before` null; `_heartRateAvg`, `_Min`, `_Max` 60; `_heartRateDataset` with 25 values; the samples carry `hb` in 25 of 25 and no `pr`, no `cn`.
- **Dive B** (SSI ID 29897554, number 94, 14:00): open circuit, 21 % gas, 12 L steel tank at 232 bar, 200 to 50 bar with a pressure series, lead 6 kg, surface interval 5400 s, heart rate 80, CNS 3 to 8, 20 minutes to 15 m.
  - Sent and stored: `_dive_type` 0; `_tank_vol_l` 12; `_tank_vol_cuft` 97; `_pressure_start_bar` 200 and `_end_bar` 50; `_pressure_start_psi` 2901 and `_end_psi` 725; `_var_tanktype_id` 19; `_weight_kg` 6; `_weight_lb` 13.2; `_si_before` 90 (sent as "minutes", see below); `_heartRateAvg`, `_Min`, `_Max` 80; `_tankPressureDataset` with 241 values from 200 to 50; `_heartRateDataset` with 241 values; the samples carry `pr`, `hb` and `cn` in 241 of 241, the first `pr` being `{"t":0,"v":200}`.
- SSI gave dive B a **lower ID than dive A**, though B was created after A. This matters for the open "revived ID" case in [the foundation checks](2026-10-23-ssi-foundation-checks.md#open-a-create-got-the-id-of-an-earlier-deleted-dive): SSI's IDs are not a counter of creation order.

## Does the app show an apnea dive as a freedive?

- Sent: `odin_user_log_dive_type` 6 on dive A.
- Stored: 6.
- App (owner's screenshots, 2026-10-24): dive A is listed as "Free" (#93); the year header reads "1 Tauchgänge, 1 Freedive Sessions".
- Result [T]: yes. Dive type 6 is a freedive.

## Does the app show the tank, the lead and the CNS?

- Sent: the tank, pressure and tank type keys, `odin_user_log_weight_kg`/`_lb` and the CNS keys on dive B.
- Stored: as sent (above).
- App: Flasche "Stahl", Größe 12,0 l, Anfangsdruck 200 bar, Enddruck 50 bar, Gewicht 6,0 kg, CNS Start 3 %.
- Result [T]: yes, all of them.

## Is the surface interval in seconds or minutes?

- Sent: `odin_user_log_si_before` 90 on dive B, meaning 90 minutes as the plan, the review note and ADR 0057 had it.
- Stored: 90.
- App: "Oberflächenpause 00:01 Stunden": the app read 90 as seconds. A one-off update (owner-approved) set the key to 5400: the app then showed "01:30 Stunden" and "Ofl Vorher 1 h 30 min".
- Result [T]: **`odin_user_log_si_before` is in seconds.** The earlier [R] claim (minutes) read the Mares header field, which is in minutes, 3 to 1440, and is multiplied by 60 into seconds (per [the opportunities note](2026-10-22-ssi-app-opportunities.md)); it is not user input in the app's form (the owner could not edit the surface interval in the app), and the stored key holds the seconds. Code fixed in commit 8142f3b: Dive Hub sends and reads seconds, and sends `null` outside 180 to 86 400 s (the app's 3 to 1440 minutes). That limit stays [R] and was not tested: it is a controller ruling. An apnea surface interval under 3 min (180 s) is therefore not sent.
- The owner could not edit the surface interval in the app (it seems to come only from dive computers). None of the owner's 84 logbook dives has `si_before` set.

## Does the pressure curve show, and the heart rate?

- Sent: `pr` `{"t":0,"v":<bar>}` in each of dive B's 241 samples, plus `hb` and `cn`; `_tankPressureDataset` and `_heartRateDataset` as arrays.
- Stored: as sent.
- App: the "Druck (bar)" line shows 200 to 50 over the dive, so **`pr` with `t: 0` is the first tank** [T]. No run with `t: 1` is needed.
- Heart rate [T, partial]: "Herzfrequenz (bpm)" is in the legend, and in landscape the bpm axis runs 0 to 80, so the app read the series. The flat 80 line lies under the no-deco-limit line at the top, so it is present but not visible as its own line. A run with a varying heart rate would show it; not done.
- CNS: listed (CNS Start 3 %). The landscape view also shows the m/min ascent-rate line, which the app computes itself.

## Cleanup

`values finish` deleted both dives and confirmed them gone [T].

## For the code and the docs

- Seconds for `si_before`, in code (8142f3b) and in [the reference](../references/ssi-app-api.md). ADR 0057 said minutes; the owner had it corrected to seconds on 2026-10-24. The plan's original value line is kept, with a correction beside it; the opportunities note's section 2 and the decompilation review carry a correction pointer.
- Still open: the limit of 180 to 86 400 s [R], and a visible heart rate line (needs a varying series).
