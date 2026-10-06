---
title: "ADR 0038: Logbook checks, and merging two Dives"
summary: Planned - a scan of the logbook for contradictions (a Dive without a Recording overlapping one with a Recording; two Dives of one Diver overlapping) by pure rules and the import's own matching, computed each time, shown in "Needs your decision" with resolutions (merge, two dives, correct a time, move to another Diver, delete); nothing merges unasked. Merging two Dives is fill the kept one, move the Provider link, delete the other the normal way. A Dive linked to a Provider moves to another Diver as a copy, the old one deleted with its link so the import doesn't bring it back. Amends 0016, 0030. Slices 18b (merge) and 18c (checks).
status: accepted
date: 2026-10-07
---

# ADR 0038: Logbook checks, and merging two Dives

## Status
Accepted – 2026-10-07 (owner). Slice 18b (merging, moving a linked Dive) is built, see the
[amendment](#amendment-2026-10-07-as-built-slice-18b); slice 18c (the checks) is planned. Amends
[ADR 0016](0016-recording-decisions-and-divers.md) ("Needs your decision" also holds logbook checks; moving a linked
Dive) and [ADR 0030](0030-importing-dives-from-providers.md) (entries are no longer kept out of that panel). Designed in
[Logbook housekeeping](../research/2026-10-07-logbook-housekeeping.md).

## Context
- A Recording is matched to Dives only when it arrives. A Dive that moves afterwards (its time corrected at the
  Provider and taken three-way, or edited by hand) is never matched again, so the outcome depends on the order of
  imports: a logbook entry typed with the wrong hour, its computer's file, then the corrected time leave two Dives
  side by side.
- Two overlapping logbook entries of one account become two Dives without a Recording: a Dive that has a remote dive
  isn't a candidate for another entry (ADR 0030), and Duplicate candidates are about Recordings (ADR 0016).
- Overlap proves nothing by itself: the owner's logbook also holds two entries typed five minutes apart that are two
  dives of a course. It can only be asked about.
- Two Dives can't be merged today, and moving a Dive to another Diver keeps its Provider link, so it goes on being
  updated from the old Diver's account.

## Decision

### Logbook checks (slice 18c)
- **Rules over the logbook as it stands**, pure and versioned like the dive assessment's (ADR 0036). Contradictions
  only, to start:
  1. a Dive without a Recording overlapping a Dive with one, by the import's own matching (`decideMatch`: its 5-minute
     tolerance and depth check), so a check never disagrees with what a fresh import would have done;
  2. two Dives of one Diver overlapping in time; between two Dives without a Recording a real overlap, no tolerance.

  Nothing about incomplete Dives (no site, no number, an unknown time zone).
- **Computed, not stored.** Only the User's answer is kept ("these are two dives", per rule and pair of Dives), so a
  pair is asked about once; it is asked again when one of the two changes its time.
- **Run** after an Import, after an edit of a start or duration, and when the logbook opens. No periodic job until there
  is a way to notify.
- **Shown in "Needs your decision"** beside the Duplicate candidates; an Import's outcome says how many there are.
- **Nothing merges unasked.** A check the import would have attached by itself is marked as obvious; the obvious ones
  can be applied together.
- **Resolutions:** merge into one Dive; they are two dives; correct a time (the dive page); move one to another Diver
  the User manages; delete one.

### Merging two Dives (slice 18b)
1. **The Dive with the Recording is kept**; of two without one, the one the User chooses (offered first: the one linked
   earlier). Two Dives that both have Recordings: the other's Recordings attach to the kept Dive (ADR 0016, 0030 decide
   the primary).
2. **The kept Dive is filled** from the other: site, Participants and values where it has none. Its own values win; the
   other's notes are appended, never dropped.
3. **The links move, Provider by Provider** (a Dive can be linked at several): where the kept Dive has no remote dive
   at a Provider, the other's link there moves to it, before the delete.
4. **The other Dive is deleted the normal way** (ADR 0026), its Revision naming the Dive it was merged into; the kept
   Dive gets a Revision `merge`. One transaction.
- Where both have a remote dive at the same Provider (two entries of one dive), the other's link there stays on the
  deleted Dive: that Provider's import skips the entry as "deleted earlier". Whether it is also deleted there is asked
  per Provider, as in the delete dialog (ADR 0027).
- The deleted Dive is listed under "Deleted dives" and can be restored (without the Recordings and link it gave away).
  No "merged" mark, no undo beyond that.
- Also offered on the dive page, without a check.

### Moving a Dive that is linked to a Provider
- **A copy, and the old one deleted:** the Dive is made anew for the other Diver with its values, notes, site and
  Participants; its Recordings move to the copy first; the old Dive is deleted the normal way and keeps its links, at
  every Provider it has one, so no import of the old Diver's makes the Dive again. Revisions `move` on both, each naming the other.
- The copy has no link. The other Diver's own Connections may link it on their next imports.
- **A Dive without a link moves as before** (ADR 0016): its Recordings travel with it and a re-import finds them by key.

### Any Provider, not SSI
SSI is the only Provider that links Dives today; more will. Merging, moving and the checks live in the generic layer
and read links as the Pushes do (per Dive and Provider, `currentRemote`), never a Provider by name:
- a rule that looks at logbook entries compares entries **of one Provider**. The same dive typed at two Providers is
  no contradiction: the second Provider's import links its entry to the Dive the first one made (ADR 0030 matches per
  Provider already);
- a Provider that can't delete or doesn't give an ID back (handed over, ADR 0027) is simply not asked;
- the tests run with SSI's fake and the ledger adapter together: a Dive linked at both is merged and moved.

### Words
- **Logbook check** (_Logbuch-Prüfung_; on screen an item is "something to tidy"). Not a Duplicate candidate (a
  Recording waiting for its Dive), a Finding (the dive assessment's) or a Conflict (one value changed in two places).

## Considered options
- **Two point fixes** (matching again when a start moves; comparing entries in the preview): each covers one order of
  events; hand edits and restores would need their own.
- **Merging automatically when the file's Dive is untouched:** a Dive would disappear unasked, and "untouched" needs its
  own definition. One click instead.
- **A "merged into" mark** like a merged Dive site's (ADR 0022): the normal delete does it once the Recordings and the
  link have gone to the kept Dive.
- **Stored issues:** they would go stale with every edit.
- **Moving a linked Dive by dropping its link:** the next import makes the Dive again. **Refusing while linked:** leaves
  the User with a Dive in the wrong logbook.

## Consequences
- The order of imports no longer decides what a logbook looks like for good; what import-time matching missed is asked
  later.
- "Needs your decision" holds two kinds of item; clients show both (the [client contract](../spec/clients.md) changes
  with slice 18c).
- A moved linked Dive has a new ID; links to the old one end at a deleted Dive that names the new one.
- A Dive deleted by a move or by merging two entries shows the "still at the Provider" reminder until it is deleted
  there too.
- Pairs with wrongly typed times are asked about once, like real duplicates.
- `apps/server/test/dive-merging.test.ts` holds both observations and their merges.

## Amendment 2026-10-07: as built (slice 18b)
- **A link is moved by moving the Pushes** of the other Dive at that Provider to the kept Dive: what Dive Hub sent and
  last saw there (the base of ADR 0030's three-way comparison) stays with the link, and the deleted Dive is at no
  Provider any more. No migration.
- **The route keeps the Dive with a Recording whichever of the two is asked** (`POST /api/dives/{id}/merge`), and
  answers the kept Dive; `GET /api/dives/{id}/merge-candidates` says beforehand which that is and at which Providers both
  are.
- **Values filled beside a Recording become Overrides** (a water temperature only the entry had): otherwise the next
  refresh from the Recording would drop them.
- **History:** the Recordings that come across are `attach` entries; the merge is one entry (`merge`) after them.
- **Any two Dives of one Diver can be merged** through the API; the dive page offers it for Dives that overlap.
- **A deleted Dive says where it went** (`mergedInto`, `movedTo`), read from its last Revision; no column.
- **The dive page tells of an overlapping Dive already** (a notice with "Merge the two…"). Slice 18c adds the logbook's
  panel, remembering "these are two dives", and the count after an Import.
- **Not carried over:** findings put aside on the Dive that goes; they are computed again on the kept Dive.
