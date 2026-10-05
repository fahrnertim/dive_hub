---
title: "ADR 0026: Deleting a Dive: soft, restorable, not imported again; SSI asked in the same dialog"
summary: A Dive is deleted with its Recordings (one tombstone, a Revision), Originals and samples stay; re-imports skip its Recordings ("deleted earlier"); Undo on the logbook and a list of deleted dives to restore from; SSI is asked in the delete dialog and deleted there first, nothing is deleted when that fails; a declined SSI delete leaves a reminder on the logbook until it's gone from SSI.
status: accepted
date: 2026-10-05
---

# ADR 0026: Deleting a Dive: soft, restorable, not imported again; SSI asked in the same dialog

## Status
Accepted – 2026-10-05. Amended by [ADR 0027](0027-providers-as-adapters.md) (2026-10-05): deleting asks every Provider
the Dive is at (`alsoAt`, `stillAt`, `provider_*` codes) instead of SSI by name.

## Context
The [data model](../spec/data-model.md) says deletes are soft (A5), and ADR 0024 says deleting a Dive offers to delete
it in SSI too, with a reminder when the User declines. Neither said what happens to the Recordings, to a later
re-import of the same file, or how a User gets a Dive back. The code made those choices less obvious than they look:
- Re-imports find a Recording by its key, and the key is unique only among Recordings that aren't deleted. A deleted
  Recording would free its key, so any re-import, such as a whole Garmin account export, would create the Dive again.
  A Recording left live on a deleted Dive would be updated by re-imports and point the Import at a Dive that answers 404.
- SSI's delete is a network call of seconds; it can't run inside the hub's transaction.
- A Dive's history is read through the Dive, so a deletion would only be seen if deleted Dives can be seen somewhere.

The project owner chose on 2026-10-05: soft-delete the Recordings with the Dive and keep the Originals; skip a
re-import as "deleted earlier"; Undo plus a list of deleted dives; the reminder on that list and on the logbook; no
"Keep it in SSI" for now; Duplicate candidates unchanged.

## Decision
- **Deleting** (`DELETE /api/dives/{id}` with the version) sets the same `deleted_at` on the Dive and on its live
  Recordings, bumps the version and writes one Revision (cause `delete`). Only Users who manage the Diver can; others
  get 404. Originals, their files and the samples stay: an Original belongs to the User and can hold other Dives.
- **A deleted Dive is gone everywhere** a Dive counts: lists and totals, search, a site's `diveCount` and `inUse`, the
  Diver's count, Duplicate candidates' Dives, overlap matching for new Recordings.
- **Re-imports skip it.** The same file, or another file with the same Recording key, gives `skipped` with reason
  `deleted_earlier`; nothing is created or updated. The key stays taken for every User, so another User's file with it
  is still `not_your_diver`, and restoring can't clash with a newer Recording.
- **Restoring** (`POST /api/dives/{id}/restore` with the version) brings back the Dive and the Recordings deleted with
  it (cause `restore`). A site deleted meanwhile becomes the one it was merged into, else none. Restoring doesn't send
  the Dive to SSI.
- **Getting it back in the web client:** an Undo notice on the logbook right after deleting (it doesn't time out and
  can be dismissed), and "Deleted dives" at the bottom of the logbook (`GET /api/dives/deleted`, the newest 100).
- **SSI in the same dialog.** When the Dive is in SSI, the delete dialog asks "Delete here and in SSI" or "Delete only
  here". With `inSsi: true` the server checks the version, deletes in SSI first, then here. **If SSI fails, nothing is
  deleted** and the dialog shows why (ssi_* codes), offering both buttons again. If the Diver isn't connected any more,
  only "Delete only here" is offered.
- **The reminder:** a deleted Dive still in SSI says so in the list ("Still in SSI, as dive 8", with "Delete in SSI";
  `DELETE /api/dives/{id}/ssi` works on deleted Dives). The logbook shows a notice while any is; dismissing it lasts for
  the visit. There is no "Keep it in SSI" yet.
- **Duplicate candidates** keep their data. A deleted Dive just isn't offered; a candidate left without Dives says so.

## Considered options
- **Keeping the Recordings live** on the deleted Dive: re-imports would update a Dive nobody sees.
- **Re-creating the Dive on re-import:** simplest, but re-importing an account export would undo every deletion.
- **Bringing the Dive back on re-import:** surprising; restoring is the User's decision.
- **No undo, or only a timed Undo toast:** "deleted earlier" would then be a dead end, and errors and notices
  mustn't time out (WCAG 2.2.1).
- **Deleting here even when SSI fails:** the User asked for both; doing half would leave a reminder they didn't
  expect. They can choose "Delete only here" instead.

## Consequences
- Code that reads Dives or Recordings must keep skipping deleted ones (`deleted_at is null`), and code that looks a
  Recording up by its key must also look at deleted ones.
- Merging sites moves deleted Dives too, so a restore finds the kept site.
- Deleting a Diver still counts its deleted Dives, so a Diver isn't deleted from under them.
- Deleted Dives stay forever for now; purging them (and their Originals) needs its own decision.
