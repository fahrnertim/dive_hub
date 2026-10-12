---
title: "ADR 0052: Freeing a Dive number at a Provider - a swap goes through one shared number, the plan is shown, a chain is a run"
summary: A Push run breaks a swap or cycle of numbers by letting one dive share its wanted number with the dive that holds it for the length of one save (no scratch number; SSI itself takes duplicates), shows every number it will set before it starts, reads the Provider's logbook once to name holders that are only there, and a Dive's page can ask for the chain of dives in its way as a run. A number held by a dive only at the Provider is named with a lead to the import; nothing there is renumbered.
status: accepted
date: 2026-10-12
---

# ADR 0052: Freeing a Dive number at a Provider

## Status
Accepted – 2026-10-12 (the owner's answers the same day, marked "owner"). Amends [ADR 0048](0048-dive-numbers.md)
("A number another dive there has", "What a Push run gains"). The findings and the cases:
[research note](../research/2026-10-12-freeing-dive-numbers.md).

## Context
- A "Set number" onto a number another dive at the Provider holds is refused (`provider_number_taken`), and a Push run
  leaves out dives that only swap among themselves and skips what a dive only at the Provider holds, found item by item.
  The User gets a name and nothing to do about it.
- SSI itself takes a number twice (owner's checks, 2026-10-10). The barrier is Dive Hub's rule from ADR 0048.

## Decision

### The rule, kept and loosened in one place (owner)
- **A duplicate is never where a run, or any action, ends.** Dive Hub still never gives a dive a number another dive
  at the Provider has, on a create, an update or a lone "Set number".
- **The one exception: a swap or a cycle inside a run.** One dive of the cycle is given the number its neighbour still
  holds, for the length of that save, and the neighbour moves on with the next item. At most one pair shares a number at
  any moment and the end state has none. There is **no scratch number**: nothing is parked at a number nobody chose.
- A run stopped between the two saves leaves that one pair sharing a number at the Provider until the run goes on or
  the next run is made. The plan is computed from the numbers on the Pushes, so nothing else is stored: the shared
  dive shows "number differs" like any change.

### The plan is shown (owner)
The preview of a run lists every number it will set, in sending order: the Dive, its number at the Provider, the
number it gets, and the dive it shares it with for a step. A run never sets numbers the User wasn't shown.

### A Dive's page can ask for the chain (owner)
Next to a taken number, "Set the number with the dives in its way" opens the same preview for exactly the dives
that are in its way (every Dive here whose number at the Provider is wanted by one of the set, repeatedly), and the
User starts it as a run. "Set number" stays one save and still refuses a taken number.

### A holder that is only at the Provider (owner: import lead only)
- The preview of a run with `numbers` reads the Provider's logbook once and names such holders (their number and
  time), so they are known before the run starts, not item by item. The dives that want their numbers are left out
  (`numberHeldAtProvider`).
- The answer to "taken" with such a holder is a lead to the import (ADR 0030), saying what it does: the dive becomes
  a Dive here and the numbers after it move by one. **Dive Hub does not renumber a dive it doesn't know, and no
  "keep SSI's number" setting is made.**

### Verified dives (owner: ask once per run)
Number changes that may remove a verification need one confirmation of the run, shown with the numbers in the
dialog, in place of a tick shared with updates: the new choice `numbersRemovingVerification` (false until confirmed).
`updatesRemovingVerification` keeps its meaning for updates, including a number that goes with an update.

### The adapter contract (said first in the note)
`setNumber(remoteId, number, sharedWith?)`: with `sharedWith` (a remote ID) the adapter may save the number although
that one dive holds it, and refuses (`taken`) when any other dive does. The core passes it for the first step of a
cycle only. A new optional `heldNumbers()` returns the logbook's dives as they are at the Provider; a Provider with
`numbers` that can read its logbook offers it.

## Consequences
- Swaps and cycles get through in a run (k saves for k dives), and one dive's chain can be run from its page.
- A stopped run can leave one shared number at SSI until continued. Said in the run's report and the dive's page.
- A run with `numbers` makes one logbook read at the preview and one at the start.
- Remote-only holders stay: the User imports them or leaves the dive's number differing.

## As built (2026-10-12)
- As decided, with these points:
  - **Plan:** `orderItems` (`push-run-plan.ts`) takes the numbers held only at the Provider (`fixed`) and returns
    `shares` (the dive whose number the first member of a ring takes), `numberTaken` (waits for a dive the run doesn't move)
    and `numberHeld` (a dive only at the Provider has the number). The member of a ring that goes first is the one that
    wants the highest number; the rest follow by the free-number rule.
  - **Adapter:** `setNumber(remoteId, number, sharedWith?)` and optional `heldNumbers()` on `DiveExportAction`; SSI and
    the test ledger implement both. SSI's `heldNumbers` is the logbook read the next save would use (kept for a minute).
  - **Stored:** `push_run_item.shares_with_dive_id` and `push_run.numbers_removing_verification` (migration 0038); the
    run's `leftOut` has `numberHeldAtProvider`, filled in for older runs by the migration.
  - **A read failure** (signed out, Provider down) leaves the preview as before: holders are found when the item is sent,
    as in ADR 0048.
  - **`withHolders`** follows only numbers Dive Hub knows (the numbers on the Pushes); a holder only at the Provider is
    found by the read and named, not followed.
  - **Web:** `NumberChain.tsx` (the plan list, the held-at-Provider note, the Dive page's dialog); the run dialog asks
    for the confirmation with a `ConfirmButton` when `counts.numberRemovingVerification` is above 0 and numbers are
    chosen; the run's strip says how many numbers were set while another dive still had them.
- **Not done:** a browser test for the chain dialog (the e2e server's fake SSI has no swapped numbers to start from; the
  server tests cover the plan, the run and the preview), `heldNumbers` is not yet part of the provider contract test.
