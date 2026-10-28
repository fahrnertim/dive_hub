---
title: "ADR 0031: Lead, exposure suit, Cylinders and weighting feedback on Dives; a lead estimate from the Diver's own dives"
summary: Dives record lead as placed entries with a total, how the weighting felt (right, too heavy, too light, with an optional amount), the exposure suit as a Dive value, and full Cylinders filled from a catalogue in code; Divers keep dated body weights seen only by their managing Users. A lead estimate (first tool of a later dive planner, on a Tools page and as a hint while logging) anchors on the Diver's dives with the same suit and adjusts by physics for cylinder and water; a rule of thumb covers no history; no body model, gear buoyancy deferred. SSI imports fill lead and the cylinder (amends 0030); sending them waits. Logging first (slice A), the estimate second (slice B).
status: accepted
date: 2026-10-06
---

# ADR 0031: Lead, exposure suit, Cylinders and weighting feedback on Dives; a lead estimate from the Diver's own dives

## Status
Accepted – 2026-10-06. Amends [ADR 0030](0030-importing-dives-from-providers.md) (the fields an import fills and takes
back gain lead and the cylinder). Built so far: Cylinders (ADR 0045) and the Dive's lead, feedback and suit
([as built](#slice-a-as-built-the-dives-values)); SSI's lead ([part 2](#slice-a-part-2-as-built-ssis-lead)) and the Diver's body weight ([part 3](#slice-a-part-3-as-built-body-weight-of-a-diver)); the estimate is not. Designed in the [weight calculator note](../research/2026-10-06-weight-calculator.md).
Amended by [ADR 0056](0056-two-way-exchange-and-automation.md) (2026-10-24): "never removes" no longer holds; a weight
emptied at the Provider removes the Dive's one Lead entry, unless a Recording brought it.

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

## Amendment 2026-10-08: SSI's tank
The Provider part for the Cylinder is built ([ADR 0045](0045-tank-pressure-cylinders-and-sac-on-a-dive.md#ssis-tank-as-built)).
SSI's tank types are known (19 steel, 20 aluminium), so the material is taken. Beyond "where the Dive has none": the
Dive's only Cylinder takes from SSI the values it lacks. Lead from SSI stays with slice A.

## Slice A as built: the Dive's values
Built on 2026-10-08, the test seams agreed with the owner (the Dive's edit and view, "same as last dive", the MCP
tool, the dive page and its form in a browser). Slice A is cut in three: these values first, then SSI's lead, then
body weight.

- **With the Dive's edit:** `PATCH /dives/{id}` takes `lead` (the whole list, replacing the entries; at most 8, each
  0 to 60 kg, a placement or none), `weightingFeedback` (`{ felt, amountKg }` or `null`) and `suit`
  (`{ type, thicknessMm, hood, undergarment }` or `null`). One Revision and one step of the version for all of an
  edit; the changes are `lead`, `weightingFeedback` and `suit`, each with the value before and after.
- **The view** has `lead`, `leadTotalKg` (the sum, `null` without entries), `weightingFeedback` and `suit`.
- **Refused:** an amount with weighting that felt right (`weighting_feedback_invalid`); a thickness on anything but a
  wetsuit or a semidry suit, an undergarment under anything but a drysuit (`suit_invalid`). A hood goes with any suit
  that is worn; whether one was worn may stay unsaid.
- **Feedback stands alone:** it may be logged without lead (a Diver may remember "too heavy" and not the amount).
- **"Same as last dive"** answers the previous Dive's `lead` and `suit` beside its Cylinders, never its feedback: how
  the weighting felt is this dive's own. The web form has one button for all three and fills only the parts that are
  still empty.
- **Merging two Dives** (ADR 0038): the kept Dive takes the other's lead, feedback and suit, each where it has none.
- **Units:** kg, or lb for imperial with one decimal; an amount nobody touched is saved as it was. Thickness in mm
  in both systems.
- **AI access (MCP):** `logbook_get_dive` returns `lead` (`total_kg`, `entries`), `weighting_feedback` and `suit`,
  each left out while unknown.
- **Storage:** a table `lead` (dive, position, amount, placement); columns on `dive` for the feedback and the suit
  (migration 0028).
- **SSI has no scuba suit** (checked 2026-10-08): in the 127 records of the development logbook the only suit key is
  the freediving one (`x_odin_user_log_frd_suit`, empty on all), so `get_divelog_vars`' suit list (85 to 89) is
  freediving's. The suit is not imported.

## Slice A part 2 as built: SSI's lead
Built on 2026-10-08. `odin_user_log_weight_kg` is the dive's weight as typed at SSI (`ImportedDive.leadKg`); a weight of 0
counts as not typed (owner's decision). Tested at `parseSsiDive`, `threeWay` and the import over HTTP against the fake SSI.

- **Fills:** a Dive without Lead entries gets one entry without a placement, in the import's `fill` Revision, unless its
  history spoke of `lead` (a Lead a User emptied stays empty). A Dive with entries keeps them.
- **Changes at SSI** (three-way, field `lead`, compared as the total to 0.1 kg): taken where only SSI changed it; a Dive with
  one entry takes the total and keeps its placement; a conflict when both changed it (values in kg); **a Dive with several
  entries is left alone** (the field isn't compared, like several Cylinders).
- **Never removes:** a weight emptied or set to 0 at SSI removes nothing here; where Dive Hub never saw a weight at SSI the
  lead here stays. A weight that appears at SSI where the Dive here has no Lead is taken.
- **Not sent to SSI.**

## Slice A part 3 as built: body weight of a Diver
Built on 2026-10-09, the test seams agreed with the owner (the routes over HTTP, the Diver's page in a browser, and a
case in ui-quality). Slice A is complete; the estimate (slice B) is not built.

- **Routes:** `GET /divers/{id}/body-weights` (newest first, `{ date, kg }`), `PUT /divers/{id}/body-weights/{date}` with
  `{ kg }` and `DELETE …/{date}`. One value per date: setting a date again replaces it. A weight below 20 or above 400 kg
  and a date that doesn't exist (`2026-02-30`) are refused (400); deleting a date without a weight is
  `body_weight_not_found` (404).
- **Who sees it:** only the Users who manage the Diver. Any other User, and everyone for an external Diver, gets
  `diver_not_found`; the Diver list, the details every User sees (ADR 0043) and the Dive's views carry nothing of it.
- **Storage:** table `diver_body_weight` (diver, date, kg; primary key diver and date; kg checked 20 to 400), cascading
  with the Diver (migration 0029). The server holds kilograms only.
- **Web:** a "Body weight" button on each of the User's Diver rows opens a dialog (`BodyWeight.tsx`): the privacy sentence,
  the values newest first in kg or lb (one decimal), "Remove" per value, and a form with a date (today) and a weight in the
  User's unit. Divers nobody keeps have no such button.
- **Not built:** the MCP Diver tool does not return body weight yet (ADR 0035 says it will; the AI access text in
  [clients.md](../spec/clients.md) gains it in that change); no use of it until the estimate.

### Decided, not built
- Nothing of slice A is left.

### Open
- A request's `0` for a value that may be `null` arrives as `null` (the validator coerces, `Nullable` in
  `dives/routes.ts`): a feedback amount of 0 is "no amount", which is meant, but a Cylinder's end pressure of 0 bar
  is saved as unknown. The suit's `hood` avoids it with one `type` of both names.
