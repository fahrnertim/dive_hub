---
title: Dive assessment - findings on a logged dive
summary: Automatic checks on a logged Dive that point out improvement potential with the measured value, the threshold, its source and how strong the evidence is - ascent rate and the last metres, safety stop, gas left, NDL margin and ceilings, oxygen, sawtooth, reverse profiles, surface intervals and days in a row, flying, depth stability, descent; what the evidence says (often less than diver lore: reverse profiles, deep stops, headaches), what computers record (Garmin's dive alerts), how logbooks present it (Subsurface colours, Submersion's findings and trends, scores in new apps), implementation details and pitfalls; the model; decided (ADR 0036) with the prompt for slice 18.
status: decided
date: 2026-10-06
---

# Dive assessment - findings on a logged dive

Asked by the project owner on 2026-10-06: analyse a Dive for improvement potential and show possible problems, solutions
and recommendations, e.g. the profile's smoothness ("constant depth changes can cause headaches"), "deepest part first,
not at the end", gas left at the end, the safety stop's length; find out what makes a good dive and define thresholds
that can be checked.

## In the glossary's terms

- A **dive assessment** of one **Dive**: **findings** computed from its **Primary recording**'s samples (depth,
  temperature, the computer's NDL, ppO₂, CNS, ascent rate, events), its **Cylinders** (slice 19) and the Diver's other Dives
  that day and week. Each finding names the rule, the measured value, the threshold with its source and evidence, the
  stretch of the profile, and a recommendation. The **computer's own events** (Garmin's dive alerts) are shown beside them,
  not merged.
- What Dive Hub already keeps (checked 2026-10-06 on the owner's Mk3 file): samples every 1–2 s with `depth`,
  `temperature`, `ndl`, `cns`, `n2`, `tts`, `nextStopDepth/Time`, `ascentRate`, `po2`; events with their type and data
  (four `dive_alert` events on that dive); the summary's GF, gases, CNS. SSI's computer dives have 5 s samples.
- Touches: [ADR 0015](../decisions/0015-overrides-vocabulary-and-browser-tests.md) (vocabulary; the Primary recording),
  [ADR 0016](../decisions/0016-recording-decisions-and-divers.md) (several Recordings), [ADR 0026](../decisions/0026-deleting-dives.md)
  (deleted Dives count nowhere), [ADR 0030](../decisions/0030-importing-dives-from-providers.md) (Dives without a
  Recording, offsets unknown), [ADR 0031](../decisions/0031-lead-suit-cylinders-and-lead-estimate.md) (weighting feedback),
  [ADR 0032](../decisions/0032-mod-and-no-decompression-limits.md) (the ZHL-16C module, safety wording),
  [ADR 0033](../decisions/0033-gas-plans-rules-and-groups.md) (gas rules, SAC per Dive), [ADR 0035](../decisions/0035-mcp-connector.md)
  (MCP tools carry their disclaimers).
- **No accepted ADR is contradicted.** New ground: Dive Hub would judge a logged dive, which needs wording rules like
  ADR 0032's for planning.

## What the evidence says

Labels: **EXP** experiment (mostly Doppler bubbles, a stand-in for DCS), **EPI** observational data, **CASE** case
series, **CONS** consensus workshop, **RULE** agency, navy or maker rule, **OP** opinion. DCS is rare (about 3 in 10,000
dives in DAN's Project Dive Exploration) and **most cases happen within the algorithm's limits** (97.5 % of 320 DAN
Europe cases at a surfacing GF ≤ 1.0) [pde] [cialoni-2017]. So checks describe **decompression stress and practice**;
they can't call a dive safe or unsafe.

| Topic | What the sources say | Strength | Diver lore that's wrong or overstated |
|---|---|---|---|
| **Ascent rate** | US Navy 9 m/min (30 ft/min, since ~1993); Bühlmann plans 10; 17 m/min gave more bubbles than 9 [carturan-2002]; the slowest ascent (3 m/min, no stop) gave the **most** bubbles, 10 m/min with a stop the fewest [marroni-2004]. Computers: Garmin alerts above 9.1 m/min for > 5 s [garmin-alerts], Suunto above 10 for 5 s [suunto-ascent]. BSAC: last 6 m in at least a minute [bsac-deco]. Embolism comes from holding the breath, not from the rate; 96 % of embolism deaths involved an emergency ascent [denoble-2008] | EXP + RULE | "18 m/min is fine" (outdated); "slower is always better"; "fast ascent = embolism" |
| **Safety stop** | 3 min at 3–6 m; stops cut bubbles by about an order of magnitude after bounce dives; beyond 3–5 min no further gain [bennett-2007]; 5 min when deeper than 30 m or the NDL fell under 5 min (Shearwater, DAN 2025) [dan-ndl] | EXP + RULE | "it's mandatory decompression"; "longer is always better" |
| **Deep stops** | NEDU 2011: moving stop time deeper **increased** DCS on air decompression dives (11 vs 3 cases) [nedu-2011]; for no-stop dives "probably do no harm", benefit unclear (Doolette) | EXP (DCS outcome) | "deep stops reduce DCS" |
| **Reverse profiles** | 1999 Smithsonian/DAN workshop: the ban "cannot be traced to any definite diving experience"; no reason to prohibit them for no-stop dives shallower than 40 m with depth differences under 12 m [reverse-1999]; the rule began in a 1974 manual as a way to get more table time [undercurrent-2000]; within one dive no outcome evidence found | CONS (absence of evidence) | "reverse profiles are dangerous" |
| **Sawtooth / yo-yo** | Instructors with DCS often had multiple ascents (case series) [walker-1992]; validated aquaculture yo-yo schedules (≤ 10 bounces at 13–15 m, slow ascents, a 3 min stop) had median bubble grade 0 [smart-2014]; BSAC: avoid sawtooth | CASE + RULE; field EXP contradicts | "sawtooth means DCS"; **no evidence-based threshold** |
| **Headaches** | DAN's causes: CO₂ retention (skip breathing), cold, tight mask or hood, sinus and ear barotrauma, jaw, neck, migraine, gas toxicity, DCI; **depth changes are not listed**, except through ear and sinus squeeze [dan-headache] | OP (DAN) | "constant depth changes cause headaches" |
| **Descent** | No outcome study; equalise early and often; ear and sinus barotrauma are the most common diving injuries [dan-equalise] | OP | – |
| **Depth stability** | No validated research metric; training standards: GUE Fundamentals ±1.5 m at 30° [gue-fundamentals]; small fluctuations have no shown decompression effect | RULE (training) | – |
| **Gas left** | 50 bar / 500 psi is a convention; insufficient gas was the most common trigger in 947 deaths (41 %) and in 63 % of embolism deaths [denoble-2008] | EPI + convention | – |
| **NDL margin, surfacing GF** | DAN 2025: risk rises near the NDL; DAN Europe: surfacing supersaturation (GF of the leading compartment) averaged 86.6 % in DCS dives vs 74.3 % in others, the strongest predictor in a 2026 model of 127,957 dives, but the distributions overlap [dan-europe-2026] | OP + EPI (population) | "within the NDL is safe" |
| **Oxygen** | NOAA limits (1.6 bar 45 min, 1.4 bar 150 min …); 1.4 working, 1.6 contingency [shearwater-cns] | RULE | – |
| **Surface intervals, days** | Longer intervals lower DCS odds (~6 % per hour) [dan-europe-2026]; no evidence-based minimum; BSAC: at most 3 dives a day, a break after 4 days of dives deeper than 30 m [bsac-deco]; bubbles **fall** over consecutive days [pollock-2014]; liveaboards had the lowest DCS rate in PDE [undercurrent-2005] | EPI (direction) + RULE | "take a day off after 3–4 days" (an agency rule, not outcome data) |
| **Flying** | DAN 2002: 12 h after one no-stop dive, 18 h after several dives or days, longer after decompression [dan-flying] | CONS | – |
| **Temperature** | Cold during the bottom phase and warm during decompression is best; warm-bottom, cold-deco worst (NEDU) [dan-thermal] | EXP (DCS outcome) | "cold water raises DCS" (timing matters) |
| **A "good dive" score** | No published diving safety index; probabilistic models exist for research [howle-2017]; a single score invites false reassurance | – | – |

## How others present it

| Product | Checks | Thresholds | Presentation | Trends | LLM |
|---|---|---|---|---|---|
| Garmin Descent + app [garmin-alerts] [fit-profile] | device alerts in FIT (`dive_alert`: ascent critical, safety stop broken/complete/started, NDL, ppO₂, CNS/OTU, ceiling); summary rates (max/avg ascent and descent) | 9.1 m/min > 5 s; ceiling +0.6 m | event timeline, graphs | – | – |
| Suunto app [suunto-app] | device alarms, ascent penalties, safety stops | 8/10 m/min, 5 s | events on the profile, a "feeling" rating | vague | – |
| Shearwater Cloud [shearwater-cloud] | none (graph, range statistics) | arrows 3 m/min each | graph, milestones | – | – |
| Subsurface [subsurface-profile] | none (visual) | ascent colours 1.5/4/9/18, descent 9/18/30 m/min | profile coloured by vertical speed, ruler, events | statistics | – |
| MacDive | fast-ascent highlight | not published | orange/red segments | – | – |
| **Submersion** (GPL-3.0) [sub-safety] [sub-observations] | rapid ascent (9/12 m/min, ≥ 3 m rise), missed deco (≥ 10 s, 0.5 m), omitted safety stop (> 10 m dives, 2–6.5 m credit), **sawtooth (4 teeth of 6 m; 3 × 3 m fired on a third of dives)**, surfacing GF, late gas switch | fixed in the engine, versioned | chips on a time lane under the profile, neutral wording, dismiss, per-rule switches | ranked sentences gated by ≥ 8 dives per period and effect size ≥ 0.5 | no |
| DiveCore, AfterDive, RheoDive (2026 apps) | a 0–100 score; LLM sentences without safety checks ("NOT DIVE SAFETY ADVICE"); AI DCS risk on a roadmap | not published | score, sentences | baselines | yes |

**Implementation details:** rates over a **time window** (15 s) so 1 s and 5 s data behave alike; Subsurface keeps a
fast segment fast while smoothing slow ones [subsurface-profile]; a single corrupt depth sample smeared by a centred
average looks like a fast ascent, so out-and-back spikes above ~60 m/min are interpolated first (never dropped) [sub-sanitizer];
sawtooth with a zigzag filter (a turn confirmed after reversing by the amplitude); safety stop only on dives deeper than
10 m, after the deepest point, segments within 30 s merged; a dive is split at ≥ 60 s at the surface [subsurface-split];
only the Primary recording's samples (interleaving computers made clock offsets look like ascents).

**Pitfalls:** false positives teach Users to ignore findings; medical framing ("dangerous", "DCS risk", a score);
thresholds the User tunes silently rewriting history; 5 s data missing short bursts; freediving and rebreathers need their
own rules or none.

## Model (proposal)

- **Rules** in a pure module, each with an id, a fixed threshold, its source and evidence label, and a version; the set has
  an **engine version**.
- **Finding:** Dive, Recording, rule, severity (`info`, `note`, `caution`), the profile stretch (start, end), the measured
  value(s), engine version. Text is rendered from these facts in the User's language and units.
- **Computed** when a Dive's Primary recording or its Cylinders change, kept per Dive, recomputed when the engine version
  changes; a User's **dismissals** and **muted rules** are kept per Diver.
- **Inputs:** the Primary recording's samples (cleaned of spikes, split at surface intervals), its gases, events, GF; the
  Dive's Cylinders; the Diver's Dives that day and the days before.
- **Shown:** under the profile, aligned to time; a mark on the dive list; the computer's events beside; the profile coloured
  by ascent rate. Every finding: what happened, the guidance with its source, how strong the evidence is, a
  recommendation, Dismiss. A fixed note: not medical advice; DCS can happen within limits; symptoms → DAN or emergency
  services.
- **Not done:** a score; symptom diagnosis; personal risk factors (sex, age, BMI, PFO).
- **Migrations:** `dive_finding` (and the engine version), `finding_dismissal`, muted rules per Diver.

### Scenario: Tim's Red Sea dive

Tim's Garmin dive: 28 m, 52 min, EAN32, a 2 min stop at 5 m, then 5 m to the surface in 20 s; between minute 30 and 40
he went from 14 m up to 4 m and back down to 16 m twice; end pressure 40 bar (Cylinder logged).

1. *Safety stop:* 2 min at 3–6 m (3 min recommended; 5 not needed: deepest 28 m, minimum NDL 9 min) → note.
2. *Last metres:* 5 m to the surface in 20 s (≈ 15 m/min; BSAC asks for a minute from 6 m) → note.
3. *Ascent rate:* 11 m/min for 25 s at 14 → 4 m → note ("faster than the 9–10 m/min tables and computers assume").
4. *Sawtooth:* two excursions of 10 m → none (the rule needs 4 of 6 m); the profile still shows them.
5. *Gas left:* 40 bar, under the usual 50 → caution, with the gas rules (ADR 0033).
6. *Garmin's own events:* "safety stop broken" at minute 49, shown beside the findings.
7. Tim dismisses the "last metres" note on this Dive; it stays dismissed here. Muting the rule would hide it on every
   Dive; the findings themselves stay as computed.

## Decisions

All made by the owner on 2026-10-06, each as recommended; written down as [ADR 0036](../decisions/0036-dive-assessment.md).

| | Question | Decided (2026-10-06) |
|---|---|---|
| X1 | Score | Findings with value, threshold, source, evidence and recommendation; **no score** |
| X2 | Checks | All four groups: profile practice; decompression and oxygen (surfacing GF with slice 21); gas left (with slice 19); shape and series |
| X3 | Thresholds | Fixed in the engine with their sources, versioned; Users dismiss findings or mute rules, never edit numbers |
| X4 | Display | Chips on a time lane under the profile, a mark in the dive list, the profile coloured by ascent rate; neutral wording |
| X5 | Computer events | Shown beside the findings ("your computer noted …"), not merged |
| X6 | Trends | Later, a slice of their own, with a statistical gate |
| X7 | Storage | Stored with the engine version, recomputed on change and after an engine change; dismissals and mutes per Diver |
| X8 | Order and MCP | Slice 18, after MCP; an MCP tool; the planned slices move to 19–23 |

### Still to check
- **Garmin's sensor noise** on the owner's files (whether a 15 s window is enough; what the Mk3's own `ascentRate` and its
  "ascent critical" events say against our rate).
- **What the four `dive_alert` events** on the owner's dive were (codes), to test the mapping.
- **Shearwater's and Mares' exact alarms** (not found); the US Navy manual's ascent tolerance; DAN Europe's 2026 paper
  (only summaries read); HSE RR214 on yo-yo diving (not reachable).
- **False positives** on the owner's logbook before shipping (Submersion's lesson): run every rule over all Dives and look
  at how many fire.

## Slices

1. **Slice 18: the dive assessment** (after the MCP endpoint): the rules that need only samples and the Diver's dives, the
   findings, the lane, the list mark, the coloured profile, the computer's events, the MCP tool. Smallest thing to learn
   from: how often each rule fires on the owner's logbook.
2. **Slice 19** (logging) adds gas left; **slice 21** (MOD and bottom time) adds the surfacing GF.
3. **Later:** trends; weighting feedback as a finding; apnea and rebreather rules.

## Sources

- [pde] DAN Project Dive Exploration: https://dan.org/?p=8509
- [cialoni-2017] Cialoni et al. 2017, DCS cases and gradient factors: https://pmc.ncbi.nlm.nih.gov/articles/PMC5610843
- [carturan-2002] Carturan et al. 2002, J Appl Physiol 93:1349: https://europepmc.org/abstract/MED/12235035
- [marroni-2004] Marroni et al. 2004, UHM 31:233: https://europepmc.org/abstract/MED/15485086
- [garmin-alerts] Garmin Descent Mk3, dive alerts: https://www8.garmin.com/manuals/webhelp/GUID-9183E86B-2399-4CFC-AB50-EAFC6D6ED326/EN-US/GUID-80F7A2DF-6152-44DE-991E-F8B94A097A82.html
- [suunto-ascent] Suunto D5, ascent rate: https://www.suunto.com/Support/Product-support/suunto_d5/suunto_d5/features/ascent-rate/
- [bsac-deco] BSAC Safe Diving, decompression: https://bsac.com/safety/safe-diving-guide/decompression
- [denoble-2008] Denoble et al. 2008, UHM 35:393: https://europepmc.org/abstract/MED/19175195
- [bennett-2007] Bennett et al. 2007, UHM: https://europepmc.org/abstract/MED/18251436
- [dan-ndl] DAN, A critical look at no-decompression limits (2025): https://dan.org/alert-diver/article/a-critical-look-at-no-decompression-limits/
- [nedu-2011] NEDU TR 11-06 (deep stops): https://www.johnchatterton.com/wp-content/uploads/2013/03/NEDU_TR_2011-06.pdf
- [reverse-1999] Reverse Dive Profiles workshop (Smithsonian, 1999): https://repository.si.edu/items/2929ad96-4e7c-47d7-bbc4-e80818002aaa/full
- [undercurrent-2000] Undercurrent 2000, "Do the deep dive first?": https://www.undercurrent.org/UCnow/dive_magazine/2000/DoDeepDiveFirst200005.html
- [walker-1992] Walker 1992, SPUMS J 22(2):66: https://www.dhmjournal.com/images/IndividArticles/22June/Walker_SPUMSJ.22.2.66-70.pdf
- [smart-2014] Smart et al. 2014, DHM 44:124: https://europepmc.org/abstract/MED/25311318
- [dan-headache] DAN, Headaches and diving: https://dan.org/?p=4601
- [dan-equalise] DAN tips on equalising (via PADI blog): https://blog.padi.com/10-tips-for-equalizing-ears/
- [gue-fundamentals] GUE Fundamentals standards v10.1: https://www.gue.com/files/Standards_and_Procedures/standards10/BasicFund-Standards-v10.1.pdf
- [dan-europe-2026] Alert Diver EU, DAN's DCS database deep dive (2026): https://alertdiver.eu/en_US/articles/dans-dcs-database-deep-dive/
- [shearwater-cns] Shearwater and the CNS oxygen clock: https://shearwater.com/blogs/community/shearwater-and-the-cns-oxygen-clock
- [pollock-2014] Bubbles over consecutive days, Int J Sports Med: https://europepmc.org/abstract/MED/23771833
- [undercurrent-2005] Undercurrent 2005, who gets bent (PDE): https://undercurrent.org/UCnow/dive_magazine/2005/WhoGets200505.html
- [dan-flying] DAN, flying after diving: https://dan.org/health-medicine/health-resource/health-safety-guidelines/guidelines-for-flying-after-diving/
- [dan-thermal] Alert Diver EU, hydration and temperature: https://alertdiver.eu/en_US/articles/could-optimising-a-divers-hydration-and-temperature-improve-their-decompression-safety/
- [howle-2017] Howle et al. 2017, PLoS ONE: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0172665
- [fit-profile] Garmin FIT SDK profile (dive_alert): https://raw.githubusercontent.com/garmin/fit-javascript-sdk/main/src/profile.js
- [suunto-app] Suunto, dive data in the app: https://www.suunto.com/en-tw/sports/News-Articles-container-page/diving-deeper-into-your-dive-data-in-the-suunto-app/
- [shearwater-cloud] Shearwater Cloud 2.11 notes: https://www.shearwater.com/release-notes/shearwater-cloud-update-2-11-0-graph-guide/
- [subsurface-profile] Subsurface `core/profile.cpp`: https://raw.githubusercontent.com/subsurface/subsurface/master/core/profile.cpp
- [subsurface-split] Subsurface `core/divelist.cpp` (split_dive): https://raw.githubusercontent.com/subsurface/subsurface/master/core/divelist.cpp
- [sub-safety] Submersion safety features design (GPL-3.0): https://github.com/submersion-app/submersion/blob/main/docs/superpowers/specs/2026-07-16-safety-features-design.md
- [sub-observations] Submersion derived observations design: https://github.com/submersion-app/submersion/blob/main/docs/superpowers/specs/2026-10-05-insights-derived-observations-design.md
- [sub-sanitizer] Submersion profile depth sanitizer: https://github.com/submersion-app/submersion/blob/main/lib/core/deco/profile_depth_sanitizer.dart

## Prompt: the dive assessment (slice 18)

```text
We're continuing Dive Hub. Everything you need is in this repository; read it first and don't rely on any
local memory (AGENTS.md Rule #1).

Task: the dive assessment - findings on every logged Dive from fixed, versioned rules, each with its measured value,
threshold, source, evidence and recommendation; no score; shown under the profile, marked in the list, the profile
coloured by ascent rate, the computer's own events beside them; an MCP tool. As decided in ADR 0036 and
docs/research/2026-10-06-dive-assessment.md. Slice 17 (MCP) is built. Everything is decided; don't re-litigate it.
Ask me before building only if something in the code makes it harder than it looks.

Read first:
- AGENTS.md, CLAUDE.md, docs/index.md, docs/skills.md, docs/glossary.md (Dive assessment, Finding, Primary recording,
  Recording, Dive)
- ADR 0036 (this design), 0015 (vocabulary, Primary recording), 0016, 0026 (deleted Dives), 0030 (Dives without a
  Recording), 0032 (safety wording), 0035 (MCP tools), 0018 (icons, motion), 0019 (tonal surfaces), 0023 (checks)
- docs/research/2026-10-06-dive-assessment.md (the evidence table with sources, thresholds, implementation details,
  pitfalls, scenario, "Still to check"), docs/spec/data-model.md (scenario 10), docs/spec/clients.md,
  docs/spec/design-system.md, samples/README.md
- Code: apps/server/src/fit/fit-adapter.ts (channels, events), src/dives/ (dive-service.ts, downsample.ts, routes.ts),
  src/imports/ (where Recordings change), the worker, src/mcp/ (slice 17), apps/web/src/ (DiveDetail.tsx,
  DepthProfile.tsx, DiveList.tsx, lib/profile.ts)

Build:
- Server:
  - A pure rules module (e.g. src/assessment/): cleaning (interpolate out-and-back spikes > 60 m/min, never drop),
    splitting at >= 60 s at the surface, rates over 15 s windows; the rules of ADR 0036 that need samples and the
    Diver's dives (ascent rate, last 6 m, safety stop, descent tip, stop stability, lowest NDL, ceilings, ppO2, CNS,
    sawtooth 4 x 6 m, reverse profile outside the 1999 envelope, short surface interval, dives per day, days in a row,
    no-fly information), each with id, threshold, source, evidence label, severity; an engine version.
  - dive_finding (Dive, Recording, rule, severity, start/end, values, engine version), finding_dismissal, muted rules per
    Diver; computed when a Dive's Primary recording changes (import, attach, primary change, restore) and in the worker
    after an engine version change; open-circuit scuba only; a Dive without a Recording gets the series checks only.
  - Garmin dive_alert codes mapped to our vocabulary as computer events; routes for a Dive's assessment, dismiss, mute;
    the dive list carries a findings count. MCP: logbook_get_dive_assessment with the sources and the fixed note.
    Migrations generated and reviewed; regenerate packages/api-client.
- Web: the findings lane under the profile (chips aligned to time, a tap highlights the stretch and opens the details:
  numbers, guidance with source, evidence, recommendation, Dismiss), the computer's events beside, the profile coloured
  by ascent rate (Subsurface's bands, with a legend and a text alternative), the list mark, muting a rule, the fixed
  not-medical-advice note; neutral wording; translations (en, de).
- Tests: test-first for every rule with synthetic profiles (a clean dive, a fast ascent, a short stop, a sawtooth of 3 x 3 m
  that must not fire and one of 4 x 6 m that must, a spike that must not become an ascent, 5 s sampling, a surface
  interval inside a dive, a reverse profile inside and outside the envelope); when samples/private/*.fit exist, run every
  rule over them and print how often each fires (look before shipping); API and MCP tests; browser tests (@dives);
  ui-quality cases (no findings, several findings, a dismissed one, a muted rule).
- Docs: ADR 0036 (amend with what changed while building, e.g. thresholds tuned on real dives with a new engine version),
  data model, glossary (no longer planned), architecture (slice 18), clients.md (the assessment's duties: facts with
  sources, the fixed note, no score, no medical claims), index.md; mark this prompt done.

Rules:
- Skills first (AGENTS.md); the search on 2026-10-06 ("time series analysis", "anomaly detection", "health
  recommendations", "rule engine") found nothing.
- `pnpm check` while working, `pnpm check:full` before proposing a commit, review capture with REVIEW_AREAS=dives; look
  at the screenshots.
- Commit only when I say so (on main, short subject, blank line, body).
- End with a short summary: what was built, what you checked (incl. how often each rule fired on real dives),
  simplifications, what you need me to decide.
```
