---
title: "ADR 0033: Gas plans for a Diver or a group - levels, gas rules, rock bottom, SAC from the logbook"
summary: The Tools page gains a gas plan - one or more levels with descent, ascent and safety stop; per Diver a Cylinder and a SAC; every gas rule (fixed reserve, fixed ascent pressure, halves, thirds, sixths matched by litres, rock bottom per level) explained, default "ascend at rock bottom, never below 50 bar"; any number of Divers, the controlling Diver marked and each Diver's own pressures. A Diver's SAC is computed per Dive from its Cylinder (or a tank pod) and shown on the dive page; the planning SAC is the 85th percentile of recent Dives. Only Divers the User manages use their logbook; others get a typed SAC. Stress ×2, 1 minute, direct ascent; real gas above 200 bar. Slice 22; amends 0032 (its gas limit and SAC default).
status: accepted
date: 2026-10-06
---

# ADR 0033: Gas plans for a Diver or a group - levels, gas rules, rock bottom, SAC from the logbook

## Status
Accepted – 2026-10-06. Not built yet. Amends [ADR 0032](0032-mod-and-no-decompression-limits.md): its bottom time's gas
limit becomes this engine's ascent pressure, and its default SAC comes from the logbook. Designed in
[Gas consumption and gas rules](../research/2026-10-06-gas-consumption-planning.md).

## Context
The owner wants gas consumption and time estimates, also for a group planned by its worst consumer, with the gas rules
explained. ADR 0032 planned only a simple gas limit (one Diver, one depth, a fixed 50 bar reserve). The research found:
- Agencies teach different reserves (SSI 30–35 bar, a PADI blog about 50 bar, BSAC a third); "up at 100 bar" is
  dive-centre practice; halves (RAID), thirds (Exley, cave) and sixths are turn rules for dives that come back the way they
  went; rock bottom (UTD, GUE, Subsurface, GasPlanner) is the gas two divers need to surface from the worst point.
  At 18 m rock bottom and 50 bar nearly agree; at 30 m rock bottom is well above 50.
- Mismatched cylinders are matched by litres; the smaller supply controls.
- No planner plans a group of N divers with their own SAC and cylinders.
- FIT carries SAC only with a tank pod: the owner's Garmin files have none, so ADR 0032's default SAC rarely exists. Logged
  Cylinder pressures (ADR 0031; SSI brings them for some dives) can give it; the owner can provide Suunto files with a
  tank pod for when Suunto import exists.
- ADR 0028 shows other Users nothing but a Diver's name.

The owner chose on 2026-10-06 the recommendation for each of the note's decisions H1–H8.

## Decision

### The plan
- **Levels:** one or more (depth, time), one by default; descent and ascent rates (18 and 9 m/min), a safety stop
  (3 min at 5 m); water and altitude as in ADR 0032.
- **Per Diver:** a Cylinder (catalogue or typed, start pressure) and a SAC.
- **Gas per segment** in litres at the surface (level at its depth, descent and ascent at the average depth), turned into
  pressure per Diver with **real gas above 200 bar** (a compressibility factor for air and nitrox, cited).
- **Gas rules**, each with its explanation (what it is for, who teaches it, when it is not enough): fixed reserve, fixed
  ascent pressure, halves, thirds, sixths (turn rules, matched by litres between Divers), and **rock bottom**, computed at
  every level (the worst point isn't always the deepest). **Default: ascend at rock bottom, never below a 50 bar
  reserve.** Rock bottom is always shown, whichever rule is chosen; thirds and sixths say they are for overhead diving with
  training.
- **Rock bottom** for a Diver = (their SAC + the highest other SAC in the group) × stress 2, over 1 minute of problem
  solving at that level and a direct ascent at 9 m/min, plus 10 bar; all editable.

### Groups
- **Any number of Divers.** The plan follows the **controlling Diver**, the first to reach a turn or ascent pressure;
  every Diver gets their own pressures (planned end, turn, ascent, margin); the page gives a briefing line ("we turn when
  anyone reaches their turn, and go up when anyone reaches their ascent pressure") and errors when a level doesn't fit
  ("leave 18 m at minute 24", "planned end below the reserve").
- **Who is in it:** Divers the User manages (their logbook SAC), any other Diver by name with a **typed SAC** (default
  20 L/min, marked), and unnamed rows. Nothing of another User's Diver is read (ADR 0028); sharing a planning SAC may come
  with Visibility.

### SAC from the logbook
- **Per Dive:** (start − end) × volume / ((average depth/10 + 1) × duration), with real gas, from its Cylinder when it
  has one cylinder (or identical ones), both pressures and a volume, and lasted at least 15 minutes; a tank pod's SAC
  (FIT, later Suunto) when the Recording has one. Shown on the dive page ("SAC on this dive"). Computed, not stored.
- **Planning SAC:** the 85th percentile of the Diver's last 20 such Dives, with how many it rests on; with fewer than 5,
  20 L/min, said so. Editable per plan.

### Amends ADR 0032
- The bottom time's gas limit is "until the ascent pressure of the chosen rule" (by default rock bottom ≥ 50 bar) instead
  of a fixed 50 bar reserve, and its default SAC is the planning SAC above (FIT's tank pod SAC is one of its sources).

### Stored
Nothing for a plan; its inputs live in the address (Diver ids and typed values, never another Diver's logbook values).

### Order
Slice 22, after slice 21 (which builds MOD, NDL and oxygen with ADR 0032's simple gas limit).

## Considered options
- **One depth only:** simpler, but rock bottom at a shallower level can bind and multi-level dives are common.
- **Recreational rules only, or rock bottom only:** the owner wants the rules explained; thirds and sixths are labelled.
- **A buddy pair only:** groups are the new part.
- **Another User's logged SAC, or opt-in sharing now:** the first reveals logbook data (against ADR 0028); the second is
  more to build now.
- **The median SAC, or typed only:** a plan needs a bad day's consumption; the logbook knows it.
- **4 minutes of problem solving (Subsurface), or ×1.5 (GasPlanner):** about 40 bar more, or less, at 30 m; the middle
  matches UTD's worksheet.
- **Ideal gas:** overstates gas in 232 and 300 bar cylinders by up to ~10 %.
- **Folding it into slice 21, or before it:** slice 21 stays small and safety-focused.

## Consequences
- Dive Hub plans for people who aren't its Users (typed values), and says so.
- The dive page gains "SAC on this dive"; Dives need Cylinder pressures for it, which makes logging them worth it.
- Suunto import with tank pods (later) feeds measured SAC into the same planning value.
- The client contract gains the gas plan's duties: rules explained, rock bottom always shown, the controlling Diver and
  each Diver's own pressures, defaults marked, the disclaimer.
