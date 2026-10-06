---
title: Weight calculator (first tool of a dive planner)
summary: How much lead a Diver needs - the factors and their size (suit, body, water, cylinder at reserve, plate and BC), published rules of thumb (PADI, DAN, DUI), how logbooks record lead, suits, cylinders and feedback (Subsurface, UDDF, Submersion, MacDive, Diving Log, Shearwater, Garmin, Suunto, SSI, Deepblu, DiveJSON), existing calculators (Lead, Omni, Submersion's learned model), what SSI already holds; the estimator (the Diver's own well-weighted dives, adjusted by physics for water and cylinder, a rule of thumb when there is no history), the data it needs; decided (ADR 0031), with two implementation prompts (logging, then the estimate).
status: decided
date: 2026-10-06
---

# Weight calculator (first tool of a dive planner)

Asked by the project owner on 2026-10-06: tools that may later be combined into a **dive planner**, starting with a
**weight calculator** that suggests how much lead a Diver should carry, from three kinds of evidence:

1. a general estimate (rule of thumb) from the Diver's body and the conditions, as a starting point;
2. the Diver's own logged Dives with similar conditions and a logged weight;
3. a calculation from the buoyancy of every piece of equipment (possibly deferred or dropped if not worth the work).

## In the glossary's terms

- The tool answers, for **one Diver** and **planned conditions** (water type, exposure suit, Cylinders, BC or backplate,
  extras), "how much **lead** to carry", with a range and the reason. It is a calculation, not a record: nothing it says
  is a Dive value or a Revision until the Diver logs a Dive.
- It reads Dives of that Diver: the lead carried and how it felt (**weighting feedback**, new), the **exposure suit**
  (new), the **Cylinders** (in the data model, not built), the **water type of the Dive site** ([ADR 0025](../decisions/0025-ssi-site-import-and-site-water-type.md)),
  and later **Equipment uses** (in the data model, not built).
- It reads the **Diver**: body weight (new, personal data like the birth date in the data model).
- Touches: [data model](../spec/data-model.md) (Dive, Weight, Cylinder, Equipment item, Equipment use, Diver);
  [ADR 0003](../decisions/0003-own-data-model-uddf-as-adapter.md) (UDDF has `leadquantity`, `suittype`, `tankmaterial`);
  [ADR 0015](../decisions/0015-overrides-vocabulary-and-browser-tests.md) (lead, suit and Cylinders are the Dive's own values like
  notes, not Overrides; version and Revisions); [ADR 0025](../decisions/0025-ssi-site-import-and-site-water-type.md)
  (water is the site's, the computer's water setting is not the water); [ADR 0028](../decisions/0028-shared-divers-and-participants.md)
  (other Users see a Diver's name only, so body weight stays with the managing Users);
  [ADR 0030](../decisions/0030-importing-dives-from-providers.md) (SSI's weight and tank fields would join the fields an
  import fills and takes back three-way).
- **No accepted ADR is contradicted.** Two points need care rather than a new ADR:
  - ADR 0025 says the computer's water setting isn't the Dive's water. The calculator must not learn from a Dive's water
    unless its site says it; Dives without a site (or a site without a water type) count as "water unknown" (see the model).
  - ADR 0030 fixes the fields an import fills and compares (site, notes, buddies; start, duration, depths and water
    temperature on Dives without a Recording). Taking SSI's weight and tank would extend that list: an amendment to
    ADR 0030, decided when the slice is planned (decision D7).

## What determines the lead a diver needs

Required lead is the sum of every part's buoyancy at the moment that matters: **near the surface, at the end of the
dive, with the BC empty, lungs half full and the cylinder at reserve** (DAN: hover at 5 m with 35 bar in an AL80 and an
empty BC; PADI, DUI and Wikipedia say the same) [dan] [padi-blog] [wiki-weighting]. Buoyancy of a part = water density ×
its volume − its mass.

| Factor | Typical size | How predictable | Notes |
|---|---|---|---|
| **Exposure suit** | swimsuit 0–2 kg; 3 mm full 2–4 kg; 6–7 mm full + hood 6–9 kg; drysuit mostly the undergarment, often 8–15 kg in total | by type and thickness, roughly; ages and compresses | Biggest term that changes between dives. A 6 mm full suit is about 6 kg at the surface (≈1 kg per mm) [wiki-wetsuit]. It loses about 30 % of its lift in the first 10 m, made up with gas, not lead [wiki-weighting]. |
| **Body** (fat vs lean, lungs) | −2 to +6 kg between people of the same body weight | poorly from outside (fat 0.9, lean 1.1 kg/L); **constant for one person** | Why the person's own history beats any formula [alert-diver-eu]. |
| **Water** | 2.5 % of the total mass (diver + gear + lead): 2–3.5 kg between fresh and salt | physics | Sea ≈ 1025 kg/m³, fresh 1000 [wiki-seawater]. The often-quoted "+2–3 lb" is too little for an adult in full gear; SDI says 2–3 kg [sdi]. |
| **Cylinder at reserve** | AL80 ≈ +1 kg at 50 bar; steel 12 L ≈ −1.9 kg; steel 15 L ≈ −2.3 kg: about **3 kg between an AL80 and a 12 L steel** | physics, from material, size and the gas left | Gas weighs volume × pressure × 1.225 g: 12 L × 200 bar ≈ 2.9 kg [wiki-cylinder]. That gas is used up, so lead is chosen for the end. |
| **Backplate / BC** | steel plate ≈ −2 kg in water, aluminium ≈ −0.5 kg; padded jacket BC +0.5 to +2 kg | from the item | [scubadiving] [joescuba] |
| **Extras** (camera, lights, regulator) | usually under 1–2 kg | per item, rarely published | |

**Cylinder buoyancy at reserve** (computed from published empty values, seawater, minus = sinks; empty values from
Wikipedia's table [wiki-cylinder]; gas at 50 bar = volume × 50 × 0.001225 kg):

| Cylinder | Empty | Full (200–232 bar) | At 50 bar |
|---|---|---|---|
| Aluminium 11.1 L "AL80", 207 bar | +1.7 | −1.1 | **+1.0** |
| Aluminium 9 L "AL63" | +1.8 | −0.5 | +1.2 |
| Aluminium 13 L "AL100" | +1.4 | −1.8 | +0.6 |
| Steel 12 L, 200 bar | −1.2 | −4.2 | **−1.9** |
| Steel 15 L, 200 bar | −1.4 | −5.2 | −2.3 |
| Steel 16 L, 230 bar | −0.9 | −5.3 | −1.9 |

For cylinders not in a table: B = ρ_water × (m_dry / ρ_material + V_water) − m_dry − m_valve − m_gas, from the
datasheet's dry mass and water volume (steel ≈ 7850, aluminium ≈ 2700 kg/m³). The open-source *Lead* app does this for
about 20 Faber and Worthington cylinders [lead].

**Ranked by what matters for a calculator:** suit ≫ body ≈ cylinder ≈ water > plate/BC > extras. The body term is large
and can't be measured from outside, but it doesn't change between one Diver's dives. So history should carry the body,
and physics should carry the differences.

## Rules of thumb (strategy 1)

| Suit | PADI basic guideline (via *Lead*'s code, quoting PADI) | PADI blog 2024 | DAN 2014 |
|---|---|---|---|
| Swimsuit, skin | 0.5–2 kg | – | – |
| 3 mm one-piece | 5 % of body weight | 5 % | 5 % |
| 5 mm two-piece | 10 % | 10 % (5–7 mm) | 10 % (6 mm) |
| 7 mm + hood and boots | 10 % + 1.5–3 kg | | |
| Shell drysuit, light undergarment | 10 % + 1.5–3 kg | 15 % or more | |
| Shell drysuit, heavy undergarment | 10 % + 3–7 kg | | |
| Neoprene drysuit | 10 % + 3–5 kg | | |

Corrections: the tables assume **salt water and an AL80** (add ≈2 kg for an aluminium cylinder compared with steel;
fresh water: remove 2.5 % of the total mass, *Lead*'s fit −(0.0263 × BW + 0.76) kg) [lead] [padi-blog] [dan] [dui]
[scubadiving]. **None of the agency tables uses height, body fat or sex**; only *Lead*'s own correction does
(fat mass from height, age and sex). **No study validates any of these against measured weights** (none found in DAN,
NOAA or journal searches); *Lead* calls itself unvalidated and says a weight check stays necessary.

So: a rule of thumb is a fair **first** guess (±2–3 kg) for a Diver with no history; it can't be better than that
without the body term.

## How others record it (strategy 2 needs these fields)

| Product / format | Lead | Suit | Cylinder | Feedback | Suggests a weight |
|---|---|---|---|---|---|
| Subsurface [ss-equipment] | list of {kg, free-text type}; types integrated, belt, ankle, backplate, clip-on | free text | size, working pressure, name (no material) | – | fills the **last weight used for that type name** |
| UDDF 3.2 [uddf-lead] [uddf-suit] [uddf-tank] | one `leadquantity` per dive (kg) | `suittype`: dive-skin, wet-suit, dry-suit, hot-water-suit, other; no thickness | material (aluminium, steel, carbon), volume; no working pressure | – (`thermalcomfort` only) | – |
| **Submersion** (GPL-3.0) [submersion] [submersion-design] | list of {type, kg, label}; presets | gear items (wetsuit, drysuit, undersuit) | material, volume, working pressure | **felt right / overweighted / underweighted + kg** | **learned model**: personal + gear terms by ridge regression, tank and water by physics, "based on N dives" |
| MacDive, Diving Log 6/7, Suunto DM5 [ss-macdive] [ss-divinglog] | one number | free text (Diving Log) | name, size, working pressure, doubles | – | – |
| Shearwater Cloud [submersion-shearwater] | one value | "Dress" (wet/dry) | size, "Apparatus" (single, doubles) | thermal comfort only | – |
| Garmin Dive app, Suunto app [garmin-forum] [suunto-forum] | not found; suit fields removed (Garmin) / missing (Suunto) | | | – | – |
| Deepblu [deepblu] | "Weights" | type + thickness | volume + material | – | – |
| DiveJSON 1.0 [divejson] | one kg value (`0` = no lead, not unknown); a gear set's weight | gear type | volume only | – | – |
| Garmin FIT [fit-profile] | – | – | pressures, volume used; no size or material | – | – |
| **SSI** (our own records, below) | one total (kg, lb) | none for scuba | volume, a type ID | – | – |

**What SSI already holds** (counted in the 129 SSI dives of the development database on 2026-10-06; counts only):
`odin_user_log_weight_kg` on **45**, `_tank_vol_l` (12 or 15 L) on 21, `_var_tanktype_id` (two values, 19 and 20, meaning
not yet looked up in `get_divelog_vars`) on 19, start and end pressure on 13, the gear list (`_gear`, IDs of SSI's gear
records) on 5, and `_gear_details` free text on 4, where people write lead and placement themselves ("6KG Blei",
"2x2 Tasche 2x 1 trimm"). No scuba suit field at all (only `x_odin_user_log_frd_suit`, freediving). So an SSI import can
bring the lead and cylinder for a good part of a logbook, but never the suit.

**Patterns worth taking:** lead as placed entries with a total (PADI asks for "amount and distribution" [padi-log]);
`0` means no lead; feedback per dive with an optional amount (only Submersion has it, and without it history says what
was carried, not what was needed); cylinder material + volume + working pressure together; suit type + thickness; named
gear sets. **Nobody fills:** feedback in any exchange format; placement in UDDF or DiveJSON (Subsurface sums it).

## Existing calculators

- **Lead** (tmaret/lead, Apache-2.0, Cordova, last commit 2019) [lead]: both a PADI-table mode and a full Archimedes
  model (body volume from sex, age, height and weight; suit volume from body surface × coverage × thickness; cylinders from
  datasheets; water density from salinity and temperature). Its aim matches ours: keep the perfect weighting in the
  logbook and "evaluate the equivalent amount of weight in different conditions". Same licence as Dive Hub, so its
  tables and gear data could be used with attribution in `NOTICE`.
- **Submersion** (submersion-app/submersion, GPL-3.0, active) [submersion-design]: `predicted = personal + Σ gear +
  Σ tank + water`. Tank and water by physics (tank near empty at the safety stop, water scaled by total displaced mass);
  personal and gear terms learned by ridge regression over the Diver's dives (target: lead carried corrected by feedback,
  1 kg when no amount; "felt right" counts double; half weight every two years; outliers beyond 3σ down-weighted); priors
  from body weight × percentage and from gear buoyancy the User entered; placement split from the last 10 dives with the
  same suit; confidence high/medium/low, "based on N dives"; zero history = an improved rule of thumb. Deferred there:
  suit compression, community gear data, asking Users to backfill old dives. **GPL-3.0: ideas only, no code or data.**
- Web calculators (Omni, divemasteraustin, swimmingregimen, divebeginner) and iOS's Buoyancy Calc: rule-of-thumb
  sums with ranges; inputs are body weight, water, suit, tank, sometimes body fat or "prior weight"; formulas mostly not
  disclosed; one review says it "always overweights" [omni] [swimmingregimen] [divebeginner] [buoyancy-calc].

## Proposed estimator (own thoughts)

The owner's three strategies are not three tools: they are **one estimate with three kinds of evidence**, and each fills
what the others lack. History knows the body; physics knows the differences between dives; the rule of thumb covers the
Diver with no history.

### The terms

    lead needed = personal (body + suit as worn) + cylinder at reserve + water + gear differences

- **Physics terms** (no learning): the cylinder's buoyancy at the reserve pressure (from the table above or its
  datasheet; the reserve is the Diver's own typical end pressure from logged Cylinders, else 50 bar), and the water term
  (2.5 % of total mass between fresh and salt, brackish halfway, a configurable density later).
- **Personal term**: everything else, learned from the Diver's history, per suit set-up.

### Anchor and adjust (recommended first version)

1. **Candidates:** the Diver's Dives (not deleted) with lead logged (0 counts), the **same suit set-up** (type,
   thickness, hood; drysuit + undergarment), and the water known from the site.
2. **What each needed:** lead carried, corrected by its feedback (too heavy by x kg → carried − x; no amount → 1 kg).
3. **Normalise** each to reference conditions by removing its physics terms (its cylinder at reserve, its water):
   the remainder is that dive's personal term.
4. **Combine** the personal terms: a weighted median (felt right ×2, no feedback ×1, half weight every two years); the
   spread gives the range.
5. **Plan:** personal term + the planned cylinder at reserve + the planned water → rounded to 0.5 kg (1 lb).
6. **Explain it:** "8 kg on your 4 dives with the 7 mm suit and a 12 L steel in fresh water; salt water +2.5 kg;
   AL80 instead of steel +2.9 kg → 13.5 kg (12.5–14.5)", each dive linkable.
7. **No dive with that suit:** the rule of thumb for the suit, shifted by how far the Diver's history differed from the
   rule of thumb for the suits they did log (their personal offset); with no history at all, the rule of thumb alone
   (needs body weight), low confidence.

Why not Submersion's regression first: with a handful of dives per suit and no Equipment items in Dive Hub, ridge
regression learns little the median doesn't, and it's harder to explain ("why 9.5?"). Anchor and adjust works from one
dive and every number can be traced to a dive or a formula. Regression is the natural step **once Equipment items with
buoyancy exist** (strategy 3), when many gear combinations share a few dives.

### Strategy 3 (equipment physics), honestly

A pure equipment sum can't stand alone: the body term (−2 to +6 kg between people) isn't knowable from height and weight
with any validated method, so a full Archimedes model (*Lead*'s) is no better than the rule of thumb. What physics
**does** well is the *difference* between two set-ups, and for the parts that change most often (cylinder, water) that
needs no Equipment items at all, only the Cylinder's material, size and pressure. So:

- **Keep** physics for cylinder and water (cheap: a small cylinder table, two densities).
- **Defer** buoyancy per Equipment item (suit, plate, BC, camera) until Equipment items are built for their own reasons
  (service records, gear per Dive); then it enters as gear differences (a steel plate instead of an aluminium one, −1.5 kg).
- **Don't build** a body model.

### Safety

The estimate is a starting point. The page must say to do a weight check (float at eye level with an empty BC; neutral at
5 m with the cylinder at reserve) and never present the number as certain; the range and its reason are always shown.
Overweighting is the common error, and a calculator that "always overweights" (a review of one app) is worse than none.

## Data model (planned, not built)

- **Lead on a Dive** (the data model's *Weight*): one or more entries `(amount kg, placement)`, placement `belt`,
  `integrated`, `trim`, `ankle`, `backplate`, `other` or unknown; the total is their sum; **no entries = unknown, one entry
  of 0 = no lead**. The Dive's own value (like notes), part of its version, a Revision (`lead`). UDDF: total as
  `leadquantity`. SSI: total as `weight_kg`. *(D1)*
- **Weighting feedback on a Dive:** `right`, `too_heavy`, `too_light`, with an optional amount in kg; the Dive's own,
  a Revision. Not in UDDF, SSI or FIT; kept only here (exports can put it in notes later). *(D3)*
- **Exposure suit on a Dive:** type (`none`, `skin`, `wetsuit`, `semidry`, `drysuit`), thickness (mm, wetsuit and semidry),
  hood (yes/no), undergarment for a drysuit (`light`, `medium`, `heavy`); later a link to an Equipment item instead.
  UDDF's `suittype` holds the type. *(D2)*
- **Cylinder** (in the data model): per Dive, volume (L), working pressure, material (`aluminium`, `steel`, `carbon`),
  start and end pressure, gas; one or more. FIT tank pods give pressures (and volume from message 147, later); SSI gives
  one cylinder's volume, a type ID and pressures. A **cylinder catalogue** of common sizes (AL80, S80, steel 10/12/15 L,
  twins) with their empty buoyancy, defined in code like vocabularies, so picking "AL80" fills volume, pressure and
  material. *(D5)*
- **Body weight of a Diver:** dated values (`diver_body_weight`: Diver, date, kg), seen and set only by the Users who
  manage the Diver, never by others (ADR 0028), deleted with the Diver. The rule of thumb uses the latest; the water term
  uses it for the total mass. *(D4)*
- **The estimate itself is not stored.** It is computed on request (`GET /api/divers/{id}/lead-estimate` with the planned
  conditions) and shown with its reason. A planned dive (dive planner, later) may keep the conditions and the estimate.
- **What Providers and imports see:** an SSI import fills lead (as one entry, placement unknown) and the cylinder (volume,
  pressures; material once the type IDs are known) where empty, and takes them back three-way like the other fields
  (amends ADR 0030's field list); sending to SSI can send the total lead and cylinder (today `null`), which changes the
  Push fingerprint, so every sent Dive with lead would show "changed since sent" once: send them only after a decision
  *(D7)*. UDDF import and export map `leadquantity`, `suittype`, `tankmaterial`/`tankvolume`. Feedback stays here.
- **Migrations** (described): a table for lead entries (dive, amount, placement, position); feedback and amount columns on
  `dive`; suit columns on `dive` (type, thickness, hood, undergarment); a `cylinder` table (dive, position, volume,
  working pressure, material, start/end pressure, O₂/He); `diver_body_weight`. All additions; existing Dives get nothing
  (unknown).

### Scenario: Tim's holiday in Egypt

Tim logs with a 7 mm suit and a 12 L steel cylinder in Lake Constance (fresh water). On 6 dives he carried 8 kg; three
felt right, one "too heavy, 1 kg". He plans a week in the Red Sea with a 5 mm suit and an AL80.

- No dive with a 5 mm suit: the estimate uses the rule of thumb for 5 mm (10 % of 82 kg = 8.2 kg, salt water, AL80),
  shifted by Tim's personal offset from his 7 mm dives (rule: 10 % + 2 = 10.2 kg salt/AL80 → fresh/steel −2.9 −2.8 ≈ 4.5 kg;
  he needs 7.8 kg: offset +3.3 kg), so ≈ 11.5 kg, range ±2 kg, low confidence, "no dives with a 5 mm suit yet".
- After the first dive Tim logs 10 kg, "too heavy, 2 kg". The next estimate for that set-up is anchored on it: 8 kg,
  medium confidence, "based on 1 dive".
- Stress points: a dive without a site has no water type (ADR 0025) and is left out, not guessed from the computer's
  water setting; a rented cylinder logged only as "12 L" without material is used with a "material unknown" note and
  the steel/aluminium difference widens the range; a dive imported from SSI with lead but no suit is used only once
  the suit is filled in (the page can list such dives to complete).

## Decisions

All made by the owner on 2026-10-06, each as recommended; written down as [ADR 0031](../decisions/0031-lead-suit-cylinders-and-lead-estimate.md).

| | Question | Decided (2026-10-06) |
|---|---|---|
| D1 | Lead on a Dive | Placed entries (belt, integrated, trim, ankle, backplate, other; placement optional) with their total; none = unknown, 0 = no lead |
| D2 | Exposure suit | A per-Dive value now (type, thickness, hood, drysuit undergarment); an Equipment item link later |
| D3 | Weighting feedback | Right / too heavy / too light, with an optional amount in kg |
| D4 | Body data | Body weight only, dated, seen only by the managing Users |
| D5 | Cylinders | The full Cylinder (several per Dive, pressures, gas), filled from a catalogue in code |
| D6 | Strategy 3 | Physics for cylinder and water only; gear buoyancy deferred until Equipment items exist; no body model |
| D7 | Providers | SSI imports fill lead and the cylinder and take them back three-way (amends ADR 0030); sending them waits |
| D8 | Where it lives | A Tools page (the dive planner's later home) and a hint on the dive form |
| D9 | Estimator | Anchor and adjust (weighted median of same-suit dives, feedback-corrected, normalised by physics); regression later |
| D10 | Term | **Lead** (_German_ Blei), not "weight" |
| D11 | Less typing | A "Same as last dive" action; nothing filled automatically |
| D12 | Slices | Logging first (A), the estimate second (B) |

### Still to check
- **SSI's tank type IDs** 19 and 20 (`odin_user_log_var_tanktype_id`): their names in `get_divelog_vars` (material?), before
  the import takes a material. Until then the cylinder comes in without one.
- **The rule-of-thumb numbers** against PADI's printed table (only seen through *Lead*'s code and PADI's blog), and the
  fresh-water band table quoted without its source.
- **Brackish density:** halfway (≈1012 kg/m³) until a site can say better.
- **Real feedback:** whether "1 kg when no amount" fits the owner's own dives once a season is logged.

## Slices

1. **Slice A (18): logging lead, suit, Cylinders and feedback.** Needs nothing new; gives the estimate its history and the
   SSI import 45 weights at once. Smallest thing to learn from: whether Users log feedback at all.
2. **Slice B (19): the lead estimate and the Tools page.** Needs A's values (and some dives logged with them).
3. **Later:** Equipment items (gear per Dive, service records) → gear buoyancy as differences and regression; sending lead
   and Cylinders to SSI; gas planning on the same Cylinders and the Recordings' SAC; the dive planner combining the tools
   around a planned dive.

## Sources

- [dan] DAN Alert Diver, "Weight Up!", 2014: https://dan.org/alert-diver/article/weight-up/
- [padi-blog] PADI blog, "Why Diving Overweighted Is a Bad Idea", 2024: https://blog.padi.com/diving-overweighted/
- [padi-log] PADI blog, "How to log a dive": https://blog.padi.com/how-to-log-a-dive/
- [dui] DUI, "Weighting for Drysuits": https://www.divedui.com/pages/weighting-for-drysuits
- [sdi] SDI, "The Most Accurate Weight Check": https://www.tdisdi.com/sdi-diver-news/the-most-accurate-weight-check/
- [scubadiving] Scuba Diving, buoyancy calculator article: https://www.scubadiving.com/buoyancy-calculator-how-figure-out-how-much-weight-you-need-scuba-diving
- [wiki-weighting] Wikipedia, Diving weighting system: https://en.wikipedia.org/wiki/Diving_weighting_system
- [wiki-wetsuit] Wikipedia, Wetsuit: https://en.wikipedia.org/wiki/Wetsuit
- [wiki-cylinder] Wikipedia, Diving cylinder (buoyancy table, gas mass): https://en.wikipedia.org/wiki/Diving_cylinder
- [wiki-seawater] Wikipedia, Seawater: https://en.wikipedia.org/wiki/Seawater
- [alert-diver-eu] Alert Diver Europe, body composition: https://alertdiver.eu/en_US/articles/body-composition/
- [joescuba] Dive Rite stainless backplate: https://joescuba.com/product/dive-rite-backplate-stainless-steel/
- [lead] tmaret/lead (Apache-2.0): https://github.com/tmaret/lead, PADI table: https://github.com/tmaret/lead/blob/master/www/js/app/guidelines/PadiBasic.js
- [submersion] submersion-app/submersion (GPL-3.0): https://github.com/submersion-app/submersion
- [submersion-design] Submersion weight prediction design, 2026-07-11: https://github.com/submersion-app/submersion/blob/main/docs/superpowers/specs/2026-07-11-weight-prediction-design.md
- [submersion-shearwater] Submersion, Shearwater Cloud import design: https://github.com/submersion-app/submersion/blob/main/docs/superpowers/specs/2026-03-27-shearwater-cloud-import-design.md
- [ss-equipment] Subsurface `core/equipment.h`, `qt-models/weightmodel.cpp`: https://github.com/subsurface/subsurface/blob/master/core/equipment.h, https://github.com/subsurface/subsurface/blob/master/qt-models/weightmodel.cpp
- [ss-macdive] Subsurface MacDive import: https://github.com/subsurface/subsurface/blob/master/xslt/MacDive.xslt
- [ss-divinglog] Subsurface Diving Log import: https://github.com/subsurface/subsurface/blob/master/core/import-divinglog.cpp
- [uddf-lead] UDDF `leadquantity`: https://www.streit.cc/extern/uddf_v321/en/leadquantity.html
- [uddf-suit] UDDF `suittype`: https://www.streit.cc/extern/uddf_v321/en/suittype.html
- [uddf-tank] UDDF `tankmaterial`: https://www.streit.cc/extern/uddf_v321/en/tankmaterial.html
- [divejson] DiveJSON spec: https://github.com/divejson/divejson/blob/main/spec/divejson.md
- [fit-profile] Garmin FIT JavaScript SDK profile: https://github.com/garmin/fit-javascript-sdk
- [garmin-forum] https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-dive-ios/353235/type-of-dive-suit-missing
- [suunto-forum] https://forum.suunto.com/topic/13268/dive-log-missing-many-standard-fields
- [deepblu] https://academy.deepblu.com/manually-create-edit-dive-log/
- [omni] https://www.omnicalculator.com/sports/scuba-weight
- [swimmingregimen] https://swimmingregimen.com/tools/scuba-diving-weight-calculator
- [divebeginner] https://divebeginner.com/weight-calculator/
- [buoyancy-calc] https://apps.apple.com/us/app/id1482332472

## Prompt A: logging lead, suit, Cylinders and feedback (slice 18)

```text
We're continuing Dive Hub. Everything you need is in this repository; read it first and don't rely on any
local memory (AGENTS.md Rule #1).

Task: slice A of the weight calculator - Dives record lead, weighting feedback, the exposure suit and Cylinders;
Divers keep dated body weights; SSI imports fill lead and the cylinder. As decided in ADR 0031 and
docs/research/2026-10-06-weight-calculator.md. Everything is decided; don't re-litigate it. Ask me before building
only if something in the code makes it harder than it looks.

Read first:
- AGENTS.md, CLAUDE.md, docs/index.md, docs/skills.md, docs/glossary.md (Lead, Weighting feedback, Exposure suit,
  Cylinder, Body weight)
- ADR 0031 (this design), 0030 (import fills and three-way, amended by 0031), 0015 (Dive values, version, Revisions,
  vocabulary), 0025 (water is the site's), 0028 (who sees what of a Diver), 0003 (UDDF mapping), 0023 (checks)
- docs/research/2026-10-06-weight-calculator.md (the model, "Still to check"), docs/spec/data-model.md (Dive, Lead,
  Cylinder, Diver body weight, scenario 5), docs/spec/clients.md (Dives, Importing dives from a Provider, Divers),
  docs/references/ssi-app-api.md (the dive record), docs/spec/architecture.md (slices 15-16)
- Code: apps/server/src/db/schema.ts (dive, diver), src/dives/ (dive-service.ts, dive-values.ts, revisions.ts,
  routes.ts), src/vocabulary.ts, src/divers/ (diver-service.ts, routes.ts), src/providers/ (dive-import.ts, three-way.ts,
  ssi/ssi-import.ts, ssi/ssi-record.ts), apps/web/src/ (DiveDetail.tsx, DiveEditForm.tsx, DiveHistory.tsx,
  DiversPage.tsx, lib/units.ts), apps/server/test/ (ssi-dive-import.test.ts, three-way.test.ts, fake-ssi.ts)

Build:
- Server:
  - Lead entries (dive, position, amount kg, placement belt/integrated/trim/ankle/backplate/other or null); the total is
    their sum; no entries = unknown, one entry of 0 = no lead. Weighting feedback (right, too_heavy, too_light) and its
    optional amount on the dive. Exposure suit on the dive (type none/skin/wetsuit/semidry/drysuit, thickness mm, hood,
    undergarment light/medium/heavy for a drysuit). Cylinders (dive, position, volume L, working pressure, material
    aluminium/steel/carbon, start/end pressure, O2/He). All are the Dive's own values: set with its version
    (409 dive_changed), one Revision per change with readable from/to, causes edit and fill.
  - A cylinder catalogue in code next to vocabulary.ts (AL80, S80, AL63, AL100, steel 7/10/12/15 L at 200/232/300 bar,
    twin 12 L, ...; volume, working pressure, material, empty buoyancy in seawater with its source), published in the API.
  - "Same as last dive": a route answering the Diver's previous Dive's suit, Cylinders (without pressures) and lead, for
    the form to copy; nothing is written by it.
  - Body weight per Diver, dated (diver_body_weight), only for the Users who manage the Diver; deleted with it.
  - The SSI import fills lead (one entry, no placement) and the cylinder (volume, start/end pressure; no material until
    the tank type IDs are known: look them up in get_divelog_vars if you can, else leave material empty) where empty,
    and takes them back three-way (three-way.ts fields, compared in SSI's precision). Nothing is sent to SSI (no
    fingerprint change).
  - Migrations generated and reviewed (additions only). Regenerate packages/api-client.
- Web: on the dive page and form - lead (entries with placement, the total shown), how it felt, the suit, Cylinders
  (pick from the catalogue or type), "Same as last dive"; history lines; body weight on the Diver's page (managed
  Divers only, saying who sees it); metric/imperial (kg/lb, L/cu ft, bar/psi) through lib/units.ts; translations
  (en, de: Blei, Tauchanzug, Flasche).
- MCP (ADR 0035): the Dive tools return lead, feedback, suit and Cylinders; the Diver tool returns body weight
  (managed Divers only).
- Tests: test-first where it fits; lead totals (unknown vs 0), Revisions and version; the catalogue's values; the SSI
  fill and three-way for lead and cylinder (fake SSI with weights and tanks); body weight hidden from other Users;
  browser tests with area tags (@dives, @divers); ui-quality cases for every new state (no lead logged, no lead, a
  drysuit, several Cylinders).
- Docs: ADR 0031 (amend with what changed while building), data model (built), glossary (no longer planned),
  architecture (slice 18), clients.md (the new Dive values, units, body weight privacy, the import's new fields), the SSI
  reference (tank type IDs), index.md; mark this prompt done.

Rules:
- Skills first (AGENTS.md); the search on 2026-10-06 (dive planner, scuba, buoyancy, calculator) found nothing.
- `pnpm check` while working, `pnpm check:full` before proposing a commit, review capture with
  REVIEW_AREAS=dives,divers; look at the screenshots.
- Commit only when I say so (on main, short subject, blank line, body).
- End with a short summary: what was built, what you checked, simplifications, what you need me to decide.
```

## Prompt B: the lead estimate and the Tools page (slice 19)

```text
We're continuing Dive Hub. Everything you need is in this repository; read it first and don't rely on any
local memory (AGENTS.md Rule #1).

Task: slice B of the weight calculator - a lead estimate for a Diver and planned conditions, on a new Tools page and
as a hint on the dive form. As decided in ADR 0031 and docs/research/2026-10-06-weight-calculator.md ("Proposed
estimator", the scenario "Tim's holiday in Egypt"). Slice A (lead, feedback, suit, Cylinders, body weight) is built.
Everything is decided; don't re-litigate it. Ask me before building only if something makes it harder than it looks.

Read first:
- AGENTS.md, CLAUDE.md, docs/index.md, docs/skills.md, docs/glossary.md (Lead, Lead estimate, Weighting feedback)
- ADR 0031, 0025 (water from the site only), 0028 (body weight stays with managing Users), 0014 (units), 0023 (checks)
- docs/research/2026-10-06-weight-calculator.md (factors, the rule-of-thumb table, the estimator, safety, sources),
  docs/spec/data-model.md (scenario 5), docs/spec/clients.md, docs/spec/design-system.md
- Code from slice A (lead, Cylinders, the catalogue, body weight), src/dives/water.ts, apps/web/src/App.tsx (routes),
  DiveEditForm.tsx

Build:
- Server: src/lead/estimate.ts, pure and unit-tested: physics (cylinder buoyancy at reserve from the catalogue or its
  values, reserve = the Diver's median logged end pressure else 50 bar; water 1000/1025, brackish 1012, on body weight
  + gear + lead), the rule of thumb (PADI percentages per suit, salt water and an AL80), anchor and adjust (same suit
  set-up, water known from the site, feedback-corrected with 1 kg when no amount, normalised, weighted median with
  "felt right" x2 and a two-year half-life, the range from the spread, a personal offset when no dive has that suit),
  rounded to 0.5 kg / 1 lb. GET /api/divers/{id}/lead-estimate with the planned conditions: total, range, basis (dives
  with links, rule of thumb), each adjustment, what was missing (no body weight, material unknown). Nothing stored.
- Web: a Tools page (a navigation entry; the dive planner's later home) with the calculator: the Diver, water, suit,
  Cylinders (catalogue), the answer with its range, the dives it rests on, each adjustment, and the weight-check advice
  always visible; a hint on the dive form ("last time with this suit: 8 kg, felt right"); translations (en, de).
- MCP (ADR 0035): a `planning_lead_estimate` tool with the same inputs, answering the range, its reasons and the
  weight-check advice in every result.
- Tests: test-first for estimate.ts (scenario 5's numbers, unknown water left out, 0 lead, feedback amounts, no history
  with and without body weight, imperial rounding); API tests (only managing Users); browser tests (@tools, @dives)
  and ui-quality cases (no history, rule of thumb only, based on N dives).
- Docs: ADR 0031 (amend), data model, glossary, architecture (slice 19), clients.md (the estimate's duties: range,
  reasons, the weight-check advice, never presented as certain), index.md; mark this prompt done.

Rules:
- Skills first (AGENTS.md): search again only for areas not searched before.
- `pnpm check` while working, `pnpm check:full` before proposing a commit, review capture with
  REVIEW_AREAS=tools,dives; a new page gets its path in scripts/check.mjs and an area tag.
- Commit only when I say so (on main, short subject, blank line, body).
- End with a short summary: what was built, what you checked, simplifications, what you need me to decide.
```

