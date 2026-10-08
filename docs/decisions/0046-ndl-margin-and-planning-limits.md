---
title: "ADR 0046: The NDL takes one minute of margin, and the planning limits as built"
summary: The no-decompression limit on the Tools page is the actual NDL (descent included, no ascent credit, whole minutes floored) minus one minute, the margin GasPlanner also takes, so it is never longer than the references; salt water is checked against a 1030 kg/m³ reference; bottom time is refused beyond the MOD at the contingency ppO₂, and a MOD is shown rounded down to 0.1 m.
status: accepted
date: 2026-10-09
---

# ADR 0046: The NDL takes one minute of margin, and the planning limits as built

## Status
Accepted – 2026-10-09 (owner, in conversation, slice 21). Amends [ADR 0032](0032-mod-and-no-decompression-limits.md)
("NDL = actual", "never longer than the references", the refusal beyond the MOD).

## Context
ADR 0032 asked for the actual NDL, never longer than the references (GasPlanner, dive-deco, US Navy). The clean-room
module in `apps/server/src/planning/ndl.ts`, from Bühlmann's and Baker's published values, came out 0 to +3 minutes
longer than GasPlanner's GF 85 and GF 100 tables in fresh water, and up to +5 in salt water. N₂ fraction, water vapour
and a faster first compartment were tried; none explained it. GasPlanner's source takes the floored run time **minus one
minute** and computes in whole minutes, and its salt water is 1030 kg/m³ where EN 13319 is 1020 and the sea 1025.

## Decision
1. **One minute of margin.** The NDL is the whole minutes from leaving the surface (descent included at 18 m/min, no
   ascent credit) until a compartment's tolerated pressure at GF high falls below the surface pressure, **minus one**,
   never below 0. It is a margin, not a model constant: the page says "one minute of margin" in its model line.
2. **Reference tolerance in the tests.** Against GasPlanner's tables the NDL is at most 3 minutes longer (2 at 18 m and
   shallower, where the descent rounding counts for most). The salt water table is run with 1030 kg/m³ (the
   `densityKgM3` override on the conditions); Dive Hub's salt is 1025. The US Navy Rev 7 air table is a band (at most
   63 min at 18 m, 25 at 30 m).
3. **Beyond the MOD is outside the limits.** Bottom time is refused (`outside_limits`, reason `mod`) when the depth is
   beyond the MOD at the **contingency** ppO₂ (default 1.6); between the working (1.4) and the contingency limit it is
   answered with the flag `ppO2AboveWorking`, which the page says in words. Other reasons: `depth` (deeper than 40 m),
   `gas` (not air or nitrox 21–40 %).
4. **A MOD is rounded down to 0.1 m** (33.4 m, 39.6 m for EAN32), never up: a figure may be shallower than the exact
   one, never deeper.
5. **Gas below 16 % oxygen is refused** with the code `gas_not_breathable`; below 18 % the numbers come with
   "hypoxic".
6. **The gas limit** is the usable litres of the Cylinder (real gas, from the fill pressure to the reserve) minus the
   gas for the way down, the way up at 9 m/min and a 3 minute stop at 5 m, at the SAC times the ambient pressure, plus
   the descent minutes; whole minutes, floored.
7. **One MCP tool, `planning_gas_and_bottom_time`,** answers both the gas numbers and the bottom time, with the
   assumptions and a fixed notice in every result (the research note's two tools gave a model two calls for one question).

## Consequences
- The NDL is a conservative planning figure by design; the dive computer and training govern (ADR 0032, wording).
- Changing the margin, the descent rate or a coefficient needs a new ADR.
- The oxygen limit practically never binds for 21–40 % no-stop dives (it does only near ppO₂ 1.6); the page shows it
  anyway, and says which limit binds.
