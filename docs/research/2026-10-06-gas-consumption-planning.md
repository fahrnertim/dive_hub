---
title: Gas consumption and gas rules for a dive or a group (third planning tool)
summary: How much gas a planned dive uses and when to turn or ascend, for one Diver or a group - gas rules (fixed reserve, fixed ascent pressure, halves, thirds, sixths, matched thirds for mismatched cylinders, rock bottom / minimum gas) with their origins and agencies, SAC and how to take it from logged dives (and why the owner's Garmin files don't carry it), consumption over a profile, how planners and computers present it (Subsurface, GasPlanner, UTD, Shearwater GTR, Garmin ATR, Suunto gas time), team planning by the worst consumer and the smallest cylinder (no planner does groups); privacy of another User's SAC; the model; decided (ADR 0033) with the prompt for slice 22.
status: decided
date: 2026-10-06
---

# Gas consumption and gas rules for a dive or a group (third planning tool)

Asked by the project owner on 2026-10-06, after [MOD and no-decompression limits](2026-10-06-gas-and-ndl-tools.md): an
**air consumption** calculation with **time estimates**, also for a **group**, so a team can plan how long the gas lasts
for the worst consumer in it, with the **gas rules** (the "100 bar" briefings, the rule of thirds, …) explained.

## In the glossary's terms, and what it adds to ADR 0032

[ADR 0032](../decisions/0032-mod-and-no-decompression-limits.md) already planned a **bottom time** whose third limit is
the gas: one Diver, one depth, one Cylinder, the SAC, a fixed 50 bar reserve. This feature generalises that limit:

- **A gas plan** for a planned dive: its levels (or one depth), descent, ascent and safety stop; per Diver the
  **Cylinder** (ADR 0031) and **SAC**; the gas each segment uses, the end pressure, and the pressures where the dive must
  **turn** (head back) and where it must **ascend**, by a chosen **gas rule**.
- **A group** (a buddy pair or a dive-centre group): several Divers with their own SAC and Cylinders. The plan follows
  the **controlling Diver** (the first to reach a limit), and every Diver gets their own pressures (bar differs when
  Cylinders differ).
- **Explanations** of each gas rule: what it is for, who teaches it, when it isn't enough.
- **SAC from the logbook:** per Dive from its Cylinder's start and end pressure, volume, average depth and duration; a
  Diver's planning SAC from their recent Dives.

Touches: ADR 0032 (the gas limit becomes this engine's; its SAC default needs amending, see below), ADR 0031
(Cylinders, their pressures and the catalogue), [ADR 0028](../decisions/0028-shared-divers-and-participants.md) (every
User sees every Diver by name only: another User's SAC is theirs), Participants (a Dive's buddies as a starting group),
[ADR 0017](../decisions/0017-logbook-list-paging.md) (inputs in the address).

**Contradictions:** none with an accepted ADR. Two things need deciding:
- **ADR 0032's default SAC** ("FIT's SAC, else 20 L/min") rarely works: the owner's Garmin Descent Mk3 file (no tank
  transmitter) has **no SAC, RMV or CNS** in its `dive_summary` (only depths, bottom time, surface interval; checked
  2026-10-06). FIT carries SAC only with a tank pod. So the SAC must mostly come from logged Cylinder pressures (an
  amendment to 0032).
- **Another User's Diver in a group:** ADR 0028 shows other Users nothing but a Diver's name. Their SAC can't be read
  from their logbook without a new rule (sharing it is close to Visibility, which isn't built).

## Gas rules

| Rule | Turn / ascent | Formula | Where it comes from | For |
|---|---|---|---|---|
| **Fixed reserve** | surface (or be at the safety stop) with R | usable = start − R | J-valve era; PADI blog "about 50 bar at the safety stop"; SSI "at least 30 bar on the surface", "35 bar under the boat plus the safety stop"; BSAC: surface with **a third** (~75 bar in a 232 bar cylinder) [wiki-planning] [padi-air] [ssi-ems] [bsac-gas] | recreational open water |
| **Fixed ascent pressure** ("up at 100 bar") | start the ascent at A | – | dive-centre briefing practice, "80 or 100 bar … back on the boat with not less than 50"; no agency standard [wiki-management] | guided groups |
| **Halves** | turn at start − (start − R)/2 | 200 bar, R 50 → turn 125 | RAID [raid] | shore or reef dives back to the entry |
| **Thirds** | turn at start − usable/3 | 210 → 140 | Sheck Exley, *Basic Cave Diving* (NSS-CDS); SSI XR: no penetration beyond a third [wiki-thirds] [ssi-xr] | overhead (cave, wreck, ice), with training |
| **Fourths, sixths** | usable/4, usable/6 | | TDI authors, cave practice for siphons, currents and scooters [scubaverse] [protec] | overhead with current or DPV |
| **Matched thirds** (different cylinders) | by **volume**, the smaller supply controls; with different SAC, A's in-gas is at most V_A / (2 + SAC_B/SAC_A) | LP85 vs LP104 doubles: 2400 vs 2616 psi turn | NSS-CDS (Jim Wyatt) [wyatt]; [wiki-thirds] | any team with mismatched cylinders |
| **Rock bottom / minimum gas** | ascend when what's left is what two divers need to surface from the worst point | (SAC_A + SAC_B) × stress × Σ(time × pressure) over problem solving at depth, ascent and stops, + ~10 bar | UTD worksheet (30 L/min × 2 divers, ascent + 1 min) [utd]; GUE "CAT" (unconfirmed primary) ; Subsurface (SAC × 4.0, 4 min) [subsurface-notes]; GasPlanner (30 L/min stressed each, 1 min) [gasplanner-docs] | every dive; it is what the fixed reserve stands in for |

**Worked example** (UTD's defaults, 30 m): 4.3 min (ascent + 1) × 30 L/min × 2 divers × 2.5 bar ≈ 645 L ≈ 58 bar in an
AL80. Alert Diver computes 552 L for 30 m at 15 L/min and recommends turning at 80–100 bar with a margin [alert-diver].
**The defaults decide the number**, and at 30 m a "50 bar reserve" is about rock bottom with nothing to spare; at 10 m
it is more than needed. That is why the tool should always show rock bottom beside any fixed rule.

**Turn vs ascent:** the turn pressure matters only when the dive must come back the way it went (overhead, shore exit);
the ascent pressure (rock bottom) matters on every dive. Where both apply the binding one is the higher of turn and
rock bottom + the gas to get back. "Rule of 120/130" is an NDL shortcut, not a gas rule [scuba-com].

**Computers:** Shearwater's GTR = (tank − reserve − ascent gas) / (SAC × P), ascent at 10 m/min, no stops, SAC over the
last 2 min without the first 30 s [teric]; Garmin's ATR the same at 9 m/min, alert at max(reserve/2, 21 bar), with
"PSAC", "VSAC" and an "RMV" at ambient pressure [garmin-mk3]; Suunto's gas time to 35 bar at 10 m/min [suunto-gas].

## SAC

- **One quantity:** litres per minute at the surface (RMV). "SAC" in bar/min depends on the cylinder; Garmin's "RMV" is
  at ambient pressure. Dive Hub keeps L/min at the surface and calls it SAC (glossary).
- **Typical:** 12–20 L/min relaxed, BSAC's training average 25, US Navy light work 10–20, moderate 20–37, heavy 37–54
  [kirby-morgan] [bsac-sac]. Planner defaults 20 (Subsurface, GasPlanner), stressed 30 (GasPlanner, UTD per diver).
- **Stress:** ×2 per diver is common (Subsurface's 4.0 = 2 divers × 2), ×1.5 in GasPlanner, ×2–7 in InDepth's failure
  cases [indepth-thirds]; Alert Diver adds 50–100 % on top.
- **From a logged Dive:** SAC = (start − end) × volume / ((average depth / 10 + 1) × duration) [utd] [gasplanner-sac].
  Pitfalls: the whole dive averages descent, stops and surface time; BC and drysuit inflation count as breathing; gauges
  round (5–10 bar matters on a short dive); above ~200 bar air holds less than ideal (Z ≈ 1.04 at 232 bar, 1.10 at 300)
  [dge-z]; a warm fill loses ~0.7 bar per °C in cold water; several cylinders only pool when identical.
- **For planning:** worst-case values, not the mean (NOAA via Wikipedia). A high percentile (80th–90th) of the Diver's
  recent trustworthy Dives is a reasonable reading of that; no agency names a percentile.
- **What Dive Hub will have:** ADR 0031's Cylinders with start and end pressure (SSI brings both on 13 of the 129 dives
  in the development database, and the volume on 21); FIT's SAC only from tank pods. The owner can provide **Suunto files
  recorded with a tank pod** (2026-10-06), which carry the pressure over the dive and so a measured SAC, once Suunto
  import exists (a later phase, [spec](../spec/README.md)); listed under Wanted in [samples](../../samples/README.md).

## Consumption over a profile

Per segment: gas (L) = SAC × time × pressure (level: at its depth; descent and ascent: at the average depth). Sum,
divide by the cylinder volume (with Z above 200 bar), subtract from the start. Planners show it per cylinder with
warnings: Subsurface "more gas than available", "not enough reserve for gas sharing on ascent" [subsurface-notes];
GasPlanner a bar per tank against rock bottom and "Not enough gas" [gasplanner-docs]; UTD's worksheet as a fixed
sequence [utd]. Subsurface admits its minimum gas is only right for single-level dives; multi-level plans need rock
bottom at each level, since the worst point may not be the deepest.

## Groups

- **The team rule:** the dive turns when anyone reaches their turn and ascends when anyone reaches their ascent
  pressure (RAID, Wikipedia).
- **The worst case:** an out-of-gas buddy at the deepest point at the end of the bottom time; two divers on one supply at
  stressed rates. So each Diver's rock bottom covers **their own SAC plus the highest SAC in the group**, stressed.
- **Mismatched cylinders:** plan in litres; the smallest supply (relative to consumption) controls; translate back to bar
  per Diver.
- **Nobody does this for a group.** Subsurface and GasPlanner plan one diver with a buddy multiplier; a web calculator
  (cju) matches two; no planner takes N divers with their own SAC and cylinders [cju].

## Model (proposal)

- **One gas engine** (pure, in the planning module of ADR 0032): segments → litres per Diver → pressures, with Z above
  200 bar; rules: fixed reserve, fixed ascent pressure, halves, thirds, sixths (matched by volume), rock bottom per
  segment. ADR 0032's gas limit becomes "bottom time until the ascent pressure of the chosen rule".
- **Inputs:** levels (depth, time; one level by default), descent and ascent rates, safety stop; per Diver a Cylinder
  (catalogue or typed; start pressure) and a SAC; stress factor, problem-solving time, rule, reserve.
- **A Diver's SAC:** computed per Dive from its Cylinder (one cylinder, or identical ones; pressures, volume, ≥ 15 min,
  average depth), FIT's when a tank pod gave it; the planning SAC is a high percentile of the last trustworthy Dives
  (with how many), else a default. Shown on the dive page too ("SAC on this dive").
- **Who can be in a group:** the Divers the User manages (SAC from their logbook), any other Diver by name with a
  **typed SAC** (ADR 0028: nothing of theirs is read), and unnamed "a diver" rows. A later rule may let a User share
  their planning SAC with buddies.
- **Output:** per Diver: litres and bar per segment, planned end, turn, ascent pressure, margin; the controlling Diver
  marked; a briefing line ("we turn when anyone reaches their turn …"); errors (planned end below the reserve, not
  enough gas for a shared ascent from a level); the rule's explanation and assumptions; the disclaimer.
- **Stored:** nothing for the plan (inputs in the address; Diver ids, never another Diver's SAC). Per-Dive SAC is
  computed from the Cylinder, not stored (it changes when the Cylinder is corrected).
- **Providers and imports:** nothing new; SSI's pressures arrive through ADR 0031's Cylinder.

### Scenario: a guided group in the Red Sea

The guide plans 18 m for 30 min, then 10 m for 10 min and a safety stop, with a group of four: Tim (his own Diver; planning
SAC 19 L/min from his last 12 Dives with pressures), Anna (another User's Diver: SAC typed 16), Bob (external Diver:
unknown, default 25) and Lena (SAC typed 18, a 12 L steel at 220 bar; everyone else an AL80 at 200 bar). Rule: rock
bottom, never below 50 bar. Stress ×2, 1 minute of problem solving, a direct ascent at 9 m/min.

1. Each segment's litres per Diver; Bob uses most.
2. Rock bottom at 18 m covers each Diver's SAC plus the highest other SAC, stressed: Tim and Bob (19 + 25) × 2 → about
   52 bar in an AL80; Anna and Lena below 50, so 50 bar is their ascent pressure. At 18 m rock bottom and the fixed
   50 bar nearly agree; at 30 m it would be well above.
3. Bob reaches 52 bar first, at **about minute 24** (descent included), Tim at about minute 32: the plan's 30 minutes at
   18 m don't fit. The tool says the group leaves 18 m at minute 24, Bob is the controlling Diver (or he takes a larger
   cylinder), and shows everyone's pressures at that moment.
4. Anna's and Lena's typed SACs aren't stored anywhere; Bob's default is marked as a default.

(Numbers from a scratch calculation, salt water, ideal gas; the implementation's tests redo them.)

Stress points: a Diver with no Dives with pressures (default SAC, said so); Tim's Dives with two different cylinders (no
SAC from them); a 300 bar fill (Z makes it ~10 % less gas); a group where the smallest cylinder belongs to the lowest
consumer (matched by litres, not bar).

## Decisions

All made by the owner on 2026-10-06, each as recommended; written down as [ADR 0033](../decisions/0033-gas-plans-rules-and-groups.md).

| | Question | Decided (2026-10-06) |
|---|---|---|
| H1 | Profile | Levels (one by default), with descent, ascent and safety stop; rock bottom at each level |
| H2 | Rules | All (fixed reserve, fixed ascent pressure, halves, thirds, sixths matched by litres, rock bottom), each explained; default: ascend at rock bottom, never below 50 bar; rock bottom always shown |
| H3 | Group | Any number of Divers; the controlling Diver marked; each Diver's own pressures; a briefing line |
| H4 | Another User's Diver | Typed SAC only (default 20, marked); nothing of theirs read; sharing later with Visibility |
| H5 | SAC from the logbook | Per Dive from its Cylinder (or a tank pod), shown on the dive page; planning SAC = 85th percentile of the last 20 such Dives (at least 5, else 20 L/min) |
| H6 | Rock bottom defaults | Stress ×2 per Diver, 1 minute of problem solving, direct ascent at 9 m/min, + 10 bar; editable |
| H7 | Real gas | Compressibility above 200 bar for air and nitrox |
| H8 | Order and ADR 0032 | Slice 22 after 19; amends 0032 (gas limit = the rule's ascent pressure; SAC from the logbook) |

### Still to check
- **The compressibility source** for air and nitrox (a cited table or a virial formula) and its accuracy at 300 bar.
- **GUE's "CAT" formula** and **PADI's 50 bar** in primary texts (both quoted second hand; neither is used as a number).
- **What SSI's pressures mean** (start and end as typed; whether "end" is at the surface or the safety stop) before they
  count for SAC.
- **Suunto tank pod files** (the owner's) when Suunto import is planned: whether they carry SAC directly or only pressures.

## Slices

1. **Slice 22: gas plans** (after slices 19–21): the engine, rules and groups on the Tools page, SAC per Dive on the dive
   page, the planning SAC, and ADR 0032's gas limit switched to it. Smallest thing to learn from: how many of the owner's
   Dives give a usable SAC once Cylinders are logged.
2. **Later:** sharing a planning SAC with buddies (with Visibility); a planned dive keeping its group and plan; gas
   switches and stage cylinders (technical); Suunto tank pods feeding SAC.

## Sources

- [wiki-planning] Wikipedia, Scuba gas planning: https://en.wikipedia.org/wiki/Scuba_gas_planning
- [wiki-management] Wikipedia, Scuba gas management: https://en.wikipedia.org/wiki/Scuba_gas_management
- [wiki-thirds] Wikipedia, Rule of thirds (diving): https://en.wikipedia.org/wiki/Rule_of_thirds_(diving)
- [padi-air] PADI blog, improving air consumption: https://blog.padi.com/tips-improve-air-consumption/
- [ssi-ems] SSI, EMS section 4: https://training.divessi.com/index.php?id=5796
- [ssi-xr] SSI XR standards, breathing gas: https://training.divessi.com/course/xr-training-standards-and-procedures-20241/xr-general-training-standards/equipment-definitions/breathing-gas-xr-programs
- [bsac-gas] BSAC Safe diving guide, gas: https://www.bsac.com/safety/safe-diving-guide/gas/
- [bsac-sac] BSAC, So you think you use too much gas: https://www.bsac.com/news-and-blog/so-you-think-you-use-too-much-gas/
- [raid] RAID, Gas Management 101: https://diveraid.com/gas-management-101/
- [scubaverse] Scubaverse (TDI article), misconceptions about overhead diving: https://scubaverse.com/thats-wrong-misconceptions-about-overhead-diving
- [protec] ProTec, avoiding breathing gas emergencies: https://protecdivecenters.com/blog/avoiding-breathing-gas-emergencies/
- [wyatt] J. Wyatt (NSS-CDS), Gas matching: http://cavediveflorida.com/Gas%20Matching.pdf
- [utd] UTD gas planning worksheet 2020: https://utdscubadiving.com/wp-content/uploads/UTD-Gas-planning-worksheet-2020.pdf
- [subsurface-notes] Subsurface `core/plannernotes.cpp`: https://github.com/subsurface/subsurface/blob/master/core/plannernotes.cpp
- [gasplanner-docs] GasPlanner docs (consumed gas, plan options): https://github.com/jirkapok/GasPlanner/blob/master/doc/consumed.md
- [gasplanner-sac] GasPlanner, SAC: https://github.com/jirkapok/GasPlanner/blob/master/doc/sac.md
- [alert-diver] Alert Diver Europe, Let's talk about gas planning: https://alertdiver.eu/en_US/articles/lets-talk-about-gas-planning/
- [indepth-thirds] InDepth, Was Sheck wrong?: https://indepthmag.com/was-sheck-wrong/
- [scuba-com] Scuba.com, the rule of 120: https://www.scuba.com/blog/?p=366278
- [teric] Shearwater Teric manual: https://cdn.shopify.com/s/files/1/0838/3732/1530/files/Teric_Manual-metric_2021.pdf
- [garmin-mk3] Garmin Descent Mk3 manual: https://www8.garmin.com/manuals/webhelp/GUID-9183E86B-2399-4CFC-AB50-EAFC6D6ED326/EN-US/Descent_Mk3_Series_OM_EN-US.pdf
- [suunto-gas] Suunto EON Steel, gas time: https://www.suunto.com/en-us/Support/Product-support/suunto_eon_steel/suunto_eon_steel/features/gas-time/
- [kirby-morgan] Kirby Morgan, supply pressure tables (US Navy figures): https://www.kirbymorgan.com/sites/default/files/2023-12/supply-pressure-requirements-and-tables.pdf
- [dge-z] Dive Gear Express, Z-factors for scuba: https://divegearexpress.com/library/articles/zfactors-for-scuba
- [cju] cju Dive Tools, gas matching: https://divetools.cju.com/matching/

## Prompt: gas plans (slice 22)

```text
We're continuing Dive Hub. Everything you need is in this repository; read it first and don't rely on any
local memory (AGENTS.md Rule #1).

Task: the third planning tool - a gas plan for one Diver or a group (levels, gas rules, rock bottom, each Diver's
pressures), SAC per Dive from the logbook, and ADR 0032's bottom time switched to this gas engine. As decided in ADR
0033 and docs/research/2026-10-06-gas-consumption-planning.md. Slices 19 (Cylinders), 20 (Tools page) and 21 (MOD,
NDL, oxygen) are built. Everything is decided; don't re-litigate it. Ask me before building only if something in the
code makes it harder than it looks.

Read first:
- AGENTS.md, CLAUDE.md, docs/index.md, docs/skills.md, docs/glossary.md (Gas plan, Gas rule, Rock bottom, Turn pressure,
  Ascent pressure, Controlling diver, SAC, Cylinder, Bottom time)
- ADR 0033 (this design), 0032 (the planning module, bottom time, amended), 0031 (Cylinders, catalogue), 0028 (what other
  Users see of a Diver), 0017 (inputs in the address), 0014 (units), 0023 (checks)
- docs/research/2026-10-06-gas-consumption-planning.md (rules and formulas with sources, SAC pitfalls, the group
  scenario, "Still to check"), docs/spec/data-model.md (scenario 7), docs/spec/clients.md, docs/spec/design-system.md
- Code: the slice-19 planning module and Tools page, the slice-17 Cylinders, src/dives/ (dive-service.ts, routes.ts),
  apps/web/src/DiveDetail.tsx, lib/units.ts

Build:
- Server:
  - In the planning module: segments (levels, descent 18 m/min, ascent 9 m/min, safety stop 3 min at 5 m) -> litres per
    Diver -> pressures with a cited compressibility factor above 200 bar; rules: fixed reserve, fixed ascent pressure,
    halves, thirds, sixths (turn rules matched by litres), rock bottom at every level ((own SAC + highest other SAC) x 2,
    1 min at the level, direct ascent, + 10 bar; all editable); default: ascend at rock bottom, never below 50 bar.
    The controlling Diver, each Diver's planned end, turn, ascent pressure and margin, the minute a level must be left.
  - SAC per Dive (computed from its Cylinder: one or identical cylinders, both pressures, a volume, >= 15 min; or a
    tank pod's SAC on the Recording) on the Dive; a Diver's planning SAC (85th percentile of the last 20 such Dives,
    with the count; < 5 -> 20 L/min, said so), only for Divers the User manages.
  - Routes (computed, nothing stored): the gas plan for levels and Divers (managed ones by id; others by id or unnamed
    with a typed SAC - never read another User's logbook); bottom time (ADR 0032) uses the chosen rule's ascent pressure
    and the planning SAC. Regenerate packages/api-client.
- Web: on the Tools page, "Gas plan": levels, the group (pick Divers by name, add a typed row), Cylinders from the
  catalogue, the rule with its explanation, results per Diver as a table with the controlling Diver marked, the briefing
  line, errors, rock bottom always shown, defaults marked, the disclaimer. "SAC on this dive" on the dive page.
  Inputs in the address. Units (L/min or cu ft/min, bar or psi); translations (en, de).
- MCP (ADR 0035): a `planning_gas_plan` tool (levels, Divers the User manages or typed SAC values) answering every
  Diver's pressures, the controlling Diver, the rule's explanation and the disclaimer.
- Tests: test-first for the engine (each rule against hand-computed values; matched thirds with mismatched cylinders;
  rock bottom per level where a shallower level binds; the group scenario's numbers; real gas at 232 and 300 bar);
  SAC per Dive (the formula, the exclusions, the percentile, few Dives); privacy (another User's Diver: typed only,
  nothing read); API tests; browser tests (@tools, @dives); ui-quality cases (a group, a level that doesn't fit, a
  default SAC, thirds chosen).
- Docs: ADR 0033 and 0032 (amend with what changed while building), data model, glossary (no longer planned),
  architecture (slice 22), clients.md (the gas plan's duties), index.md; mark this prompt done.

Rules:
- Skills first (AGENTS.md); the searches on 2026-10-06 ("gas planning", "consumption", "team planning",
  "percentile statistics") found nothing.
- `pnpm check` while working, `pnpm check:full` before proposing a commit, review capture with REVIEW_AREAS=tools,dives;
  look at the screenshots.
- Commit only when I say so (on main, short subject, blank line, body).
- End with a short summary: what was built, what you checked, simplifications, what you need me to decide.
```
