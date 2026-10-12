---
title: Freeing Dive numbers at a Provider - what happens today, six strategies judged, a recommendation
summary: When "Set number" or a Push run meets a number another dive at the Provider holds, Dive Hub only names the holder. The cases that really occur (a shift, a swap, a cycle, a holder that is a Dive here, a holder only at the Provider), the six strategies judged against them, and a recommendation that amends ADR 0048 without ever making a duplicate. The owner's questions are at the end.
status: proposed
date: 2026-10-12
---

# Freeing Dive numbers at a Provider

Amends [ADR 0048](../decisions/0048-dive-numbers.md) (as a new ADR 0052, after the owner's answers). Background:
[Dive numbers](2026-10-09-dive-numbers.md), [Push runs](2026-10-09-push-runs.md).

## What happens today (read 2026-10-12)

- **"Set number"** (`pushes.setNumber`, `push-service.ts`): the adapter reads the logbook, finds another dive with the
  number and answers `taken`. A failed `number` Push is recorded and `provider_number_taken` (409) goes out with
  `existing` (the holder: number, start) and `diveId` (the Dive here, if known). The web shows the text "Another dive in
  SSI has that number. Change the number of that dive first." and a link to the Dive when `diveId` is known
  (`ProviderPanel.tsx`). Nothing else is offered.
- **A Push run** (`push-run-plan.ts` `orderItems`): number changes go first, each when no other dive Dive Hub knows holds its
  number, highest wanted first. What can't be ordered (dives only swapping among themselves) is left out as
  `number_taken` and reported "set it from its page". A holder only at the Provider is found at send time and skipped
  with the same reason (`push-run-service.ts`). The preview shows counts (`counts.number`, `numberTaken`), never the
  numbers.
- **The preview reads no logbook** (`analyse`: "from Dive Hub's data alone"). The holders that matter are known only
  when an item is sent.
- **SSI itself doesn't refuse a duplicate** (owner's checks, ADR 0048 "As built"): it takes a number twice on an update and
  on a create. So the rule "never a duplicate" is Dive Hub's, kept by the adapter reading the logbook before each save.
  It also means a scratch number is not a problem for SSI, only for Dive Hub's rule that nobody chose it.
- **Verification:** SSI declares `changeRemovesVerification: true`; that is a declaration for the Provider, Dive Hub does
  not know which single dive is verified.

## The cases that occur

| # | Case | How it arises | Today |
|---|---|---|---|
| A | **Shift** | an older Dive is added or imported: every later Dive wants +1 (or −1 after a delete or merge) | works in one run, highest first (or lowest first down); more than `maxDives` (SSI 100) takes several runs |
| B | **Swap** | two Dives change places (a start time was corrected) | left out, "one by one through a free number" - the User has no free number to hand |
| C | **Cycle of k** | the same with three or more | as B |
| D | **Holder is a Dive here** | the holder's own change wasn't chosen (updates only, verification skip, ceiling, a Dive with no number) | named, link to the Dive; the User sets that one first, then repeats |
| E | **Holder only at the Provider** | an SSI dive Dive Hub doesn't have (not imported, or older than the logbook's "dives before") | named, no link; nothing the User can do inside Dive Hub except import it |
| F | **Holder is a Dive here that has no number** | an apnea session that doesn't count keeps the number it had at SSI | as D, but its own change can never come: only the import-or-accept path remains |

The common real case is A, and it already works. B and C are rare but have no way out today. D is a chain the User
walks by hand. E is the one that nags forever.

## The strategies, judged

**1. Park and place (cycle breaking).** For a swap or cycle, move one member to a scratch number, set the others, then
set the parked one. One extra save per cycle (k+1 saves for k dives). *Judgement: build, inside a run only.*
- The scratch number: the adapter's choice at send time, **a free number above the highest in the logbook it just
  read**, the number SSI itself hands out for the next create. Never a number outside any logbook (0, negative, 99999):
  SSI hasn't been checked on those and they could be shown oddly in the app. The plan can't pick it, because holders
  only at the Provider are unknown to it.
- **Verification costs nothing extra:** every member of a cycle changes its number anyway, so a verification lost to a
  change is lost once either way. The one case parking matters: a member that isn't in the run (its verification skip
  wasn't ticked). Then it isn't a cycle for this run but case D, and nothing is parked.
- **A stopped run needs no state.** Plans are computed from the numbers on the Pushes. If the run stops after the park,
  the parked Dive's status reads "In SSI this is dive 143; here it is dive 12" (number differs). The next run plans it
  like any change and places it once 12 is free. The cost: until then SSI's logbook shows a dive with a number nobody
  chose. A run's report must say it plainly ("parked at 143, placed at 12"), and the dive's page shows the usual
  "number differs".
- **Adapter contract change (said here first):** a new optional `parkNumber(remoteId): Promise<{ result: 'set'; remoteNumber } | null>`
  on `DiveExportAction`, declared as `numbers.park: true` beside `set`; contract test: `park` and `setNumber` go
  together. SSI: the same write as `setNumber` with the number from its read. The fake ledger gets it as well.
- Cost in code: `orderItems` finds the cycles in what it can't order and returns one member per cycle as `park`, the
  run item gets a `park` flag (one boolean column on `push_run_item`), the step re-queues the Dive behind the others
  (the machinery for `provider_busy` does this already).

**2. Make room by ordering only (a numbers preview).** What 0048 does, extended: the plan is shown to the User before
anything is sent, as every number it sets. *Judgement: build, and it's the owner's "no 'all' without a preview of every
number it sets" made true.* The preview gets `numberPlan`: `{ diveId, number (the Dive's here), from, to, step: 'set' | 'park' | 'place' }[]`
in sending order (`maxDives` items, so at most 100 at SSI), the scratch shown as "a free number above your highest,
chosen when it is sent". The run's own report lists what was done the same way.

**3. The holder is a Dive here.** *Judgement: build, as an explicit second action, not by changing "Set number".*
- The error names the Dive (it does) and the page offers **"Set the number with the dives in its way"** next to it.
  It opens the **numbers preview** for exactly those dives (the chain: every Dive here whose number at the Provider is
  wanted by one in the set, transitively) and the User starts it as a run. No new engine: the run takes `ids` and the
  three choices already; the new part is a way to ask for the chain, `withHolders: true` on the preview/start request
  (scope expanded server-side, bounded by `maxDives`, and refused with the unchained holder named if the chain
  reaches case E or F).
- Why a run and not a synchronous call: it is several saves of a paced Provider, it needs the lease, stop and report,
  and the run already has them.
- "Set number" on one Dive stays one save, as the owner decided.

**4. The holder is only at the Provider.**
- **(a) Import it** so it becomes a Dive here and joins the plan: *build as a lead, not as a feature.* ADR 0030 does the
  work already. What is new is the lead: the error and the run report name the holder (number, date, depth) and link to
  the import, and say what importing does: "it becomes a Dive here, and the numbers after it move by one".
  Importing shifts Dive Hub's computed numbers (case A), so after it the run is a chain. The imported dive itself, with
  its SSI number differing from its computed one, only moves when the User ticks `numbers`.
- **(b) Renumber that remote dive to a free number:** *not recommended; owner decides.* It changes a dive Dive Hub
  doesn't own, in the User's own SSI logbook (possibly a verified one, with the number printed on a card or
  certificate), to make Dive Hub's tidy. (a) reaches the same end through a dive that is then ours. If the owner
  wants it: a per-dive action on the single page, confirmation naming the dive and the new number, never in a run,
  never default.
- **(c) Leave the number differing, accepted** (this is also strategy 6): see there.

**5. Fresh read before planning.** *Judgement: build, for the numbers case only.* When the run asks for `numbers` and at
least one number differs, the preview reads the Provider's logbook once (one `get_divelog`, which the adapter already
keeps for a minute for the next save), so remote-only holders show before the run starts, per item, as "held by a dive
only at SSI: 2025-01-01 09:00, 18 m", with the import lead. The plan treats them as fixed numbers; the scratch number
and the order are then known to be right (and are re-checked at send time, as today). A new read-only adapter method
`heldNumbers(): Promise<RemoteDive[]>` is needed unless the import's listing (ADR 0051 uses a complete, fresh read)
can be reused; **check when building**, prefer reuse. Without `numbers` ticked, the preview stays as it is (no
Provider call).

**6. A gap strategy: "Keep SSI's number for this dive".** *Judgement: don't build in this slice; owner decides.* It is
the honest end for case E and F when the User will neither import nor change anything: the dive's number there is
accepted, the logbook stops showing "number differs" and counting it, and plans treat that number as fixed (a held
number like any remote-only one). Cost: a new fact per Dive and Connection ("accepted number X") that lapses when the
number there changes, a new meaning for "differs" in `current.number`, `counts`, the logbook filter
`changed-since-sent` and the client contract. It can be stored without a migration as a Push action
(`accept_number`, copying the fingerprint like `number` does). It frees no number, so it is not part of freeing; if
the owner wants it, it is the next slice.

## Recommendation

Build **1 + 2 + 3 + 4a + 5**; leave **4b** and **6** unless the owner asks.

What each case gets:

| Case | After |
|---|---|
| A | as today, plus the preview lists every number |
| B, C | parked, set, placed in one run; the report says which was parked |
| D | "Set the number with the dives in its way": preview, then a run |
| E | named in the preview before anything is sent, with an import lead; nothing changes at SSI unasked |
| F | named, same lead; no way inside Dive Hub other than import or change of the Diver's apnea setting, said so |

Rules kept: never a duplicate (the adapter checks the logbook it just read before each save, scratch included);
nothing renumbered unasked (every number is in a preview the User started); nothing changed that Dive Hub doesn't know.

Amended in ADR 0048: "On 'Set number': refused ... The User sets that one first" gets "or asks for the chain"; "Dives that
only swap numbers among themselves can't be ordered" becomes "are parked"; "A number held by a dive only at the
Provider is found when the item is sent" becomes "found when the preview is made, where `numbers` is ticked".

## Tests (red first)

Server, `provider-numbers.test.ts` and `push-runs.test.ts` with the fake ledger:
1. a swap: the run parks one, sets the other, places the first; the ledger never holds a number twice at any step
   (the fake records every save and the test checks it); the report has `park` and `place`.
2. a cycle of three; a cycle where one member isn't chosen is a chain end, not parked.
3. the run stopped after the park: the next run's plan places the parked Dive (stateless).
4. the preview with `numbers` reads the ledger once and names a remote-only holder; without `numbers` no read.
5. `withHolders`: the chain of D in order; refused naming an E holder; bounded by `maxDives`.
6. the scratch number is above every number in the ledger, including remote-only ones, and no duplicate if a dive is
   added to the ledger between the plan and the send.
7. contract test: `numbers.park` and `parkNumber` go together; SSI declares it.
Web: the error shows the chain action (D) or the import lead (E); the preview lists the numbers at 390 px and in
German; the run's report shows parked/placed.

## Client duties (for clients.md)

`numberPlan` in the run preview and `withHolders` on the request; show every number a run sets before it starts, the
scratch as "a free number, chosen when sent"; the report's steps; on `provider_number_taken` lead to the chain (when
`diveId`) or to the import (when not), and say what each does.

## Questions for the owner

1. A scratch number: allowed, where, and is "a parked dive keeps a number nobody chose until the run continues" acceptable?
2. A holder only at SSI: import lead only, plus renumbering it per dive (4b), plus accepting its number (6)?
3. Verified dives in a chain: touch with the existing warning and second tick, ask once per run, or never?
4. May one Dive's page start a chain, and how?
