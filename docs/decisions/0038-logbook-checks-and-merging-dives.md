---
title: "ADR 0038: Logbook checks, and merging two Dives"
summary: Built (slices 18b, 18c) - a scan of the logbook for contradictions (a Dive without a Recording overlapping one with a Recording; two Dives of one Diver overlapping) by pure rules and the import's own matching, computed each time, shown in "Needs your decision" with resolutions (merge, two dives, correct a time, move to another Diver, delete); nothing merges unasked. Merging two Dives is fill the kept one, move the Provider link, delete the other the normal way. A Dive linked to a Provider moves to another Diver as a copy, the old one deleted with its link so the import doesn't bring it back. Amends 0016, 0030. Amended 2026-10-07: a fourth rule about one Dive, short_shallow_dive (a Recording under 2 minutes above 3 m, at no Provider: delete or keep, rule version 3); the same test in matching is open for the next slice.
status: accepted
date: 2026-10-07
---

# ADR 0038: Logbook checks, and merging two Dives

## Status
Accepted – 2026-10-07 (owner). Built on 2026-10-07: slice 18b (merging, moving a linked Dive) and slice 18c (the checks);
what the builds settled is in the two amendments below. Amends
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

## Amendment 2026-10-07: as built (slice 18c)
- **Two rules, version 1:** `recording_beside_entry` (exactly one of the two Dives has a Recording; the import's five
  minutes of tolerance) and `overlapping_dives` (both or neither has one; a real overlap). The depth check doesn't decide
  whether a pair is a check, only whether it is **obvious**: one partner each, depths agreeing, no dive left over at a
  Provider.
- **The answer is kept per pair** in `logbook_check_answer` with the two starts it was given for; a changed start asks
  again. It can be taken back (Undo, "Ask again").
- **A deliberate split is an answer.** Splitting a Recording off its Dive, or making a Dive of a Duplicate candidate,
  records "two dives" for the pairs it makes: the User just decided that.
- **The dive page follows the same rules:** its merge candidates are the Dive's checks, and an answered pair is no longer
  hinted at there.
- **Run on reading**, not as a job: the web client reads the checks with the logbook, so they are up to date after every
  import, edit, merge, move and delete. An Import's outcome doesn't carry a count; the panel above the logbook shows it.
- **"Merge the clear pairs"** is offered from two obvious pairs on, after saying what it does; the client merges them one
  by one.
- **Resolutions** on the panel are merge and "two dives"; correcting a time, moving and deleting stay on the dive page,
  which the panel links to and says so.

## Amendment 2026-10-07: after the first use (owner)
- **A dive Dive Hub sent follows its link.** Its record at the Provider carries a reference to the Dive it was sent from.
  When that Dive was merged into another, the import now takes the Dive the link is on (the kept one) instead of the
  one the reference names, so changes made at the Provider keep coming back three-way (ADR 0030). A Dive moved as a copy
  is unchanged: its links stayed on the deleted Dive, and the import skips it.
- **Which Dive is kept is said three times:** on the dive page's hint, on each pair in "Needs your decision" ("stays
  when merged"), and in the dialog, where the two are listed as "Stays" and "Goes to deleted dives" with what tells them
  apart. "This dive is kept" said nothing on the logbook, where both are listed.

## Amendment 2026-10-07: a third rule, `entry_apart_from_recording` (built, rule version 2)
Why: a Recording's start and the same dive typed into a Provider's logbook can lie hours apart (the Suunto and SSI
mismatch, [research note](../research/2026-10-07-suunto-ssi-mismatch.md)). Matching (ADR 0030) cannot see them as one
dive and must not guess; a check can offer the pair and let the User decide.
- **A new rule, not a changed one.** `recording_beside_entry` keeps its five minutes, because a check there has to agree
  with what a fresh Import would do. The new rule is added after it and `LOGBOOK_CHECKS_VERSION` becomes 2.
- **A pair is found when:** same Diver; exactly one of the two has a Recording; the same local day (each Dive's own
  offset, or its wall-clock time where the offset is unknown); depths within max(0.2 m, 3 %); durations within 3 minutes;
  and the pair does not overlap (that is `recording_beside_entry`). A neighbouring day is not looked at: a night dive
  across midnight can be missed.
- **One to one, nearest start wins.** A Dive is in at most one pair of this rule; a tie gives no suggestion.
- **Never obvious.** The pair is not part of "Merge the clear pairs"; each one needs the User's own click.
- **Fixed numbers, no setting.** To be revisited once there is more than one Provider's data to learn from.
- **Reused as they are:** merge (the Dive with the Recording is kept and the Push links move), the per-pair answer
  ("two dives", Undo) and muting.
- **After the merge** the kept Dive is outdated at the Provider; "Send update" pushes its start time. At SSI this removes
  the dive centre's QR verification of that entry, so the card says so before the User sends.
- **Clients** get a duty: showing the rule's text and both local times with their difference
  ([client contract](../spec/clients.md), updated in the same change).
- **As built:** `ruleFor` says whether a pair qualifies; `findChecks` then keeps, nearest start first, each Dive in one pair at
  most, and drops both pairs of a Dive with two equally near partners (it is not offered a farther one either). Depth needs
  both values. The dive page's merge candidates use the pairwise test only (no one-to-one), so they may hint at a pair
  the panel left out for a tie. Not built: the warning about the Provider's verification on the "Send update" card
  (the panel's rule text and the client contract do not cover it yet).

## Amendment 2026-10-07: a fourth rule about one Dive, `short_shallow_dive` (rule version 3)
Why: a dive computer that gets wet for a moment records a "dive": switched on at the surface, a test, or a false start
(down a metre or two, something with the buddy, up again; the computer ends the dive and the real one starts as a new
Recording). Such a Dive is clutter in the logbook and in its counts, and it can get in the way of matching (below).
Decided with the owner on 2026-10-07.

- **A check about one Dive.** "Contradictions only" of the Decision is widened by this one rule: a Dive that is probably
  no dive. It lives with the logbook checks, not the dive assessment (ADR 0036): it is something to tidy that ends in a
  delete, not a remark on diving practice.
- **A Dive is found when** it has a Recording, lasts under 2 minutes, its maximum depth is known and under 3 m, it is at no
  Provider, and it was not made from a Provider's entry (`fromProvider`).
  - **Depth is part of it:** ninety seconds to 12 m is an aborted descent, a real dive.
  - **Entry-only Dives are left out:** a typed entry of two minutes is a typo; its fix is the duration, not a delete.
  - **Dives linked at a Provider are left out:** a short Dive carrying a Provider's entry is more likely a wrong link than
    clutter, and deleting at a Provider can't be undone. It gets no suggestion; the User sees it on the dive page.
- **Fixed numbers, no setting,** conservative on purpose. The evidence is thin and said so: the owner's logbook (136 Dives,
  read-only on 2026-10-07) has one Dive under 14 minutes, 50 s at 1.8 m, a false start whose real dive began 5 min 24 s
  after it, and one unattached Recording of 20 s at 2.1 m. Any limit between 51 s and 14 minutes finds the same Dive there.
- **Resolutions:** delete, through the existing delete dialog (ADR 0026; it can be restored), or "keep it". The panel
  never deletes by itself.
- **"Keep it" is kept per Dive** with the duration and depth it was given for; a change of either asks again. Undo and
  "Ask again" as for pairs. **Restoring such a Dive is an answer** ("keep it"), as a deliberate split is "two dives".
- **Never obvious,** and part of no action that handles several checks at once.
- **Clients** get a duty: a check can be about one Dive (`other: null`), with delete and "keep it"
  ([client contract](../spec/clients.md), updated in the same change).
- **As built:** `probablyNoDive` (Recording, duration, depth) and `suggestsDeleting` (also: at no Provider, not from an
  entry) in `logbook-check-rules.ts`; the answer in `logbook_check_dive_answer` (Dive, rule, the duration and depth it was
  given for). `GET /api/logbook-checks` lists such a Dive with `other: null`; `PUT /api/logbook-checks/answer` takes one
  id with `keep`. An answer is compared, not dropped: a Dive that returns to the duration and depth it was kept with is
  kept again. Restoring records "keep it" whenever the Dive is probably no dive, linked or not. In the web client the
  Review page has a group of its own ("Probably not dives"), the logbook's line counts it, "Delete…" opens the delete
  dialog and lands on the logbook with its Undo. Not tested through the API: a short Dive at a Provider getting no
  suggestion (the pure rule's test covers it).

### The same test in matching (done 2026-10-07: [ADR 0030, amended](0030-importing-dives-from-providers.md#amended-a-probable-non-dive-is-never-matched-by-itself-owner-2026-10-07); rule version 4)
Built as planned below, with two corrections to what was written here: `decideMatch` does not decide
`recording_beside_entry` (the rules share its parts, `overlaps` and `depthsDisagree`), so what followed is only `obvious`:
a pair with a probable non-dive in it is listed but never obvious, and is no second partner that makes another pair
ambiguous. And the import's "decide" step did take a single candidate already, while the preview only counted the
automatic links. A short Dive linked at a Provider getting no suggestion is tested through the API now
(`false-start-import.test.ts`).

What the owner's question about false starts had found:
What the owner's question about false starts found, read from `imports/matching.ts` and `providers/dive-import.ts`:
- **An entry links to a single Dive in its window without a depth check.** When the false start and the real Recording
  lie within the import's 5 minutes, the real Recording waits as a Duplicate candidate (depths disagree), the false
  start is the only Dive, and the Provider's entry of the real dive links to it by itself.
- **A false start attaches by itself to an entry that has no depth** and becomes its Primary recording: the Dive then
  shows 50 seconds.
- **Planned:** a Dive or Recording this rule's test calls a probable non-dive is never linked or attached automatically;
  the import asks, with "new dive" as a choice. One shared predicate (`probablyNoDive` in `logbook-check-rules.ts`), so
  check and import can't disagree. It needs ADR 0030 read in full and an amendment there; `decideMatch` also decides
  `recording_beside_entry`, so the two are decided together. Not verified yet: whether the import's "decide" step takes a
  single candidate, and whether the preview shows an automatic link before it runs.
- Until then, deleting a false start takes it out of every matching (ADR 0026), so the check already lowers the risk.
