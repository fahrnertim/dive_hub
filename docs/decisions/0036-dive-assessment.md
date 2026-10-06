---
title: "ADR 0036: Dive assessment - findings with their evidence, no score"
summary: Every Dive gets findings computed from its Primary recording (and later its Cylinders and the Diver's other dives) by fixed, versioned rules - ascent rate, the last metres, safety stop, descent, depth stability on the stop, lowest NDL, ceilings, ppO2 and CNS, surfacing GF (slice 21), gas left (slice 19), sawtooth, reverse profiles outside the 1999 envelope, surface intervals, dives per day and days in a row, no-fly time as information - each with the measured value, the threshold, its source, how strong the evidence is and a recommendation. No score. Shown under the profile on a time lane, marked in the dive list, the profile coloured by ascent rate; the computer's own events beside them; findings stored with the engine version, dismissals and muted rules per Diver; an MCP tool. Trends later. Slice 18; the planned slices move to 19-23.
status: accepted
date: 2026-10-06
---

# ADR 0036: Dive assessment - findings with their evidence, no score

## Status
Accepted – 2026-10-06. Not built yet. Designed in [Dive assessment](../research/2026-10-06-dive-assessment.md). Moves the
planned slices of ADR 0031–0034 once more (to 19–23).

## Context
The owner wants a logged Dive analysed for improvement potential, with possible problems, solutions and recommendations,
based on thresholds that define a good dive (e.g. the profile's smoothness, the deepest part first, gas at the end, the
safety stop). The research (2026-10-06) found:
- DCS is rare and mostly happens within the algorithm's limits, so checks describe decompression stress and practice;
  they can't call a dive safe.
- Well supported: ascents around 9–10 m/min with a stop (bubble studies, navy rules); a safety stop of 3 minutes at
  3–6 m; gas left (the most common trigger in fatalities); oxygen limits (NOAA). Deep stops don't help decompression dives
  (NEDU, DCS outcomes).
- Weaker than diver lore: reverse profiles (no reason to forbid them within 40 m and 12 m differences, 1999 workshop);
  sawtooth (a case series; validated slow yo-yo schedules gave almost no bubbles); headaches (DAN lists CO2, cold,
  tight gear, sinus and ear squeeze, not depth changes as such).
- Dive Hub keeps the samples needed (depth, temperature, NDL, ppO2, CNS, ascent rate; events with their codes; 1–2 s on
  Garmin, 5 s from SSI).
- Submersion shipped findings in 2026: fixed versioned thresholds, findings on a time lane, neutral wording, dismiss and
  mute; its first sawtooth rule (3 m × 3) fired on a third of dives. New apps show 0–100 scores or LLM sentences.

The owner chose on 2026-10-06 the recommendation for each of the note's decisions X1–X8 and every group of checks.

## Decision

### Findings, no score
- Each **finding**: rule, severity (`info`, `note`, `caution`), the profile stretch, the measured value(s), the threshold,
  its source and evidence label (experiment, observational, case series, consensus, rule, opinion), a recommendation; text
  rendered from these facts in the User's language and units. At most counts by severity; **no score**.
- A fixed note with every assessment: not medical advice; decompression sickness can happen within limits; symptoms →
  DAN or emergency services. No symptom input, no diagnosis, no personal risk factors.

### Checks (first version; thresholds as in the note's table, with sources)
- **Profile practice:** ascent rate (> 10 m/min sustained ≥ 5 s over a 15 s window: note; > 18 m/min: caution), the last
  6 m in under a minute, the safety stop on dives deeper than 10 m (under 3 minutes at 3–6 m; 5 recommended when deeper
  than 30 m or the NDL fell to 5 minutes), descent faster than 18 m/min in the first 10 m (a tip), depth stability on the
  safety stop (skill feedback, ±1.5 m).
- **Decompression and oxygen:** lowest NDL (≤ 5 min: note; entered decompression), ceilings broken for > 30 s (caution),
  ppO2 above 1.4 for more than a minute (note) or above 1.6 (caution), CNS ≥ 80 % (note) or 100 % (caution); the
  surfacing GF ("decompression stress", ZHL-16C at 100/100: > 80 % note, > 90 % caution, thresholds of our own, said so)
  when slice 21's module exists.
- **Gas left:** end pressure under 50 bar (note) or 35 (caution), from the Dive's Cylinder when slice 19 brings it.
- **Shape and series:** sawtooth (at least 4 excursions of ≥ 6 m, conservative on purpose), a reverse profile between
  dives outside the 1999 envelope (deeper by more than 12 m, deeper than 40 m, or with decompression), a surface interval
  under 60 minutes before a dive deeper than 18 m (convention, said so), more than 3 dives a day, 4 or more days in a row
  with dives deeper than 30 m (BSAC), and DAN's no-fly times as information.
- Applied to open-circuit scuba; apnea and rebreather dives are left out until they have rules of their own.

### Method
- Only the **Primary recording's** samples; depth spikes (in and out faster than 60 m/min) interpolated first, never
  dropped; rates over **time windows** (15 s), so 1 s and 5 s data behave alike; split at ≥ 60 s at the surface; at 5 s
  sampling the finding says short bursts may be missed.
- **Thresholds fixed in the engine**, each with its source; a change raises the **engine version** and recomputes. Users
  **dismiss** a finding on a Dive or **mute** a rule for a Diver; they never edit numbers.
- **Stored:** findings (Dive, Recording, rule, severity, stretch, values, engine version), computed when a Dive's Primary
  recording or Cylinders change and in the background after an engine version change; dismissals and muted rules per
  Diver. Deleted Dives keep theirs and count nowhere (ADR 0026). A Dive without a Recording gets only series checks.

### Presentation
- Findings as chips on a time lane under the profile (a tap highlights the stretch and shows the numbers, the guidance,
  the evidence, the recommendation, Dismiss); a small mark in the dive list; the profile coloured by ascent rate
  (Subsurface's bands); neutral wording, no alarm red.
- **The computer's own events** (Garmin's `dive_alert` codes mapped to our vocabulary: ascent critical, safety stop
  broken, complete, ceiling broken, NDL, ppO2, CNS, OTU …) shown beside the findings as "your computer noted …", never
  merged.

### MCP
- `logbook_get_dive_assessment` (ADR 0035) returns the findings with their sources and the fixed note.

### Later
- Trends across dives (sentences with a statistical gate: enough dives per period, an effect size; dismissible) in a slice
  of their own; weighting feedback (ADR 0031) as a finding when the lead felt wrong; rules for apnea and rebreathers.

### Order
**Slice 18**, after the MCP endpoint (17); the planned slices move: 19 logging lead, suit and cylinders (adds gas left);
20 lead estimate; 21 MOD and bottom time (adds the surfacing GF); 22 gas plans; 23 equipment and service.

## Considered options
- **A score (0–100):** easy to read, hides reasons, reassures falsely.
- **Thresholds per Diver:** findings would mean different things, and history would shift silently.
- **A section on the dive page only:** no way to see at a glance which dives have findings.
- **Merging the computer's events into findings:** sources log differently; ours are the same for every source.
- **Trends now:** per-dive findings first; trends need enough dives and a statistical gate.
- **Computed on read:** the list mark would need every Dive computed.
- **Last, or after the logging slice:** most checks need only the samples Dive Hub has now.

## Consequences
- Dive Hub comments on a diver's practice; the wording rules (facts, guidance with its source, no blame, no medical claims)
  are part of the client contract.
- The rules and their sources are reviewed like code; new evidence means a new engine version, not a silent change.
- Slices 19 and 21 each add a check; their prompts say so.
