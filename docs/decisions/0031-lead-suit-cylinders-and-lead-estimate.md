---
title: "ADR 0031: Lead, exposure suit, Cylinders and weighting feedback on Dives; a lead estimate from the Diver's own dives"
summary: Dives record lead as placed entries with a total, how the weighting felt (right, too heavy, too light, with an optional amount), the exposure suit as a Dive value, and full Cylinders filled from a catalogue in code; Divers keep dated body weights seen only by their managing Users. A lead estimate (first tool of a later dive planner, on a Tools page and as a hint while logging) anchors on the Diver's dives with the same suit and adjusts by physics for cylinder and water; a rule of thumb covers no history; no body model, gear buoyancy deferred. SSI imports fill lead and the cylinder (amends 0030); sending them waits. Logging first (slice A), the estimate second (slice B).
status: accepted
date: 2026-10-06
---

# ADR 0031: Lead, exposure suit, Cylinders and weighting feedback on Dives; a lead estimate from the Diver's own dives

## Status
Accepted – 2026-10-06. Amends [ADR 0030](0030-importing-dives-from-providers.md) (the fields an import fills and takes
back gain lead and the cylinder). Not built yet. Designed in the [weight calculator note](../research/2026-10-06-weight-calculator.md).

## Context
The owner wants tools that may later form a **dive planner**, starting with a weight calculator fed by a rule of thumb,
the Diver's own similar dives, and the buoyancy of each piece of equipment. The research found:
- Required lead is set at the end of a dive (near the surface, BC empty, cylinder at reserve). The terms, largest first: the
  exposure suit (0–15 kg), the body (−2 to +6 kg between people of the same weight, constant for one person), the cylinder
  at reserve (about 3 kg between an AL80 and a 12 L steel), the water (2.5 % of total mass), plate and BC, extras.
- Rules of thumb (PADI, DAN, DUI: 5 % of body weight for 3 mm, 10 % for 5–7 mm, more for a drysuit; salt water and an AL80
  assumed) are fair to ±2–3 kg and validated by no study. No height-, fat- or sex-based body model is validated either.
- Most logbooks keep one lead number and no feedback. Subsurface keeps placed entries; only Submersion (GPL-3.0) keeps
  feedback and learns an estimate. SSI's records hold a total weight on 45 of the 129 dives in the development database and
  a tank on about 20, but no scuba suit.
- Dive Hub records none of it yet: the data model plans Weight, Cylinder and Equipment items, none built.

The owner chose on 2026-10-06 the recommendation for each of the note's decisions D1–D12.

## Decision

### What a Dive records (slice A)
- **Lead** (_German_ Blei; glossary term, not "weight", which is the body's): one or more entries `(amount, placement)`,
  placement `belt`, `integrated`, `trim`, `ankle`, `backplate`, `other`, or none given. The total is their sum. **No entries
  means unknown; one entry of 0 means no lead.** Exports and Providers get the total.
- **Weighting feedback:** `right`, `too_heavy` or `too_light`, with an optional amount in kg. Kept only here (no exchange
  format has it).
- **Exposure suit**, a Dive value: type (`none`, `skin`, `wetsuit`, `semidry`, `drysuit`), thickness in mm (wetsuit,
  semidry), hood (yes/no), drysuit undergarment (`light`, `medium`, `heavy`). Linking it to an Equipment item comes when
  those exist.
- **Cylinders** as the data model plans them: per Dive one or more, each with volume, working pressure, material
  (`aluminium`, `steel`, `carbon`), start and end pressure and gas. A **catalogue in code** (like the vocabularies of
  ADR 0015: AL80, S80, steel 10, 12 and 15 L, twin 12 L, …, each with its empty buoyancy) fills the values when picked;
  any value can be typed instead.
- All four are the **Dive's own values** (like notes, not Overrides): part of its `version` and set with it, each change
  a Revision.
- **"Same as last dive"**: one action copies suit, Cylinders (without pressures) and lead from the Diver's previous Dive
  into the form. Nothing is ever filled without the User doing it, so history holds only what was logged.

### What a Diver records
- **Body weight**, dated (`diver_body_weight`: Diver, date, kg). Seen and set only by the Users who manage the Diver,
  never by others ([ADR 0028](0028-shared-divers-and-participants.md)); deleted with the Diver. No height, sex or age.

### Providers (amends ADR 0030)
- An import from a Provider **fills** lead (one entry, no placement) and the Cylinder (volume, pressures; material once
  SSI's tank type IDs are known) where the Dive has none, and takes them back three-way like the other fields.
- **Sending** lead and Cylinders to SSI waits: it changes every Push fingerprint, so every sent Dive with lead would show
  "changed since sent" once. A decision of its own when wanted.

### The lead estimate (slice B)
- **Computed on request, never stored:** for a Diver and planned conditions (water type, suit, Cylinders), with a range,
  the dives it rests on and each adjustment. A planned dive (dive planner, later) may keep conditions and estimate.
- **Anchor and adjust:** the Diver's Dives with lead logged, the same suit set-up and a known water type (from the site,
  ADR 0025; never from the computer's water setting). Each one's lead is corrected by its feedback (an amount, else 1 kg),
  normalised by removing its physics terms, and combined as a weighted median (felt right ×2, half weight every two years).
  The plan's physics terms are added; the result is rounded to 0.5 kg (1 lb); the spread gives the range.
- **Physics only for the cylinder and the water:** the cylinder's buoyancy at reserve (the Diver's usual end pressure,
  else 50 bar) from the catalogue or its values; water 1000 / 1025 kg/m³ (brackish halfway) applied to the total mass
  (body weight + gear + lead).
- **No dive with that suit:** the rule of thumb (PADI's percentages per suit, salt water, an AL80) shifted by the Diver's
  personal offset from the suits they did log; with no history at all the rule of thumb alone (needs body weight), said
  to be a first guess.
- **Not built:** a body model (no validated method), buoyancy per Equipment item (deferred until Equipment items exist
  for their own reasons; then they enter as differences between set-ups), regression (later, with gear items).
- **Where:** a **Tools** page, the dive planner's later home, with the calculator; a hint on the dive form while logging
  ("last time with this suit: 8 kg, felt right").
- **Safety:** the page always says it is a starting point, shows the range and its reasons, and asks for a weight check.

### Order
Slice A logs (Dive values, Diver's body weight, the SSI import); slice B is the estimate and the Tools page, once some
history exists.

## Considered options
- **Total lead only** (UDDF, SSI, most apps): loses the distribution PADI asks to log and the estimate could suggest.
- **The suit only as an Equipment item:** cleaner, but makes Equipment items (service records, gear sets) a prerequisite.
- **A five-step feedback scale, or none:** kilograms per step would be guessed; without feedback, an overweighted diver keeps
  getting overweighted suggestions.
- **Height, sex and age for a physics body model** (the *Lead* app): more personal data, no evidence it beats the rule of
  thumb.
- **A single "cylinder used" first:** faster, but pressures and gas are wanted by gas planning later anyway.
- **An editable cylinder catalogue:** more UI for rare cylinders; typing the values covers them.
- **Gear buoyancy now, or dropping physics:** the first needs Equipment items; the second ignores ~3 kg terms.
- **Ridge regression first** (Submersion): little gain with a few dives per suit and hard to explain.
- **Prefilling new and imported Dives:** guessed values would look logged and skew the estimate.
- **Sending to SSI in the same slice:** every sent Dive would turn "changed since sent" at once.

## Consequences
- The Dive's version and Revisions cover four more values; the dive page and form grow (lead, feedback, suit, Cylinders).
- Body weight is the first health-like personal data on a Diver; the privacy texts say who sees it.
- UDDF import and export can map `leadquantity`, `suittype` and `tankmaterial`/`tankvolume`; feedback and placement stay here.
- Gas planning (a later tool) can use the same Cylinders and the SAC values Recordings already carry.
- SSI's tank type IDs (19 and 20 seen) must be looked up (`get_divelog_vars`) before the material is taken.

## Amendment 2026-10-08: Cylinders come first
Cylinders on a Dive are built before lead, suit and weighting feedback, as their own slice
([ADR 0045](0045-tank-pressure-cylinders-and-sac-on-a-dive.md)); slice A keeps the rest.
