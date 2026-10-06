---
title: "ADR 0032: MOD and bottom time on the Tools page - Bühlmann ZHL-16C with gradient factors, capped by oxygen and gas"
summary: The Tools page gains MOD and gas numbers (best mix, EAD, END) for any mix, and a bottom time for a planned depth, gas and Cylinder - the shortest of the no-decompression limit (own clean-room ZHL-16C with GF, actual NDL with the descent, floored, never longer than the references), the NOAA oxygen limit and the gas above the reserve, saying which binds. Air and nitrox only for the NDL, no-stop only, at most 40 m, clean tissues with a warning after a recent dive; GF from the Diver's own computer, else 85; water and altitude as inputs; 1.4/1.6 with O₂ narcotic; FIT's SAC kept on Recordings; validated against MIT implementations, the US Navy table and the owner's logged NDL samples. Slice 20, after the weight calculator.
status: accepted
date: 2026-10-06
---

# ADR 0032: MOD and bottom time on the Tools page - Bühlmann ZHL-16C with gradient factors, capped by oxygen and gas

## Status
Accepted – 2026-10-06. Not built yet. Amended by [ADR 0033](0033-gas-plans-rules-and-groups.md) (slice 21): the bottom
time's gas limit becomes the chosen gas rule's ascent pressure, and its default SAC the Diver's planning SAC from the
logbook (FIT carries SAC only with a tank pod; the owner's Garmin files have none). Designed in [MOD and no-decompression limits](../research/2026-10-06-gas-and-ndl-tools.md);
builds on the Tools page and Cylinders of [ADR 0031](0031-lead-suit-cylinders-and-lead-estimate.md).

## Context
The owner wants the bottom time / no-decompression limit (NDL) and the MOD of a gas or mix as the second planning tool.
The research found:
- MOD and the other gas numbers are short formulas; what matters are water density, surface pressure and the ppO₂ limit
  (1.4 working, 1.6 contingency for most agencies).
- The usable open model is Bühlmann **ZHL-16C with gradient factors** (published coefficients; Garmin, Shearwater and
  newer Suunto use it). RGBM and PADI's tables are proprietary. For a no-stop dive only GF high matters.
- The NDL moves with every choice (GF, water, altitude, whether the ascent is credited, descent, rounding): 30 m on air
  is 13–25 min depending on them. Oxygen (CNS) can bind before it on nitrox, and the gas in the cylinder often binds
  together with it.
- MIT implementations (GasPlanner in TypeScript, dive-deco in Rust) give test values; Subsurface and Submersion are GPL and
  can't be copied into an Apache-2.0 project. A clean-room script from the published values matched GasPlanner within
  0 to +2 minutes, always longer: the unsafe side.
- Dive Hub already keeps the Diver's computer GF and its NDL samples on every FIT Recording.
- Repetitive dives rebuilt from a logbook are too optimistic when a dive is missing; computers disagree among themselves.

The owner chose on 2026-10-06 the recommendation for each of the note's decisions G1–G12.

## Decision

### What the tools answer
- **MOD and gas numbers** for any mix (O₂ and He): MOD at the working and the contingency ppO₂ (default 1.4 and 1.6, both
  editable), best mix for a depth, EAD, END (O₂ counted as narcotic by default, switchable), whether the mix is hypoxic
  (below 0.18 at the surface; ppO₂ below 0.16 is refused as breathable).
- **Bottom time** for a planned depth, gas, Cylinder and SAC: the shortest of
  - the **no-decompression limit** (air and nitrox 21–40 % only; no helium in the model),
  - the **oxygen limit** (NOAA single-exposure table, linear between rows),
  - the **gas** above the reserve after the gas for a direct ascent and a safety stop,
  and which one binds, with OTU shown. MOD and gas numbers work for trimix; bottom time doesn't.

### The model
- **Own clean-room module**, pure and unit-tested, from Bühlmann's and Baker's published coefficients and formulas,
  cited in the code: ZHL-16C (N₂), Haldane and Schreiner, water vapour 0.0627 bar, gradient factors.
- **NDL = actual:** time from leaving the surface until any compartment's tolerated pressure at GF high rises above the
  surface pressure, the descent included (18 m/min), in whole minutes rounded down. No credit for the ascent.
- **Never longer than the references:** tests check against GasPlanner's and dive-deco's published values (MIT; equal or
  shorter, within a stated tolerance), the US Navy Rev 7 air table as a band, and the owner's logged Garmin dives (the
  NDL recomputed along the profile with the computer's GF against the computer's NDL samples; private files per
  `samples/README.md`, skipped when absent).
- **Clean tissues** (no earlier dive). When the Diver has a Dive in the last 48 hours the page says the real limit is
  shorter and the dive computer knows it. Tissues rebuilt from the logbook come later, after validation.

### Inputs and defaults
- **GF:** from the Diver's latest Recording that has it (Garmin writes `gf_low`/`gf_high`), else GF high 85; editable; the
  page says where it came from. GF low is shown but doesn't change a no-stop limit.
- **Water:** salt, fresh or EN 13319 (1025, 1000, 1020 kg/m³), default from the planned site's water type (brackish is
  treated as salt for the limit), else salt. **Altitude:** optional, in metres, surface pressure by the standard
  atmosphere; sites get an altitude later.
- **SAC:** FIT's `avg_volume_sac`, `avg_rmv` and `o2_toxicity` are kept on the Recording summary (older Recordings read
  their Originals again, as for positions in ADR 0020); the default is the median of the Diver's recent dives, else
  20 L/min; editable. From Cylinder pressures later. **Reserve:** 50 bar, editable.
- The page keeps its inputs in the address (as the logbook does, ADR 0017); nothing is stored.

### Limits and wording
- **No-stop only, to 40 m.** Deeper, or beyond the MOD, the page answers "outside recreational limits" instead of a
  number; never a decompression schedule.
- **Always visible:** that it is an estimate, that the dive computer and training govern and no model guarantees safety,
  and the model, GF, water, altitude, rates and reserve it used. Flying after diving only as DAN's text (12 h, 18 h),
  no countdown.

### Order
Slice 20, after the weight calculator's slices 18 (Cylinders) and 19 (the Tools page).

## Considered options
- **NDL only, or NDL and oxygen:** the gas often binds first; Cylinders exist by slice 20.
- **Trimix in the NDL:** technical diving, harder to validate; MOD and END cover planning a mix.
- **Tissues from the logbook now** (Subsurface): too optimistic when a dive is missing or logged by another computer.
- **A fixed default GF (85 or 100):** ignores what the Diver's own computer does.
- **NDL with ascent credit:** 2–3 minutes longer at 30 m; less conservative than what computers show.
- **Vendoring GasPlanner's library, or a young npm package:** more foreign code to own, or no track record; both remain
  test oracles.
- **Sea level only:** overstates the NDL in mountain lakes.
- **A single ppO₂ limit; O₂ not narcotic:** a contingency MOD is what divers plan with; counting O₂ is the more cautious END.
- **No depth cap, or deco schedules:** a deco planner is a different product with far more to validate.
- **The comparison with the Diver's computer on the dive page now:** useful, later; tests first.
- **SAC from Cylinders only, or typed only:** few Dives have pressures; FIT already measures it.
- **Two slices, or before the weight slices:** gas-limited time needs Cylinders; one slice keeps the tools together.

## Consequences
- Dive Hub gives advice a diver may act on; the wording and limits above are part of the client contract.
- The module's tests carry the published values and their sources; changing a coefficient or the NDL definition needs a new
  ADR.
- Recording summaries grow by three FIT fields and need a one-time backfill.
- Repetitive dives, trimix NDLs, sites' altitude and the model-vs-computer view on the dive page stay open for later.
