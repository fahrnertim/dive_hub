---
title: MOD and no-decompression limits (second planning tool)
summary: Tools for a planned dive's gas and time - MOD (with best mix, EAD, END) for any mix, and a bottom time (the no-decompression limit by Bühlmann ZHL-16C with gradient factors, capped by oxygen exposure and the gas in the cylinder). Formulas and limits, what dive computers use and their defaults, how planners present it (Subsurface, Shearwater, Garmin, Suunto, GasPlanner, Submersion), open implementations and their licences, test values, pitfalls, liability; what Dive Hub already holds (the computer's GF and NDL samples); decided (ADR 0032), with the prompt for slice 21.
status: decided
date: 2026-10-06
---

# MOD and no-decompression limits (second planning tool)

Asked by the project owner on 2026-10-06, after the [weight calculator](2026-10-06-weight-calculator.md): on the Tools
page, for a planned dive, the **bottom time / no-decompression limit (NDL)** and the **MOD** of a gas or mix.

## In the glossary's terms

- Two **Tools** ([ADR 0031](../decisions/0031-lead-suit-cylinders-and-lead-estimate.md)), calculations on request,
  nothing stored, no Revisions:
  - **MOD** of a **gas mix** (O₂ and He fractions) at a ppO₂ limit, with the related numbers divers plan with (best mix
    for a depth, EAD, END).
  - **Bottom time** for a planned depth, gas mix and **Cylinder**: the shortest of three limits: the **no-decompression
    limit** (a decompression model with the Diver's **gradient factors**), the **oxygen exposure** (CNS), and the **gas**
    in the Cylinder (the Diver's SAC, a reserve). The tool says which one binds.
- It reads, where Dive Hub has them: the Diver's dive computer settings on their **Recordings** (deco model, GF low and
  high, water setting and density: `summary.decoModel`, `gfLow`, `gfHigh`, `waterType`, `waterDensity`; gases `o2`/`he`),
  the computer's own **NDL samples** (series `ndl`), CNS start and end; and (planned, ADR 0031) the **Cylinder
  catalogue**. Later the Diver's SAC (FIT carries it; Dive Hub doesn't keep it yet) and the tissue state of recent Dives.
- Touches: [ADR 0031](../decisions/0031-lead-suit-cylinders-and-lead-estimate.md) (Tools, Cylinders and their gas);
  [ADR 0025](../decisions/0025-ssi-site-import-and-site-water-type.md) (the site's water type is fresh, salt or brackish;
  computers use EN 13319, 1020 kg/m³, which is a setting, not water); [ADR 0015](../decisions/0015-overrides-vocabulary-and-browser-tests.md)
  (deco model and gas circuit are vocabulary); [ADR 0003](../decisions/0003-own-data-model-uddf-as-adapter.md) (UDDF
  `decomodel`, `gasdefinitions`); [ADR 0020](../decisions/0020-dive-sites.md) (sites have no altitude);
  [ADR 0006](../decisions/0006-license-apache-2-and-fit-parser.md) (Apache-2.0: no GPL code).
- **No accepted ADR is contradicted.** New ground: Dive Hub would for the first time give advice a diver may act on
  under water, which needs its own rules for wording and limits (decision G9).

## Formulas and limits

**Pressure and depth.** Ambient pressure `P = Psurf + d / (m per bar)`; m per bar = 1 / (ρ·g / 10⁵): fresh (1000 kg/m³)
10.197 m, EN 13319 (1020) 9.997 m, salt (1025) 9.948 m [en13319] [subsurface-salinity]. The "10 m per bar" of tables is
a convention; 10.33 m is one *atmosphere* of fresh water. Surface pressure from altitude: `Psurf = 1.01325 ×
(1 − 2.25577·10⁻⁵ × h)^5.25588` bar (standard atmosphere).

**MOD** = `(ppO₂max / FO₂ − Psurf) × m per bar` [wiki-mod]. EAN32 at 1.4: 33.4 m salt, 33.6 m EN 13319, 34.3 m fresh;
tables print 34 m (`10 × (1.4/0.32 − 1)` = 33.75) [padi-nitrox]. **ppO₂ limits:** 1.4 bar working and 1.6 contingency
(or deco) by most agencies and NOAA; GUE plans 1.2–1.3; minimum 0.16 (0.18 at the surface marks a mix hypoxic) [gue]
[tdi]. Primary agency sources for SSI, NAUI, BSAC and CMAS weren't found; 1.4/1.6 is the common pair.

**Other gas numbers** [wiki-end]:

| | Formula (10 m/bar form) |
|---|---|
| Best mix for a depth | `FO₂ = ppO₂max / (d/10 + 1)` |
| EAD (nitrox) | `(d + 10) × FN₂/0.79 − 10` |
| END, O₂ narcotic | `(d + 10) × (1 − FHe) − 10` |
| END, O₂ not narcotic | `(d + 10) × FN₂/0.79 − 10` |

Agencies disagree whether O₂ is narcotic: GUE, PADI, BSAC, CMAS count it, TDI, IANTD, NAUI don't; END limits are about
30 m [dan-narcosis].

**Oxygen exposure** (NOAA, 4th ed.) [shearwater-cns]: single-exposure limit 45 min at 1.6, 120 at 1.5, 150 at 1.4,
180 at 1.3, 210 at 1.2, 240 at 1.1, 300 at 1.0 (…720 at 0.6); CNS % = Σ minutes / limit, linear between rows. OTU =
`t × ((ppO₂ − 0.5)/0.5)^0.83` [hamilton]. **It can bind before the NDL:** EAN40 at 30 m (ppO₂ 1.6) has an NDL of about 49
min (GF 100) but a 45-minute oxygen limit; EAN50 at 22 m about 370 min against 45.

## No-decompression limits

**Model.** Bühlmann **ZHL-16C** with **gradient factors** is what Garmin, Shearwater, newer Suunto and Mares use [suunto-ocean]
[garmin-manual]. Its coefficients are published (Bühlmann, *Tauchmedizin*; Baker, *Understanding M-values*) [baker-mvalues]
[wiki-buhlmann]: 16 compartments, N₂ half-times 5 (1b), 8, 12.5, 18.5, 27, 38.3, 54.3, 77, 109, 146, 187, 239, 305, 390,
498, 635 min, with a and b per compartment (He too). Gas uptake by Haldane (constant depth) and Schreiner (changing
depth); water vapour 0.0627 bar. Gradient factors (Baker) [baker-deepstops]: tolerated `Pamb = (Pt − GF·a)/(GF/b − GF + 1)`.
**For a no-stop dive only GF high matters** (GF 20/100 and 100/100 differ by a minute at 20 m) [theoretical-diver]
[cmas-gf].

**Not usable:** RGBM (Suunto, Mares; proprietary), PADI's RDP/DSAT (proprietary tables), VPM-B (a deco model, nothing for
NDL). The US Navy Rev 7 air table (Thalmann VVal-79, US government work) is a fair sanity band [usn-rev7].

**Default conservatism of computers:**

| Computer | Model | Default GF / presets |
|---|---|---|
| Garmin Descent | ZHL-16C + GF | presets 45/95, **40/85**, 35/75 (from a forum post; the manual doesn't list them) [garmin-forum] |
| Shearwater | ZHL-16C + GF | changing to Rec 50/75, 50/85, 50/95, Tec 50/70 (was 30/70) [shearwater-downloads] |
| Suunto Ocean | Bühlmann 16 GF | **40/85** (presets 45/95, 35/75) [suunto-ocean] |
| Subsurface planner | ZHL-16 (C values) + GF | 30/75 [subsurface-pref] |

A DHM 2023 study found low GF low no safer for air dives [deridder] (summary only). Garmin's FIT file records the GF
as `gf_low`/`gf_high` in `dive_settings`, which Dive Hub already keeps on each Recording.

**How much the choices move the NDL** (air, minutes; GasPlanner's tests, MIT, include the descent, floored) [gasplanner-tests]:

| Depth | 12 m | 15 m | 18 m | 21 m | 24 m | 27 m | 30 m | 33 m | 36 m | 39 m | 42 m |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GF 100, fresh | 195 | 94 | 61 | 43 | 30 | 23 | 17 | 14 | 11 | 9 | 9 |
| GF 100, salt | 173 | 87 | 57 | 40 | 28 | 21 | 16 | 13 | 10 | 9 | 8 |
| GF 40/85, fresh | 134 | 72 | 45 | 30 | 21 | 16 | 13 | 10 | 8 | 7 | 7 |
| US Navy Rev 7 (60/100 ft ≈ 18/30 m) | | | 63 | | | | 25 | | | | |
| PADI RDP (unconfirmed metric) | | | 56 | | | | 20 | | | | |

Other things that change it: whether the limit is "the ceiling rises above the surface now" (*actual*) or credits the
off-gassing during a direct ascent (*with ascent*: 30 m air 16 vs 19 min in dive-deco's tests [dive-deco-tests];
Subsurface's manual says 22); whether descent counts; flooring vs rounding; water density; surface pressure (altitude:
0.9 bar takes 18 m from 63 to 59 min); compartment 1 at 4 or 5 min.

**A clean-room check (2026-10-06):** a 40-line script written only from the published coefficients and formulas (in the
session's scratchpad, not committed) gave the GasPlanner values within **0 to +2 minutes, always longer**. That is the
unsafe side: the implementation must find the difference (descent rate, N₂ fraction 0.7902 vs 0.79, compartment 1) and be
equal to or shorter than the reference, never longer. The same script gave EAN32, salt water, GF 85: 77 min at 18 m,
19 min at 30 m (to be checked against a second implementation).

## How planners present it

| Product | NDL | Gas-limited time | Repetitive dives | CNS / OTU | MOD, END, best mix | Disclaimer |
|---|---|---|---|---|---|---|
| Subsurface (GPL-2.0) [subsurface-manual] [subsurface-notes] | recreational mode stretches the bottom time to the NDL | reserve (40 bar), minimum gas (SAC × factor) | from logged profiles, back to a 48 h gap | both | through ppO₂ limits | "received only a limited amount of testing … strongly recommend not to plan dives simply based on the results" |
| Shearwater (on the computer) [shearwater-teric] | NDL table by depth, with the best gas | GTR to reserve (air integration) | current tissues and CNS | CNS | best gas per depth | "does not check … the user is responsible" |
| Garmin Descent [garmin-manual] | NDL for a depth, or depth for a time; MOD shown, red beyond it | from SAC/RMV | current tissues or an entered interval | logged | pO₂/O₂ %/depth solver (water setting) | manual notes |
| Suunto D5 [suunto-d5] | yes | gas time to start − 35 bar (25 L/min default) | residual N₂ | – | – | – |
| GasPlanner / Dugong (MIT, web) [gasplanner] | NDL table | reserve from a stressed-RMV ascent | entered | both | MOD, END, nitrox, trimix | "at your own risk" |
| Submersion (GPL-3.0) [submersion] | yes, and **the computer's NDL beside the model's** | rock bottom | seeded from the log | both | MOD, best mix, MND | – |
| MultiDeco, GUE DecoPlanner, Baltic | deco planners for technical divers | yes | – | yes | yes | "experienced mixed-gas … ONLY" |

**Gas-limited time:** consumption at depth = SAC (L/min at the surface) × P; time = (gas above the reserve − gas for the
ascent and safety stop) / consumption [wiki-gas-planning]. Defaults: Subsurface 20 L/min and 40 bar, Suunto 25 L/min and
35 bar, "50 bar is often used". A diver's own SAC from logged dives: FIT's `dive_summary` has `avg_volume_sac`,
`avg_rmv`, `avg_pressure_sac`; else gas used / mean ambient pressure / duration (Subsurface) from a Cylinder's pressures
and volume (ADR 0031).

**Repetitive dives:** computers carry their tissues; planners replay logged profiles (Subsurface back to a 48 h gap).
Rebuilt from a logbook, the state is too low when a dive is missing, sampled coarsely, or logged by another computer, and
DAN finds "little agreement among various computers with regard to repetitive dives with short surface intervals"
[dan-validation]. Flying after diving: DAN 12 h (one no-stop dive), 18 h (repetitive or several days) [dan-flying].

## Implementations and licences

- **Usable (MIT):** jirkapok/GasPlanner `scuba-physics` (TypeScript, active, large test suite; Angular peer dependency, not
  on npm) [gasplanner]; KG32/dive-deco (Rust, MIT, active) [dive-deco]. Readable references and **test oracles**; code
  could be ported with the MIT notice kept.
- **New and untried:** dive-math (MIT, 2026-09), dive-deco-ts (ISC, v0.0.2).
- **Not to copy** (Apache-2.0 project): Subsurface (GPL-2.0), Submersion (GPL-3.0), Abysner (AGPL-3.0), DecoTengu and
  dipplanner (GPL-3.0). Their published outputs can still be compared against.
- The formulas themselves are short: MOD, EAD, END, best mix, CNS, OTU and gas time are a few lines each; ZHL-16C with GF
  and an NDL search is ~100 lines plus tests.

## What Dive Hub already has

- **The Diver's computer settings** on every FIT Recording: deco model (`zhl16c`), GF low/high, water setting and
  density, gases (O₂, He). So the tool can start from "the GF your Garmin uses" instead of a generic default.
- **The computer's own NDL** in the samples, every few seconds, for every logged dive. That is a **test oracle Dive Hub has
  that most planners don't**: recompute the NDL along a logged profile with the same GF and compare with what the computer
  showed (Submersion shows both side by side).
- **Not kept yet:** SAC/RMV and OTU from FIT's `dive_summary` (the summary is JSON; adding fields needs no migration, but
  older Recordings need their Originals read again, as for positions in ADR 0020), surface pressure, a site's altitude.

## Model (proposal)

- **A pure module** (`src/planning/` or similar): pressure, MOD, best mix, EAD, END, CNS, OTU, gas time, ZHL-16C with GF
  and the NDL. Clean-room from Bühlmann's and Baker's published values, cited; tested against GasPlanner and dive-deco
  values and the US Navy band, and against the owner's logged dives' NDL samples.
- **Routes** (computed, nothing stored): MOD and gas numbers for a mix; bottom time for depth, gas, GF, water, altitude,
  Cylinder and SAC, answering each limit (NDL, oxygen, gas), which one binds, and the assumptions.
- **Defaults from the Diver:** GF from the latest Recording that has it, else a stated default; SAC from logged dives when
  known; water from the planned site's water type; altitude from the planned site later.
- **Data:** none stored for the tools. The Recording summary gains FIT's SAC/RMV and OTU (no migration; a backfill
  reads Originals again). Settings a User picks on the page live in the address (as the logbook's do, ADR 0017).
- **Providers and imports:** nothing new (SSI gives one gas and a GF string, which isn't taken: [SSI reference](../references/ssi-app-api.md)).

### Scenario: Tim's Red Sea dive

Tim plans 30 m on EAN32 with an AL80 at the Red Sea. His Garmin's Recordings say GF 40/85.

1. **MOD:** 33.4 m at 1.4 (salt water), 39.7 m at 1.6. 30 m is fine; at 30 m his ppO₂ is 1.29.
2. **NDL:** about 19 min at GF 85 (to be confirmed by the tests); the page says GF 85 came from his computer.
3. **Oxygen:** ppO₂ 1.29 → about 180 min limit; not binding.
4. **Gas:** 11.1 L at 200 bar, reserve 50 bar, SAC 18 L/min from his logged dives: about 72 L/min at 30 m → about 20 min
   after the ascent gas. **Gas and NDL bind together**; the page says both.

Stress points: a dive at a site without a water type (choose one, default salt and say so); a lake at 900 m (needs the
altitude, else the NDL is too long); a Diver whose computer isn't a Garmin (no GF on the Recording → the default); Tim dived
two hours ago (the clean-tissue NDL is too long: the page must say so).

## Decisions

All made by the owner on 2026-10-06, each as recommended; written down as [ADR 0032](../decisions/0032-mod-and-no-decompression-limits.md).

| | Question | Decided (2026-10-06) |
|---|---|---|
| G1 | What bottom time covers | The shortest of NDL, oxygen (CNS) and gas (SAC, Cylinder, reserve, ascent gas), saying which binds |
| G2 | Gases | MOD, best mix, EAD, END for any mix incl. trimix; the NDL only for air and nitrox 21–40 % |
| G3 | Repetitive dives | Clean tissues; a warning when the Diver logged a Dive in the last 48 h; rebuilding from the log later |
| G4 | Conservatism | The GF of the Diver's latest Recording that has one, else GF high 85; editable, its origin shown |
| G5 | NDL definition | Actual: until a ceiling rises above the surface at GF high, descent (18 m/min) included, floored |
| G6 | Implementation | Own clean-room module; GasPlanner and dive-deco (MIT) as test oracles; never longer than they are |
| G7 | Water and altitude | Salt, fresh or EN 13319 (default from the site, brackish as salt, else salt) and an optional altitude |
| G8 | ppO₂ and END | MOD at 1.4 and 1.6, editable; END counts O₂ as narcotic by default, switchable |
| G9 | Limits and wording | No-stop only, at most 40 m; the estimate's assumptions and a disclaimer always visible; DAN's flying text, no countdown |
| G10 | Validation | Tests against the owner's logged Garmin dives' NDL samples now; the comparison on the dive page later |
| G11 | SAC | FIT's SAC/RMV and OTU kept on Recordings (backfill); default the median of recent dives, else 20 L/min; editable |
| G12 | Order | One slice 21, after the weight calculator's 17 and 18 |

### Still to check
- **Why the clean-room sketch ran 0–2 min longer than GasPlanner** (descent rate, N₂ fraction, compartment 1, the
  moment the limit is taken); the implementation resolves it before anything ships.
- **Garmin's GF presets** (40/85 from a forum post, not the manual) only matter for the wording; the Recordings carry the
  real values.
- **PADI's metric RDP values** and the agencies' own ppO₂ limits weren't found in primary sources; neither is used.
- **How Garmin's computer computes its NDL** (with or without ascent credit), which decides how close the logged-dive test
  can be: measure the difference on the owner's files and set the tolerance from it.

## Slices

1. **Slice 21: MOD and bottom time** (after slices 19 and 20 of the [weight calculator](2026-10-06-weight-calculator.md)):
   the module, the backfill of FIT's SAC/RMV/OTU, the two tools on the Tools page. Smallest thing to learn from: how far
   our NDL and the owner's Garmin agree on logged dives.
2. **Later:** the model beside the computer's NDL on the dive page; tissues rebuilt from the log (repetitive dives) once
   that comparison is good; sites with an altitude; trimix NDLs; gas planning with turn pressures; a planned dive that
   combines lead, gas and time.

## Sources

- [en13319] Subsurface commit on EN 13319 density: https://platform-test.sunet.se/mifr/subsurface/commit/7a9214575e4b8124995fb6e8edf2895a19f4170d
- [subsurface-salinity] Subsurface `core/deco.cpp`: https://github.com/subsurface/subsurface/blob/master/core/deco.cpp
- [wiki-mod] Wikipedia, Maximum operating depth: https://en.wikipedia.org/wiki/Maximum_operating_depth
- [padi-nitrox] PADI blog, What is nitrox: https://blog.padi.com/what-is-nitrox/
- [gue] InDepth, Standard gases: https://indepthmag.com/standard-gases-the-advantages-of-having-everyone-singing-the-same-song/
- [tdi] TDI, trimix: https://www.tdisdi.com/tdi-diver-news/trimix-75m/
- [wiki-end] Wikipedia, Equivalent narcotic depth: https://en.wikipedia.org/wiki/Equivalent_narcotic_depth
- [dan-narcosis] DAN Europe, narcosis and training agencies: https://alertdiver.eu/en_US/articles/rapture-of-the-tech-depth-narcosis-and-training-agencies
- [shearwater-cns] Shearwater and the CNS oxygen clock: https://shearwater.com/blogs/community/shearwater-and-the-cns-oxygen-clock
- [hamilton] Hamilton, REPEX, SPUMS J 27(1): https://www.dhmjournal.com/images/IndividArticles/27March/Hamilton_SPUMSJ.27.1.43-47.pdf
- [wiki-buhlmann] Wikipedia, Bühlmann decompression algorithm: https://en.wikipedia.org/wiki/B%C3%BChlmann_decompression_algorithm
- [baker-mvalues] Baker, Understanding M-values: https://indepthmag.com/wp-content/uploads/2019/10/Baker-Understanding-mvalues.pdf
- [baker-deepstops] Baker, Clearing up the confusion about deep stops: https://www.shearwater.com/wp-content/uploads/2012/08/Deep-Stops.pdf
- [theoretical-diver] NDL and gradient factors: https://thetheoreticaldiver.org/wordpress/index.php/2019/01/18/ndl-and-gradient-factors/
- [cmas-gf] CMAS, gradient factors fact sheet: https://www.cmas.org/fact-sheets/gradient-factors-gf-and-dive-computers.html
- [usn-rev7] US Navy Rev 7 tables: https://www.divetable.info/workshop/USN_Rev7_Tables.pdf
- [suunto-ocean] Suunto Ocean algorithm settings: https://www.suunto.com/Support/Product-support/suunto_ocean/suunto_ocean/scuba-diving/algorithm-settings/
- [garmin-manual] Garmin Descent Mk3 manual: https://www8.garmin.com/manuals/webhelp/GUID-9183E86B-2399-4CFC-AB50-EAFC6D6ED326/EN-US/Descent_Mk3_Series_OM_EN-US.pdf
- [garmin-forum] Garmin forum, Descent conservatism settings: https://forums.garmin.com/outdoor-recreation/outdoor-recreation-archive/f/descent-mk1/153891/decent-conservatism-settings
- [shearwater-downloads] Shearwater downloads (GF presets): https://www.shearwater.com/downloads/other-downloads/
- [shearwater-teric] Shearwater Teric manual: https://cdn.shopify.com/s/files/1/0838/3732/1530/files/Teric_Manual-metric_2021.pdf
- [subsurface-pref] Subsurface `core/pref.cpp`: https://github.com/subsurface/subsurface/blob/master/core/pref.cpp
- [subsurface-manual] Subsurface user manual: https://github.com/subsurface/subsurface/blob/master/Documentation/user-manual.txt
- [subsurface-notes] Subsurface `core/plannernotes.cpp`: https://github.com/subsurface/subsurface/blob/master/core/plannernotes.cpp
- [deridder] DeRidder et al., gradient factors, DHM 2023: https://www.dhmjournal.com/images/IndividArticles/53Sept/DeRidder_GradientFactors_2023-1972.pdf
- [gasplanner] jirkapok/GasPlanner (MIT): https://github.com/jirkapok/GasPlanner
- [gasplanner-tests] GasPlanner no-deco tests: https://github.com/jirkapok/GasPlanner/blob/master/projects/scuba-physics/src/lib/algorithm/BuhlmannAlgorithm.nodeco.spec.ts
- [dive-deco] KG32/dive-deco (MIT): https://github.com/KG32/dive-deco
- [dive-deco-tests] dive-deco tests: https://github.com/KG32/dive-deco/blob/main/tests/buhlmann_tests.rs
- [submersion] submersion-app/submersion (GPL-3.0): https://github.com/submersion-app/submersion
- [suunto-d5] Suunto D5 dive planner: https://www.suunto.com/Support/Product-support/suunto_d5/suunto_d5/use/how-to-plan-a-dive-using-the-dive-planner/
- [wiki-gas-planning] Wikipedia, Scuba gas planning: https://en.wikipedia.org/wiki/Scuba_gas_planning
- [dan-validation] DAN, Validation of dive computers: https://dan.org/alert-diver/article/validation-of-dive-computers/
- [dan-flying] DAN, flying after diving: https://dan.org/?p=1838

## Prompt: MOD and bottom time (slice 21)

```text
We're continuing Dive Hub. Everything you need is in this repository; read it first and don't rely on any
local memory (AGENTS.md Rule #1).

Task: the second planning tool - MOD and gas numbers for any mix, and a bottom time for a planned dive (the shortest
of the no-decompression limit, the oxygen limit and the gas), on the Tools page. As decided in ADR 0032 and
docs/research/2026-10-06-gas-and-ndl-tools.md. Slices 19 (Cylinders and their catalogue) and 20 (the Tools page) are
built. Everything is decided; don't re-litigate it. Ask me before building only if something in the code makes it
harder than it looks - and stop and ask if the NDL comes out longer than a reference value and you can't find why.

Read first:
- AGENTS.md, CLAUDE.md, docs/index.md, docs/skills.md, docs/glossary.md (MOD, Gas mix, No-decompression limit,
  Gradient factors, Bottom time, Oxygen exposure, SAC, Tools, Cylinder)
- ADR 0032 (this design), 0031 (Tools page, Cylinders, catalogue), 0025 (water type of a site vs the computer's
  setting), 0020 (backfill by reading Originals again), 0017 (settings in the address), 0014 (units), 0006 (licence),
  0023 (checks)
- docs/research/2026-10-06-gas-and-ndl-tools.md (formulas, coefficients and their sources, the test values, pitfalls,
  "Still to check", scenario "Tim's Red Sea dive"), docs/spec/data-model.md (Recording summary, scenario 6),
  docs/spec/clients.md, docs/spec/design-system.md, samples/README.md
- Code: apps/server/src/fit/fit-adapter.ts (summary, dive_settings, the ndl series), src/vocabulary.ts, the slice-18
  Tools page and lead estimate (server and web), the cylinder catalogue, src/dives/water.ts, apps/web/src/lib/units.ts

Build:
- Server:
  - A pure module (e.g. src/planning/): pressure from depth, water density and altitude (standard atmosphere); MOD,
    best mix, EAD, END (O2 narcotic or not), hypoxic check; NOAA CNS (linear between rows) and OTU; ZHL-16C N2 with
    Haldane/Schreiner, water vapour 0.0627 bar and gradient factors; the actual NDL (descent at 18 m/min included,
    floored, no ascent credit); gas time (SAC x P, reserve, gas for a direct ascent and a 3-minute stop at 5 m).
    Clean-room: from Bühlmann's and Baker's published values, cited in the code; no GPL code (Subsurface,
    Submersion). Bottom time = min(NDL, oxygen, gas) and which binds; air and nitrox 21-40 % only, no-stop only, at
    most 40 m and the MOD (else "outside recreational limits").
  - Routes (computed, nothing stored): gas numbers for a mix; bottom time for depth, mix, GF, water, altitude,
    Cylinder, SAC and reserve, answering each limit, which binds, the assumptions, and whether the Diver logged a Dive
    in the last 48 h. Defaults: GF from the Diver's latest Recording with one (else GF high 85), SAC the median of the
    Diver's recent Recordings' FIT SAC (else 20 L/min), water from the site (brackish as salt, else salt), reserve 50 bar.
  - FIT: keep dive_summary avg_volume_sac, avg_rmv and o2_toxicity on the Recording summary; backfill older Recordings
    by reading their Originals again once in the background (as ADR 0020's positions). Regenerate packages/api-client.
- Web: on the Tools page, "Gas" (mix, ppO2 limits, MOD at both, best mix for a depth, EAD, END with the O2 switch) and
  "Bottom time" (depth, mix, Cylinder from the catalogue, SAC, reserve, water, altitude, GF with where it came from;
  the answer with each limit and which binds, OTU; the recent-dive warning). The assumptions and the disclaimer are
  always visible (estimate, the computer and training govern, model and settings used; DAN's flying text). Inputs
  kept in the address. Units through lib/units.ts; translations (en, de).
- MCP (ADR 0035): `planning_gas_numbers` and `planning_bottom_time` tools whose every result carries the limits, the
  assumptions and the disclaimer (never a bare number; "outside recreational limits" as such).
- Dive assessment (ADR 0036): the surfacing GF rule (ZHL-16C at 100/100 along the profile: > 80 % note, > 90 % caution,
  "decompression stress", thresholds of our own, said so), with a new engine version.
- Tests: test-first for the module: formulas against hand-computed values (MOD of EAN32 in salt, fresh, EN 13319, at
  altitude); NDL against GasPlanner's published values (fresh, salt, GF 40/85) and dive-deco's, equal or shorter and
  within the stated tolerance; the US Navy Rev 7 air table as a band; CNS binding (EAN40 at 30 m); gas binding
  (scenario 6). When samples/private/*.fit exist: recompute the NDL along each logged profile with that file's GF and
  compare with the computer's ndl samples (measure Garmin's difference, set the tolerance from it, write it down).
  API tests; browser tests (@tools); ui-quality cases (each limit binding, outside recreational limits, recent dive).
- Docs: ADR 0032 (amend with what changed while building, e.g. the tolerance found), data model, glossary (no longer
  planned), architecture (slice 21), clients.md (the tools' duties: assumptions and disclaimer always visible, which
  limit binds, never a number beyond 40 m or the MOD), samples/README.md (the NDL cross-check), index.md; mark this
  prompt done.

Rules:
- Skills first (AGENTS.md); the search on 2026-10-06 ("decompression", "diving", "nitrox", "physiology",
  "safety critical", "medical calculator") found nothing.
- `pnpm check` while working, `pnpm check:full` before proposing a commit, review capture with REVIEW_AREAS=tools;
  look at the screenshots.
- Commit only when I say so (on main, short subject, blank line, body).
- End with a short summary: what was built, what you checked (incl. how our NDL compared with the Garmin's), simplifications,
  what you need me to decide.
```
