---
title: "ADR 0036: Dive assessment - findings with their evidence, no score"
summary: Every Dive gets findings computed from its Primary recording (and later its Cylinders and the Diver's other dives) by fixed, versioned rules - ascent rate, the last metres, safety stop, descent, depth stability on the stop, lowest NDL, ceilings, ppO2 and CNS, surfacing GF (slice 21), gas left (slice 19), sawtooth, reverse profiles outside the 1999 envelope, surface intervals, dives per day and days in a row, no-fly time as information - each with the measured value, the threshold, its source, how strong the evidence is and a recommendation. No score. Shown under the profile on a time lane, marked in the dive list, the profile coloured by ascent rate; the computer's own events beside them; findings stored with the engine version, dismissals and muted rules per Diver; an MCP tool. Trends later. Slice 18, built 2026-10-06 (engine version 1; see the amendment for what the build settled: one finding per rule and Dive, the last metres only above 18 m/min, the no-fly time beside the findings, three ascent bands, computed after every change and at start). The planned slices move to 19-23.
status: accepted
date: 2026-10-06
---

# ADR 0036: Dive assessment - findings with their evidence, no score

## Status
Accepted – 2026-10-06. Built as slice 18 on 2026-10-06 with engine version 1; what the build settled or changed is in the
[amendment](#amendment-2026-10-06-as-built-slice-18-engine-version-1). Designed in [Dive assessment](../research/2026-10-06-dive-assessment.md). Moves the
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

## Amendment 2026-10-06: as built (slice 18, engine version 1)

The decisions above stand where this says nothing. The thresholds are `LIMITS` in `apps/server/src/assessment/rules.ts`.

### Checked on the owner's file ("Still to check" of the research note)
- One real dive was there to check with (a Garmin Descent Mk3, 7.9 m, 74 minutes, a pool): samples every second, `ndl` in
  seconds, four `dive_alert` events with the codes 17 (ascent critical), 19 (dismissed by timeout), 2 (near surface), 19.
- **The 15 s window agrees with the computer:** Garmin's "ascent critical" came 15 s after the fastest window we measure
  (10.8 m/min). No rule fires on that dive: the ascent was above 6 m only briefly and didn't hold 5 s.
- **False positives on a real logbook are not checked yet:** one pool dive says nothing about how often rules fire. The
  rules test prints the counts for every file in `samples/private` (`vitest run test/assessment-rules.test.ts
  --silent=false`); look at them once more dives are there, and tune with a new engine version.
- Not found, so not used: the US Navy manual's exact ascent tolerance (the ascent rule cites the two bubble studies and
  Garmin's and Suunto's alarms), Shearwater's and Mares' alarms.

### Settled while building
- **One finding per rule and Dive.** Several fast stretches are one "fast ascent" finding: it shows the fastest stretch
  and says how many there were. So a dismissal is keyed by Dive and rule, and survives a recomputation.
- **The ascent rule looks below 6 m; the last metres are a rule of their own, and a quiet one** (owner, 2026-10-07).
  BSAC's "last 6 m in a minute" is 6 m/min, and many divers come up the last 5 m after a stop faster than that:
  remarking on it would lower acceptance of every other finding. The rule measures the final ascent from where the
  diver last held a depth (at most 6 m, at least 3 m of it) and tells, as `info`, only above 18 m/min: 5 m in under
  about 17 seconds. The Decision's "the last 6 m in under a minute" is replaced by this.
- **Safety stop:** time between 2.5 and 6.5 m (3–6 m with half a metre of tolerance) after the diver was last deeper,
  the swim through that band included. Under 3 minutes: note. 3 to 5 minutes where 5 are recommended (deeper than 30 m,
  or the NDL at 5 minutes or less): info. Not judged on dives that entered decompression.
- **Stop stability** looks between arriving at the stop's depth and leaving it, and needs a stop of a minute.
- **The last metres and the safety stop are judged on dives deeper than 10 m** that end at the surface (a recording
  that ends deeper than 2 m says nothing about the way up).
- **Severities of the series rules** (reverse profile, surface interval, dives per day, deep days): all `info`. Their
  evidence is consensus, convention or an agency rule.
- **A dive follows another "repetitively"** when it starts within 12 hours of the other's end (for the reverse profile).
- **The no-fly time is not a finding** (owner, 2026-10-07): it is nothing the diver did, and as a finding it sat on
  every diving day. The assessment carries it beside the findings (`noFly`) on the last dive of each diving day: 12 h
  after a single dive, 18 h after several dives that day or diving the day before, 24 h after decompression (DAN says
  "substantially longer than 18"; the text says so). It can't be dismissed or muted, and marks no Dive.
- **Entered decompression** means the computer's NDL reached zero. Ceilings are the computer's next stop depth, with
  Garmin's 0.6 m tolerance, and only looked at then.
- **ppO2 caution** needs 5 seconds above 1.6 bar in all, so one sample doesn't make it.
- **Three ascent bands** colour the profile (above 4, 9 and 18 m/min), not Subsurface's four: the 1.5 m/min band would
  colour most of every ascent. Faster is also thicker, and a legend says how long each lasted.
- **Not covered:** apnea, CCR and SCR dives (by the Recording's dive mode). Gauge dives are assessed (no NDL, so the
  NDL rules stay quiet).
- **The list's mark counts findings that differ from guidance** (note, caution) and were neither dismissed nor muted;
  `info` findings (a tip, a pop to the surface) don't mark a Dive.
- **Muting** is done from a finding. A muted rule is listed with its Diver on the Divers page (`mutedRules` of
  `GET /api/divers`) and shown again from there, or from any Dive that has such a finding (under "put aside").
- **The lane** is one row per finding with a bar at its stretch (a button) and its title beside it, not chips sharing
  one line: bars that overlap in time stay separate targets. The words are in the panel below.
- **Computer events:** 17 of Garmin's `dive_alert` codes are mapped to our vocabulary; dismissals, battery, setpoint
  switches, "near surface" and the User's own time and depth alarms are left out.

### How it is built
- `src/assessment/rules.ts` (pure): cleaning, splitting, 15 s windows, the rules, `ENGINE_VERSION`, each rule's
  evidence labels and sources. `assessment-service.ts`: `dive_assessment` remembers the engine version and the Primary
  recording (id and `updated_at`) a Dive was assessed from; `dive_finding`, `finding_dismissal`, `muted_rule`.
- **When:** after every Import, after every change through the dive and decision routes (before the answer goes out),
  when an assessment is read, and in the worker at every start (`assess-dives`), which is what catches a new engine
  version. A refresh reads samples only for Dives whose stamp differs; the series rules run over the Diver's dive list
  each time and write only where a finding differs. A dismissal whose finding is gone is deleted.
- **MCP:** `logbook_get_dive_assessment` reads the stored assessment (the tool's transaction is read-only), with each
  finding in English sentences (`texts.ts`), its guidance, evidence, sources, and the fixed note in every result.
- **Slices 19 and 21** add `gas_left` and the surfacing GF as rules here and raise the engine version.
