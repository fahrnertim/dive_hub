---
title: "ADR 0016: Deciding about Recordings; Devices assigned for the future; extra Divers per User"
summary: Duplicate candidates are resolved on the logbook (add, new Dive, discard that keeps the Recording); Recordings can be split off; reassigning a Device affects only future Imports, single Dives can be moved; Users keep extra Divers, sharing comes later.
status: accepted
date: 2026-10-03
---

# ADR 0016: Deciding about Recordings; Devices assigned for the future; extra Divers per User

## Status
Accepted – 2026-10-03. Amended by [ADR 0028](0028-shared-divers-and-participants.md) (2026-10-05): every User sees every
Diver by name; external Divers are managed by no one; Participants are built. Amended by
[ADR 0034](0034-equipment-items-and-service-schedules.md) (planned, slice 21): each Device is linked to an Equipment item.

## Context
Slices 1–5 recorded Duplicate candidates but left no way to decide them, filed every Recording
under the Device's Diver with no way to change it, and gave each User exactly one Diver. The
[data model](../spec/data-model.md) asks for Duplicate candidate resolution, says detaching a
Recording is always possible, and lets a User manage several Divers. The project owner chose on
2026-10-03: Device reassignment affects future Imports only (single Dives can be moved), sharing
a Diver with another User comes later, candidates are resolved on the logbook, and browser tests
cover the flows.

## Decision
- **Duplicate candidates** wait in a "Needs your decision" panel on the logbook, with the
  Recording (time, depth, duration, Device, reason) and the Dives it might belong to. The User can
  **add it to one of those Dives**, **make it a Dive of its own** (for the Device's Diver if they
  manage it, else their own Diver), or **discard** it. A candidate is open while `resolution` is null.
- **Discard keeps the Recording**, detached and hidden. Importing the same file again then updates
  that Recording in place instead of asking again, and the User can **reopen** it.
- **Splitting a Recording off** makes it a new Dive of the same Diver. If it was the Primary
  recording, the earliest remaining Recording takes over and values without Override follow.
  A Dive's last Recording can't be split off (that would only move the Dive).
- **Devices** are listed with the Diver they belong to. **Reassigning a Device affects only Imports
  from then on**; Dives already in a logbook stay. A single Dive can be **moved** to another Diver
  the User manages (the week a computer was lent). Unknown Devices still go to the User's own Diver.
- **Extra Divers:** a User can add, rename and delete Divers whose logbooks they keep (a child, a
  guest). Only Divers without Dives or Devices can be deleted; the own Diver can't be.
- **Sharing a Diver with another User** (two parents) comes later, together with Participants and
  Buddy suggestions, where the open question of how to find another User's Diver must be answered.
- **Revisions** record every decision: `attach`, `detach`, `create`, `move`, and `assign-device`
  (on the Device).
- **Recordings are named by their Device** in the UI ("Garmin Descent Mk3 (777)"), not "Recording 2".

## Considered options
- **Device assignments with dates** (who had the computer when): most accurate for lending, but
  more to build and to explain; a later option if lending is common.
- **Reassigning a Device moves its past Dives:** right for a setup mistake, wrong for lending.
- **Discard deletes the Recording:** a re-import would ask the same question again.
- **A separate "to decide" page:** the logbook is where Users land after an import.

## Consequences
- Every Dive can now change Diver; anything keyed by Diver (statistics, Visibility later) must not
  assume a Dive stays where it was imported.
- Users never see a Recording disappear: discarded ones stay findable.
- Diver sharing will need rules for deleting shared Divers and for who may move Dives between them.
