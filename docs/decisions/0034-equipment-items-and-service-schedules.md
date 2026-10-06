---
title: "ADR 0034: Equipment items with service schedules the User sets up"
summary: A Diver's Equipment items (category, maker, model, serial, purchase, status) with several service schedules each (months, dives and/or hours, whichever first, counted from the last service of that schedule) and service records (date, schedules reset, by whom, notes, cost) - no built-in intervals. Usage comes from items "on every Dive while in use" with exceptions, items put on single Dives, Devices (linked to an item, counted through Recordings) and a Dive's Cylinder naming the Diver's cylinder. Due and due soon computed, shown in the app only. One item per regulator set; parts, lending, SSI's gear later. Slice 21. Amends 0016.
status: accepted
date: 2026-10-06
---

# ADR 0034: Equipment items with service schedules the User sets up

## Status
Accepted – 2026-10-06. Not built yet. Amends [ADR 0016](0016-recording-decisions-and-divers.md) (a Device is linked to an
Equipment item). Builds on [ADR 0031](0031-lead-suit-cylinders-and-lead-estimate.md) (Cylinders on a Dive). Designed in
[Equipment items and service intervals](../research/2026-10-06-equipment-and-service.md).

## Context
The owner wants service intervals for gear: a regulator every two years, something checked every so many dives. Dive Hub
has no Equipment items yet (the data model plans them), only Devices (dive computers, linked to Dives through
Recordings). The research found that Subsurface has no gear at all, MacDive and SSI keep only a next service date, Diving
Log counts all of a diver's dives instead of the item's, UDDF knows only an interval in days, and Submersion and DiveJSON
keep item, schedule and record apart, with several schedules per item and due dates computed. Aviation and bike trackers
add "whichever comes first", counting from the last service, and the cost of not knowing which uses belong to a part.

The owner decided during the discussion (2026-10-06) that the User sets up the intervals (no built-in templates) and
that an item can have several schedules; and chose the recommendation for each of the note's decisions E1–E10.

## Decision

### Items
- **Equipment item** belongs to a **Diver** (seen and changed by the Users who manage it, like Dives): category (a
  vocabulary in code: regulator, BCD, wing, backplate, cylinder, drysuit, wetsuit, dive computer, transmitter, light,
  camera, other), name, maker, model, serial, purchase date, notes, status (`in use`, `retired`, `lost`, `sold`), and
  whether it is **on every Dive while in use** (with the date it went into use). Version and Revisions. Never deleted
  once used; retired instead.
- **One item per set**: a regulator set is one item; parts serviced differently get their own schedules. Parts as items
  come later if needed.
- **Devices:** each Device is linked to an Equipment item (category dive computer or transmitter), created with it; its
  Dives are those of its Recordings.

### Usage (for counting dives and hours)
- An item **on every Dive while in use** counts every Dive of its Diver from its in-use date until it leaves use, except
  the Dives it was **taken off** (rented gear on a holiday). Stored are only the exceptions.
- Other items count the Dives they were **put on** (`equipment_use`), with "same as last dive" and named sets as one
  action; never filled automatically (ADR 0031).
- A Device counts the Dives of its Recordings; a **Dive's Cylinder may name the Diver's cylinder item**, which fills its
  values and counts the Dive (rental cylinders stay plain).
- Deleted Dives count nowhere (ADR 0026).

### Schedules and records
- **Service schedule** (item, name, interval in **months, dives and/or hours** of dive time, at least one; a start date,
  "last done before Dive Hub"; active): due at **whichever comes first**, counted from the newest service record that
  resets it, else its start date. Due dates are computed, never stored. **No built-in intervals**: the User enters what
  the manual, the shop or the cylinder's stamp says; the form says so.
- **Service record** (item, date, the schedules it resets (one or several), by whom (text), notes, optional cost with
  currency): a fact. A record older than the newest doesn't move a clock back; deleting a schedule keeps its records.
  Receipts and certificates come later with Media.

### Reminders
- **In the app only:** the Equipment page lists due, due soon and overdue schedules with their reason ("100 dives
  reached"); the navigation shows a count; the logbook shows a dismissible notice. Due soon: within 30 days, or within
  10 % of a dive or hour count. No e-mail or push (the instance has neither).

### Later
- Lending an item to another Diver and holders over time (with ADR 0016's topic); parts as items; receipts; SSI's gear list
  (a Provider kind `equipment`: items, their last and next service dates as schedule starts, gear ids on dives as uses);
  the exposure suit (ADR 0031) naming a suit item; gear buoyancy for the lead estimate (ADR 0031).

### Order
Slice 21, after the planning tools (slices 17–20); the cylinder link builds on slice 17's Cylinders.

## Considered options
- **Built-in templates per category** (Submersion seeds intervals): rejected by the owner; manufacturers and countries
  differ, and a wrong default looks authoritative.
- **Only Dives an item is put on:** exact, but counts stay low when gear isn't logged per Dive.
- **All Dives of the Diver** (Diving Log): rented gear and spares overcount.
- **Devices kept apart:** a computer's battery schedule would need its Dives chosen by hand.
- **Months and dives only:** hours suit batteries and sensors and cost nothing (Dives have durations).
- **E-mail or reminders when logging:** no mail; a note while logging can come later.
- **Items owned by a User:** easier for a parent, harder when a child becomes a User.
- **Without cost, or attachments now:** cost is wanted and small; files need Media.
- **Parts as items now:** more to build; most divers service a set together.
- **Cylinders kept apart:** inspections by months work, but dives on that cylinder wouldn't count.
- **SSI's gear now:** Dive Hub's own model first.

## Consequences
- The Dive gains used gear (derived and explicit); the dive page shows it and lets an item be taken off or put on.
- Devices get an item each (a migration creates them for existing Devices).
- "Holders over time" (ADR 0016) now also concerns gear, not only computers.
- UDDF export can write `equipment` with `serviceinterval` (days) and `nextservicedate`; dives and hours intervals and the
  history stay here.
