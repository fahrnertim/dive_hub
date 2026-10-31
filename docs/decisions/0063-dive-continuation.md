---
title: "ADR 0063: Appending a Continuation - one Dive from two cut apart by a surface break"
summary: Proposed - consecutive Dives of one Diver from the same Device become one by a joined Recording (derived, no Original, each surface break as 0 m) that is the Primary recording, with their Recordings kept as its parts (any number); the later Dives are deleted like merged ones so imports skip them, and restoring one reverses its whole append (and later ones), giving back their Recordings. A new logbook check (`surface_break`, at most 10 minutes, chains as one item) suggests them. Amends 0016, 0026, 0038.
status: proposed
date: 2026-10-31
---

# ADR 0063: Appending a Continuation - one Dive from two cut apart by a surface break

## Status
Proposed – 2026-10-31. Designed in [Continuation](../superpowers/specs/2026-10-31-dive-continuation-design.md). Amends
[ADR 0016](0016-recording-decisions-and-divers.md) (a Recording may be derived from others; a Device can have two
Recordings on one Dive, as parts), [ADR 0026](0026-deleting-dives.md) (restoring an appended Dive gives its Recording
back) and [ADR 0038](0038-logbook-checks-and-merging-dives.md) (a fifth rule, `surface_break`; a second way to fold one
Dive into another).

## Context
A dive computer ends a dive after some time at the surface. A diver who surfaces mid-dive (the owner, 2026-10-26: a
ghost net brought up to the boat, 4 minutes at the surface unrecorded) gets two Recordings and two Dives. Merging
(ADR 0038) is for the same descent logged twice and keeps one profile; here the profile is the two together. A Dive's
several Recordings have so far always been several computers' views of one descent, one of them Primary, and everything
that reads a profile (summary, assessment, export, SSI) reads the Primary one.

## Decision
- **A joined Recording**: appending builds a Recording from its parts on one time axis, each gap as 0 m depth and
  marked as a Surface break; it is the Primary recording. It is derived: no Original, no key an import matches, rebuilt
  whenever a part changes.
- **The parts' Recordings stay** on the kept Dive as its parts, with their Originals and keys, never Primary. Imports find
  them by key and update them in place.
- **The earlier Dive is kept; the later one is deleted as in a merge** (filled values, appended notes, Provider links
  moved where the kept Dive has none, else left on the deleted Dive so the Provider's import skips it as
  `deleted_earlier`; the Provider question in the dialog). Dive numbers follow ADR 0048.
- **Only the same Diver and the same Device**, each Dive with exactly one Recording or a joined one; any number of parts.
- **An append is one operation**, possibly of several Dives. **Restoring any Dive it took reverses it whole**, and every
  later append to the same Dive with it: the Dives get their parts back, the joined Recording is rebuilt from what
  remains (or deleted), and "two dives" is recorded for each pair separated.
- **Rule `surface_break`**: the later Recording starts at most 10 minutes after the earlier ends, neither a probable
  non-dive; a chain of pairs is one item; never obvious; rule version up by one. Also offered by hand on the dive page,
  without the 10 minutes.

## Considered options
- **Two Recordings shown as one profile** only when drawn: every reader would have to learn about parts, and "Primary"
  would stop meaning one Recording.
- **A new Recording replacing the two** (parts deleted): their keys would then answer `deleted_earlier`, and restoring
  would have nothing to give back.
- **Merging as it is** (ADR 0038): keeps one Recording and drops the other half of the profile.
- **Restoring without the Recording**, like a merge: leaves an empty entry for a Dive that had a profile.
- **Two parts only:** simpler, but a dive cut twice stays two Dives. **Undo of the last append only** (restore C before
  B): predictable, but not what the owner means by undo, which is the whole operation.

## Consequences
- A Dive can hold two Recordings of one Device; code that lists a Dive's Recordings must tell parts from computers.
- `recording.original_id` can no longer be required for every Recording (migration).
- Readers of the Primary recording see one series with a gap in every channel but depth; rules must not read the break's
  edges as rates.
- One more item kind in "Needs your decision"; new client duties ([client contract](../spec/clients.md), with the build).
