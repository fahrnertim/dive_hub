---
title: Logbook housekeeping (findings and proposal)
summary: Two observations on the owner's logbook - a hand-typed SSI entry whose time was corrected after its computer's file came in stands beside the file's Dive, and two overlapping SSI entries became two Dives nobody was asked about - are gaps in ADR 0030 and ADR 0016, not bugs and not caused by the Suunto import. Proposed instead of two point fixes - a scan of the logbook for contradictions (overlapping Dives) that offers resolutions in "Needs your decision"; merging two Dives as fill, move the Provider link, normal delete. Decided in ADR 0038 (slices 18b, 18c); nothing built but a reproducing test.
status: decided
date: 2026-10-07
---

# Logbook housekeeping (findings and proposal)

## Question

The owner saw two things in his logbook right after importing two Suunto JSON files (slice 18a):

1. A dive whose time was changed in SSI no longer comes together with the Dive it belongs to.
2. Two SSI dives that must be duplicates stand in the logbook as separate Dives.

Is either caused by the Suunto import, what is the cause, and what should happen instead?

## Method

- The owner's development instance was read (database and the stored SSI Originals, read-only). Dates, times, depths
  and SSI numbers of his dives are left out of this note.
- Both were reproduced with hand-made dives (`apps/server/test/dive-merging.test.ts` since slice 18b): a control and the
  two reproductions, each followed by its merge.

## Findings

### 1. A corrected time leaves two Dives side by side

- The SSI dive was typed by hand with a wrong hour (evening instead of morning). The first SSI import made a **Dive
  without a Recording** from it, at the wrong time.
- The Suunto JSON of that dive came later. Nothing was within reach of its time, so it rightly became a Dive of its own.
- The owner corrected the time in SSI. The next SSI import took it: the three-way comparison of slice 15b moved the
  entry's Dive ("Updated from its source", start time only). It now overlaps the file's Dive, and nothing looks again.
- **Cause:** a Recording is matched to Dives only when it arrives (`imports/placement.ts`); a Dive that moves afterwards
  (`takeChanges` in `providers/dive-import.ts`, or an edit by hand) is never matched again. The result depends on the
  order of imports: with the time right from the start, the file attaches to the entry's Dive (the control; the owner's
  other Suunto dive did exactly that).
- **Not the Suunto import:** a Garmin file would have done the same. A gap in ADR 0030's amendment "changes made at the
  Provider come back", not a departure from it.

### 2. Two overlapping entries become two Dives

- Both SSI dives were typed by hand (no computer, no profile): the same day, site, notes and buddies, starting a
  quarter of an hour apart with nearly the same duration and depth, so they overlap for about half an hour. Both have
  been Dives without a Recording since the first SSI import; no Suunto file is involved.
- **Entry matching** saw the first entry's Dive inside the second one's window, but "a Dive that already has a remote
  dive at the Provider isn't a candidate" (ADR 0030, matching details), so the second entry made a new Dive.
- **Duplicate candidates** exist only for Recordings (ADR 0016); ADR 0030 kept entries out of "Needs your decision" on
  purpose. Two Dives without a Recording are never compared.
- **A gap in what was decided**, there since slice 15.
- **Overlap alone proves nothing.** The same logbook holds another pair typed five minutes apart that is plainly two
  dives (very different depths, notes numbering them as dives of a course): the typed times are wrong, not the dives
  doubled. So an overlap can only be asked about, never merged unasked.

## Proposal (owner's idea, 2026-10-07)

Instead of two point fixes (re-matching when a start time moves; comparing entries in the preview): a **housekeeping
scan** of the logbook that finds contradictions, tells the User there is something to tidy, and offers resolutions. It
is independent of the order things arrived in, and it also covers hand edits and restored Dives.

- **Rules over the logbook as it stands**, pure and versioned like the dive assessment's rules (ADR 0036). To start,
  contradictions only:
  - a Dive without a Recording overlapping a Dive with one (finding 1);
  - two Dives of one Diver overlapping in time (finding 2, and the pair that is two dives).

  Nothing about incomplete Dives (no site, no number, an unknown time zone): that would be a list of nags.
- **The same matching as an import** (`decideMatch`, its tolerance and depth check), so the scan never disagrees with
  what a fresh import would have done.
- **Computed, not stored.** Issues are worked out from the logbook each time; only the User's answers are kept ("these
  are two dives", per rule and pair), so a pair is asked about once.
- **Run after imports and edits and when the page opens.** A logbook changes no other way, so a periodic job adds nothing
  until there is a way to notify (e-mail).
- **One inbox:** in "Needs your decision" beside the Duplicate candidates; an Import's outcome says how many things
  there are to tidy.
- **Nothing merges unasked.** The obvious cases are marked as such and can be applied in one go.
- **Resolutions per issue:** merge into one Dive; they are two dives (remembered); correct a time; move one to another
  Diver the User manages (ADR 0016); delete one.

### Merging two Dives

Settled with the owner (2026-10-07): no new mark and no special removal.

1. **Keep the Dive that has the Recording** (of two without one: the User's choice, by default the earlier link).
2. **Fill it from the other:** site, Participants, notes where it has none, as the import's "link and fill" does.
3. **Move the Provider link** (the Pushes) to the kept Dive, before deleting: otherwise the entry counts as "deleted
   earlier" and never links to it.
4. **Delete the other Dive the normal way** (ADR 0026), with a Revision saying what it was merged into. It has no
   Recording and no link then, so its tombstone blocks nothing and no "still in SSI" reminder appears.

For two entries of one dive (finding 2) the second link can't move (a Dive has one remote dive per Provider): the
second Dive is deleted with its link, and the import then skips that entry as "deleted earlier", which is the
remembered "leave out". Whether it is also deleted at the Provider is the question the delete dialog asks already.

Accepted: the deleted Dive is listed under "Deleted dives" and can be restored, as a Dive without a Recording or link
beside the merged one. Rare and harmless, and a rough undo.

## Decisions

**Decided 2026-10-07** ([ADR 0038](../decisions/0038-logbook-checks-and-merging-dives.md)): 1, 2, 4 and 5 as recommended; 3 as
the owner proposed. As they were put:

1. **The name** of the feature and of one item, for the glossary (en, de). Not Duplicate candidate, Finding or Conflict.
   *Proposed:* "Logbook check" / "Logbuch-Prüfung", an item "something to tidy" on screen.
2. **Which values win** when both Dives have one (two different notes, two sites). *Recommend:* the kept Dive's; the
   other's notes are appended, never dropped.
3. **A Dive linked to a Provider moved to another Diver:** unlink, or refuse while linked. *Recommended:* refuse and say
   why. *Decided (owner):* a copy for the other Diver and the old Dive deleted with its link: dropping the link would let
   the next import make the Dive again, and the deleted Dive is what keeps the entry out. A Dive without a link moves as
   before.
4. **Overlap rule's tolerance** for two Dives without a Recording (typed, rounded times): real overlap only, or the
   5 minutes of the file matching. *Recommend:* real overlap, to keep back-to-back dives quiet.
5. **Order:** the merge first (it heals finding 1 from the dive page already), then the scan and its panel; one ADR for
   both, amending 0016 and 0030.

## Skills

`npx skills find` for "data quality", "duplicate detection", "data cleanup", "record merge": nothing fits (recorded in
[skills](../skills.md)). `tdd`, `codebase-design` and the uxcel skills cover the work.

## Sources

- The owner's development instance (not committed) and `apps/server/test/dive-merging.test.ts`.
- [ADR 0030](../decisions/0030-importing-dives-from-providers.md), [ADR 0016](../decisions/0016-recording-decisions-and-divers.md),
  [ADR 0026](../decisions/0026-deleting-dives.md), [ADR 0037](../decisions/0037-suunto-file-import-and-file-formats.md),
  [ADR 0036](../decisions/0036-dive-assessment.md) (rules, dismiss), [ADR 0022](../decisions/0022-merging-sites-and-site-list-paging.md).
