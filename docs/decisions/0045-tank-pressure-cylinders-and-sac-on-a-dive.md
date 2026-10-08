---
title: "ADR 0045: Tank pressure, Cylinders and SAC on a Dive - shown first, then logged, then computed"
summary: Three slices. A tank pod's pressure is shown - one line per tank in a strip of its own under the depth profile, with start, end and used pressure in words, the pod's own SAC, and a column in the profile's table; psi for imperial (built). Cylinders on a Dive come before lead and suit (changes 0031's order), one or more, typed or from the catalogue, each optionally tied to one pressure series; one list with the Dive's edit, the catalogue and "same as last dive" as routes (built). Then "SAC on this dive" in L/min, summed in litres over all Cylinders with both pressures and a volume (changes 0033's "one cylinder or identical ones"), with bar/min beside it for a single Cylinder. An import with pod data makes the Cylinders itself. Open - a second pod is unverified.
status: accepted
date: 2026-10-08
---

# ADR 0045: Tank pressure, Cylinders and SAC on a Dive - shown first, then logged, then computed

## Status
Accepted – 2026-10-08 (owner, in conversation). Slices 1 (showing) and 2 (Cylinders) built on 2026-10-08; slice 3 not built.
Amends [ADR 0037](0037-suunto-file-import-and-file-formats.md) (decision 5: the pressure is shown now),
[ADR 0031](0031-lead-suit-cylinders-and-lead-estimate.md) (the order: Cylinders before lead and suit) and
[ADR 0033](0033-gas-plans-rules-and-groups.md) (when a Dive's SAC counts).

## Context
- A Suunto tank pod's pressure was read and stored (ADR 0037) but shown nowhere: one series per gas number
  (`tankPressure`, further ones `tankPressure:<n>`), and in the summary per gas the tank's size and its start and end
  pressure, plus the pod's own SAC (`sacLpm`).
- Cylinders (ADR 0031, slice 19, bundled with lead and suit) and SAC per Dive (ADR 0033, slice 22) were decided, not built.
- The owner's Garmin files carry no tank pressure: those Dives need start and end pressure and a size typed in.
- The owner dives one tank today and wants the design open for several (2026-10-08). ADR 0033 gave no SAC for a Dive
  with different cylinders. No file with a second pod exists: Suunto keys pressure by gas number, so two tanks of the same
  gas may arrive as one series or as two gases.
- SSI's records carry single typed values (start and end pressure, tank volume, a type ID) on some dives, never a
  pressure profile: `tankPressureDataset` is empty in every record seen ([SSI app API](../references/ssi-app-api.md)).

## Decision

### Slice 1: show what a tank pod measured (built)
- **A strip of its own under the depth profile**, on the profile's time axis and with the same plot edges, one line per
  tank, the pressure scale starting at 0. Not a third scale in the profile: depth and temperature already share it.
  The pointer's moment shows in both.
- **Several tanks differ by their dashes**, not by colour, and are named by what they hold ("Tank 2 (EAN50, 7 L)");
  a single one is "EAN32, 12 L".
- **In words under the strip** (its text alternative): per tank the pressure at the start, at the end and what was
  used, then the pod's SAC ("Surface consumption (SAC) as the tank pod measured it: 17.5 L/min"; German "AMV"). The
  profile's table gains a column per tank.
- **Which series is which gas:** the first series is always `tankPressure`, whatever its gas number, so a series cannot
  name its gas. The series in their order belong to the gases that carry pressures, in theirs. Start and end are the
  computer's own values where it gives them, else the first and last reading.
- **Units:** bar, or psi for imperial, whole numbers. A tank's size and the SAC stay in litres and L/min in both systems
  for now (cubic feet need the working pressure, which comes with Cylinders).
- **No change to the API or the stored data.** The web client asks for `depth,temperature,tankPressure`.

### Slice 2: Cylinders on a Dive (built)
- The Cylinder part of ADR 0031, **before lead and suit**: one or more per Dive, each with volume, working pressure,
  material, gas, start and end pressure; typed or from the catalogue in code; the Dive's own values (version, Revisions).
- For a Dive without a pod, the User types start pressure, end pressure and size. **"Same as last dive" copies the
  Cylinders without their pressures.**
- A Cylinder may be **tied to one pressure series of a Recording** (the data model's sensor mapping); the strip and its
  words then speak of the Cylinder.
- **An import with pod data creates the Cylinders itself**, marked as from the pod (size, gas, start and end pressure,
  tied to its series), where the Dive has none; the User can change them like any other (owner, 2026-10-08). This is
  measured data, unlike a guessed prefill, which ADR 0031 rules out.
- SSI's typed cylinder values are imported after that (ADR 0031's Provider part), not in this slice.

### Slice 3: SAC on this dive
- **L/min at the surface** is the figure (glossary: SAC), computed and never stored, as ADR 0033 says.
- **Several Cylinders count:** the litres used are summed over all Cylinders of the Dive, each pressure drop times its
  volume, with real gas; it needs both pressures and a volume on every Cylinder that was breathed from. This replaces
  ADR 0033's "one cylinder (or identical ones)". The 15-minute minimum stays.
- **bar/min beside it** when the Dive has exactly one Cylinder.
- A SAC per tank needs to know when each was breathed (gas switches, the Cylinder's usage window): not decided here.

### Slice 2 as built

Built on 2026-10-08, the test seams agreed with the owner.

- **One list with the Dive's edit:** `PATCH /dives/{id}` takes `cylinders`, which replaces the ones the Dive has; one
  Revision (change `cylinders`, the whole list before and after) and one step of the version. A value left out is
  unknown. Refused as a whole: an end pressure above the start, a gas over 100 %, a series twice (`cylinder_invalid`),
  a series the Dive's Recordings don't have (`cylinder_series_not_found`). At most 12.
- **The tie is `{ recordingId, channel }`**, a `tankPressure` channel of one of the Dive's Recordings; the data has no
  sensor serial. A Recording split off takes its series along: the Cylinder stays, without the tie.
- **"From the pod" is a mark the import sets** (`fromPod`), kept while the Cylinder keeps the pod's series, whatever
  else the User changes. Untying it, or tying another Cylinder to the series by hand, is not "from the pod".
- **When an import makes them:** when a Recording comes to a Dive that has no Cylinders (a new Dive, an attach, a
  Recording split off into its own Dive), in the same Revision. Not on a re-import of a Recording that is already
  there, so what the User removed stays removed.
- **What an import makes them from** (decided with the owner, 2026-10-08): one Cylinder per pressure series, tied and
  marked, and one per gas the computer gives **a start or an end pressure** for, also without a series (a file that
  only sums a tank up); that one is not tied and not marked. The series in their order belong to the gases with
  pressures, in theirs. A pressure is the least there must be: a gas alone makes none, because a computer lists every
  gas it was set to, and a size alone is a setting, not a tank that was dived.
- **A re-import that no longer has a series** a Cylinder is tied to unties it, in the re-import's Revision of the Dive:
  the Cylinder stays, without the tie and the mark. Otherwise no change to the Dive's Cylinders could be saved.
- **Dives imported before this slice** get their Cylinders at the server's next start (a worker task, like the
  positions of earlier Recordings): every Dive whose Recordings know of a tank, without Cylinders, whose history never
  spoke of any, so a Dive the User emptied stays empty. By the hub itself, one Revision each (cause `fill`).
- **Merging two Dives:** the kept Dive takes the other's Cylinders where it has none, else keeps its own.
- **"Same as last dive" is a route** (`GET /dives/{id}/same-as-last`): the Cylinders of the Diver's Dive before this
  one by start time, without pressures and series. It changes nothing; it will carry suit and lead too (ADR 0031).
- **The catalogue is a route** (`GET /cylinder-catalogue`), a list in the server's code: AL80, AL63, AL100, AL40, steel
  7, 10, 12 and 15 L at 200, 232 or 300 bar, a twin 12 L. A Cylinder keeps the values, not the entry. Empty buoyancy
  comes with the lead estimate. No separate "S80": Luxfer's S80 is the AL80.
- **Units:** pressures in the User's unit in the form (whole bar or psi); a value nobody touched is saved as it was,
  so a form in psi doesn't change what it only rounded. Sizes stay in litres (cubic feet: not in this slice).
- **AI access (MCP):** `logbook_get_dive` returns the Dive's `cylinders`.
- **Words under the strip:** a tank whose series is tied to a Cylinder takes the Cylinder's gas, size and logged
  pressures where it has them.

## Open
- **A second pod is unverified**: further series are stored, but the web client does not ask for them yet (the route
  takes exact channel names), and how Suunto writes two tanks of one gas is unknown. Wanted: a file
  ([samples](../../samples/README.md)).
- A pod as a Device (ADR 0034) and planning SAC and gas plans (ADR 0033, slice 22) stay where they were.

## Consequences
- A Dive recorded with a pod shows its gas use without anything being logged by hand.
- The profile component draws two charts that must keep the same plot edges (one constant for the right-hand space).
- Clients gain a duty: tank pressure with a text alternative, in the User's pressure unit
  ([client contract](../spec/clients.md)).
- Slice 19 shrinks to lead, suit, weighting feedback and body weight.
