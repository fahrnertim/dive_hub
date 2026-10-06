---
title: Equipment items and service intervals
summary: Equipment items of a Diver (the data model's Equipment item, not built), which Dives they were used on, and service schedules the User sets up (several per item, by months, dives or hours, whichever first) with service records that reset them; how logbooks and formats do it (Subsurface has none, Submersion the richest model, MacDive and SSI dates only, Diving Log counts all dives, UDDF days only, DiveJSON months and dives), maintenance patterns from aviation and bike trackers, pitfalls; the model; decided (ADR 0034) with the prompt for slice 21.
status: decided
date: 2026-10-06
---

# Equipment items and service intervals

Asked by the project owner on 2026-10-06: once Dive Hub has equipment, **service intervals**, such as a regulator
serviced every two years or something checked every so many dives.

**Decided by the owner during the discussion (2026-10-06):**
- **The User sets up the intervals.** Dive Hub ships no manufacturer or legal intervals (no templates per category);
  the User enters what their manual or the cylinder's stamp says. (A research run on manufacturer intervals and cylinder
  inspection rules was stopped for this reason.)
- **Several schedules per item**, e.g. a cylinder's visual inspection and its pressure test.

## In the glossary's terms

- **Equipment item** (in the [data model](../spec/data-model.md), not built): a piece of a Diver's gear with maker, model,
  serial, purchase data and **service records**. A **Device** "is an" Equipment item that records data.
- **Equipment use** (in the data model, not built): which items a Dive used. "Every x dives" counts these.
- New: **service schedule** (one clock per item and kind of service: an interval in months, dives and/or hours, due at
  whichever comes first, counted from the last service of that kind) and **service record** (what was done, when, by
  whom; which schedules it resets).
- Touches: [ADR 0016](../decisions/0016-recording-decisions-and-divers.md) (Devices belong to a Diver; reassigning affects
  future Imports; "holders over time" open); [ADR 0031](../decisions/0031-lead-suit-cylinders-and-lead-estimate.md) (the
  exposure suit and Cylinders on a Dive, an Equipment item link "later"; gear buoyancy waits for Equipment items;
  "nothing filled without the User"); [ADR 0028](../decisions/0028-shared-divers-and-participants.md) (other Users see a
  Diver's name only); [ADR 0015](../decisions/0015-overrides-vocabulary-and-browser-tests.md) (version, Revisions,
  vocabulary); [ADR 0003](../decisions/0003-own-data-model-uddf-as-adapter.md) (UDDF equipment); SSI's gear
  ([SSI reference](../references/ssi-app-api.md): `get_gear`, gear sets, a dive's `_gear`).
- **No accepted ADR is contradicted**, with one tension: counting dives needs to know which Dives used an item, and
  ADR 0031 decided that nothing is filled into a Dive without the User doing it (D11). A rule like "this regulator is on
  every Dive of its Diver while in use" isn't filling a Dive, but it decides usage without the User per Dive (decision E2).

## How others do it

| Product | Items / sets | Per-dive link | Service records | Interval types | Reminders |
|---|---|---|---|---|---|
| Subsurface [ss-issue] [ss-list] | none (suit text, cylinders, weights); open request since 2022; the maintainer asks "where dive-equipment tracking ends and a general asset-management system begins" | – | – | – | – |
| **Submersion** (GPL-3.0) [sub-guide] | items with type, status (active, needs service, retired, loaned, lost), assemblies and parts, sets (a default one, by computer, by place), sharing between divers with an ownership log | a dive–item table, with which set or assembly attached it | kind, date, provider, cost, notes | several clocks per item, days, dives, hours and more; whichever first; due always computed | badge (30 days / 10 %), phone notifications 7/14/30 days |
| MacDive [macdive] | items and groups, "add to new dives" per item | drag onto dives | not verified | **next service date only**; dive counts asked for, not built | notification on the day or before |
| Diving Log 6/7 [divinglog] | items with photos | per dive | last/next date; history asked for in 2015 | dives/hours since service, **counting all dives, not the item's** | not verified |
| SSI MySSI [divesend] | items (category, serial, invoice, photos), gear sets | a dive's `_gear` ids | last and next date | date | a badge |
| Garmin Dive, Currents, Reef Monkey | items, kits | yes | some | "service intervals", calendar and usage | yes (store texts) |
| Suunto, Shearwater, PADI | none found | | | | |
| UDDF 3.2 [uddf-equipment] | typed pieces under the owner, `equipmentconfiguration` (sets) | `equipmentused` | **none** (only `nextservicedate`) | `serviceinterval` **in days** | – |
| DiveJSON 1.0 [divejson] | items (archived, rented), sets | `gear_uuids` | yes (no cost) | months and dives; several schedules per item | – |

Elsewhere: aviation tracks calendar, hours and cycles per task and acts on the first; intervals count from when the task
was last done [tc-ac] [faa]. Bike trackers (ProBikeGarage, Strautomator) count usage per part, reset on service, and
regret not letting a part move between bikes [probike] [strautomator]. Strava's shoe alert repeats after every run with no
snooze [strava].

**Patterns worth taking:** item, schedule and record kept apart; whichever comes first; due computed, never stored;
counted from the last service of that kind, with a "last done before Dive Hub" date for gear that comes with history;
retired instead of deleted; records survive their schedule; a due-soon window (days for dates, a share for counts).
**Pitfalls:** counting all of a Diver's dives overstates usage, but per-dive selection is only as good as the User's
logging; calendar-only misses heavy use, usage-only misses gear that ages unused; only a "next date" loses the history;
a backdated record must not move a clock backwards; two notions of a cylinder (gas on a Dive vs a piece of gear);
scope creep into asset management.

## Model (proposal)

- **Equipment item** (Diver tier): Diver, category (vocabulary in code: regulator, BCD, wing, backplate, cylinder,
  drysuit, wetsuit, dive computer, transmitter, light, camera, other …), name, maker, model, serial, purchase date, notes,
  status (`in use`, `retired`, `lost`, `sold`), a "last serviced before Dive Hub" date per schedule; version, Revisions.
- **Device**: a dive computer or transmitter Device is linked to an Equipment item, so its Dives (through its Recordings)
  count without any per-dive choice (E1).
- **Equipment use** `(Dive, item)`, how it is recorded (E2).
- **Service schedule** (item, name, interval months / dives / hours, any of them, at least one; active): due at whichever
  comes first, counted from the newest service record that resets it, else its start date; nothing stored but the rule.
- **Service record** (item, date, which schedules it resets, by whom, notes; cost optional): a fact; deleting a schedule
  keeps its records; a record older than the newest never moves the clock back.
- **Due and due soon** computed per schedule (soon: within 30 days or 10 % of a count) and shown on the Equipment page,
  a badge in the navigation, a notice on the logbook (E4).
- **Cylinder on a Dive** (ADR 0031) may name the Diver's own cylinder item, which fills its values and counts the Dive.
- **Exposure suit** (ADR 0031) may later name a suit item.
- **Providers:** SSI's gear (items with last/next service dates, sets, a dive's gear ids) could be imported later (E9).
- **Migrations** (described): `equipment_item`, `equipment_use`, `service_schedule`, `service_record`
  (+ the schedules a record resets), `device.equipment_item_id`; all additions.

### Scenario: Tim's regulator and cylinder

Tim adds his regulator (serviced 2025-04, "every 2 years or 100 dives") and his 12 L steel cylinder (visual inspection
every 12 months, last 2026-03; pressure test every 5 years, last 2023-03 by the stamp). His Garmin already is a Device.

1. The regulator's schedule counts the Dives it was on since 2025-04: 87 → due soon at 90 (10 % of 100).
2. On his holiday he rents a regulator: those Dives must not count for his own (E2 decides how that is said).
3. In 2026-11 the shop services the regulator: a record (date, shop, "full service") resets its schedule; the count
   starts again.
4. The cylinder's visual inspection is due 2027-03; its pressure test 2028-03; one record of a pressure test with visual
   inspection resets both.
5. He sells the cylinder: status `sold`; its Dives and records stay.

## Decisions

All made by the owner on 2026-10-06; written down as [ADR 0034](../decisions/0034-equipment-items-and-service-schedules.md).

| | Question | Decided (2026-10-06) |
|---|---|---|
| – | Intervals | Set up by the User; no built-in templates (the owner, during the discussion) |
| – | Schedules per item | Several (the owner, during the discussion) |
| E1 | Devices | Each Device is linked to an Equipment item; its Dives count through its Recordings |
| E2 | Counting dives | Items "on every Dive while in use" count all of their Diver's Dives except those they were taken off; others count the Dives they were put on ("same as last dive", sets; never automatic) |
| E3 | Units | Months, dives and/or hours, whichever first |
| E4 | Reminders | In the app only: Equipment page, a count in the navigation, a logbook notice; due soon within 30 days or 10 % |
| E5 | Ownership | A Diver's; lending later |
| E6 | Service record | Date, the schedules it resets, by whom, notes, optional cost; receipts later |
| E7 | Parts | One item per set, several schedules; parts as items later |
| E8 | Cylinders | A Dive's Cylinder may name the Diver's cylinder item |
| E9 | SSI's gear | Later, as a Provider kind `equipment` |
| E10 | Order | Slice 21, after the planning tools |

### Still to check
- **Existing Devices:** the migration creates their items; whether a Device whose Diver changed (ADR 0016) keeps one item.
- **The "in use" date for gear already used before Dive Hub:** counting starts at that date, so earlier Dives in the
  logbook count too; the form should say so.

## Slices

1. **Slice 21: Equipment items and service schedules** (after slices 17–20): items, usage, schedules and records,
   reminders in the app, Devices linked, a Dive's Cylinder naming an item. Smallest thing to learn from: whether "on every
   Dive while in use" with exceptions matches how the owner logs.
2. **Later:** lending and holders over time; parts as items; receipts; SSI's gear; the suit naming an item; gear buoyancy
   for the lead estimate; a note while logging a Dive with overdue gear.

## Sources

- [ss-issue] Subsurface issue #3456: https://github.com/subsurface/subsurface/issues/3456
- [ss-list] Subsurface mailing list, 2026-08: https://groups.google.com/g/subsurface-divelog/c/6ODmKXoAa9w
- [sub-guide] Submersion equipment guide (GPL-3.0): https://github.com/submersion-app/submersion/blob/main/docs/guide/equipment.md
- [macdive] MacDive gear help: https://mac-dive.com/help/ios_01_03_gear.php, forum: https://mac-dive.com/forum/viewtopic.php?p=8912
- [divinglog] Diving Log forum: https://www.divinglog.com/phpbb/viewtopic.php?p=14003, https://www.divinglog.com/phpbb/viewtopic.php?p=11301
- [divesend] divesend SSI API reference (gear): https://github.com/nvahalik/divesend/blob/main/docs/ssi-api-reference.md
- [uddf-equipment] UDDF `equipment`, `serviceinterval`: https://www.streit.cc/extern/uddf_v321/en/equipment.html, https://www.streit.cc/extern/uddf_v321/en/serviceinterval.html
- [divejson] DiveJSON spec §6.12–6.15: https://github.com/divejson/divejson/blob/main/spec/divejson.md
- [tc-ac] Transport Canada AC 605-006: https://tc.canada.ca/en/aviation/reference-centre/advisory-circulars/advisory-circular-ac-no-605-006
- [faa] FAA Notice 8900.560: https://www.faa.gov/documentLibrary/media/Notice/N_8900.560_FAA_Web.pdf
- [probike] ProBikeGarage: https://apps.apple.com/us/app/-/id1422489202
- [strautomator] Strautomator GearWear: https://docs.strautomator.com/gear/overview
- [strava] Strava shoe notifications: https://support.strava.com/en-us/articles/15401878-how-do-i-manage-shoe-mileage-notifications-on-strava
- [undercurrent] Undercurrent, regulator servicing (manufacturers' "2 years or 100 dives"): https://undercurrent.org/UCnow/dive_magazine/2018/RegulatorServicing201801.html

## Prompt: Equipment items and service schedules (slice 21)

```text
We're continuing Dive Hub. Everything you need is in this repository; read it first and don't rely on any
local memory (AGENTS.md Rule #1).

Task: Equipment items of a Diver with service schedules the User sets up and service records, usage from items on
every Dive while in use (with exceptions), items put on single Dives, Devices and a Dive's Cylinder; due dates shown
in the app. As decided in ADR 0034 and docs/research/2026-10-06-equipment-and-service.md. Slices 17-20 are built.
Everything is decided; don't re-litigate it. Ask me before building only if something in the code makes it harder
than it looks.

Read first:
- AGENTS.md, CLAUDE.md, docs/index.md, docs/skills.md, docs/glossary.md (Equipment item, Equipment use, Service
  schedule, Service record, Device, Cylinder)
- ADR 0034 (this design), 0016 (Devices, amended), 0031 (Cylinders, "nothing filled automatically"), 0026 (deleted
  Dives count nowhere), 0015 (version, Revisions, vocabulary), 0028 (who sees what), 0018 (icons), 0023 (checks)
- docs/research/2026-10-06-equipment-and-service.md (the model, scenario, "Still to check"), docs/spec/data-model.md
  (Equipment item, Device, Equipment use, scenario 8), docs/spec/clients.md, docs/spec/design-system.md
- Code: apps/server/src/db/schema.ts (device, dive, recording, the slice-17 cylinder), src/dives/, src/divers/,
  src/imports/ (where Devices are created), apps/web/src/ (DiversPage.tsx with Devices, DiveDetail.tsx, App.tsx)

Build:
- Server:
  - equipment_item (Diver, category vocabulary, name, maker, model, serial, purchase date, notes, status in use /
    retired / lost / sold, on every Dive while in use + in-use date, version), equipment_use (Dive, item, put on or
    taken off), service_schedule (item, name, months / dives / hours, at least one, start date, active),
    service_record (item, date, by whom, notes, optional cost and currency) with the schedules it resets;
    device.equipment_item_id (a migration creates an item for every existing Device; new Devices get one).
  - Usage per item: Dives of its Diver while in use minus those it was taken off; Dives it was put on; a Device's
    Recordings' Dives; Dives whose Cylinder names it; never deleted Dives. Dives and dive hours since the newest
    record resetting a schedule (else its start date).
  - Due per schedule, computed: whichever of months, dives, hours comes first; due soon within 30 days or 10 %; the
    reason. Nothing stored but rules and facts. A backdated record never moves a clock back.
  - Routes for items, schedules, records, usage on a Dive (put on, take off, same as last dive, sets later if not cheap),
    the due list; versions and Revisions; only the Users who manage the Diver. Regenerate packages/api-client.
- Web: an Equipment page (items by Diver and category, status, each schedule with due/soon/overdue and its reason,
  records, retiring), the item form (the note that intervals come from the manual or the stamp, no defaults), the
  record form (which schedules it resets), gear on the dive page (from every-dive items, put on, taken off), the
  Cylinder naming an item, a count in the navigation and a dismissible logbook notice; translations (en, de).
- Tests: test-first for usage and due (whichever first, from the last record, a backdated record, a deleted Dive, taken
  off on a holiday, a Device's Dives, a named cylinder, months across month ends); API tests (another User's Diver's
  items unseen); browser tests (@equipment, @dives); ui-quality cases (nothing yet, due soon, overdue, retired, a
  schedule by dives).
- Docs: ADR 0034 (amend with what changed while building), data model, glossary (no longer planned), architecture
  (slice 21), clients.md (equipment duties: intervals are the User's, due reasons shown, notices dismissible), index.md;
  mark this prompt done.

Rules:
- Skills first (AGENTS.md); the search on 2026-10-06 ("maintenance tracking", "asset management", "inventory",
  "reminders", "recurring schedule") found nothing.
- `pnpm check` while working, `pnpm check:full` before proposing a commit, review capture with
  REVIEW_AREAS=equipment,dives; a new page gets its path in scripts/check.mjs and an area tag.
- Commit only when I say so (on main, short subject, blank line, body).
- End with a short summary: what was built, what you checked, simplifications, what you need me to decide.
```
