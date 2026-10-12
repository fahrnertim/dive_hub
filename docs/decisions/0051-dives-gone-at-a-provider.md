---
title: "ADR 0051: Dives gone at a Provider"
summary: A Dive whose remote dive is no longer in the Provider's logbook is found by comparing against a complete, fresh read (the import preview, or a check of its own), kept as a finding, shown under "Needs your decision", and confirmed by a second read before the link is forgotten; the User then keeps the Dive or deletes it here; nothing is deleted or sent unasked.
status: accepted
date: 2026-10-12
---

# ADR 0051: Dives gone at a Provider

## Status
Accepted – 2026-10-12 (owner).

## Context
Deleting goes one way: from Dive Hub to the Provider ([ADR 0026](0026-deleting-dives.md),
[ADR 0027](0027-providers-as-adapters.md)). A dive deleted in SSI's app is noticed only when Dive Hub next writes to it:
the update or number Push fails with `provider_dive_gone` and records `remoteGone`, and the Dive has no remote dive there
from then on. Until then the Dive's panel says it is in SSI, and nothing offers to delete it here too.

What is there already (checked in the code, 2026-10-12):

- **The whole logbook in one answer.** `get_divelog` is not paged
  ([research](../research/2026-10-04-ssi-api.md), "no paging"); the SSI client refuses an answer that isn't 2xx, isn't
  JSON, says `authenticated: false` or has no `logbook_details` array, and leaves out records marked
  `odin_user_log_deleted`. An answer cut off on the way isn't JSON and is refused.
- **A complete listing with every remote ID.** `dives.list(context)` ([ADR 0030](0030-importing-dives-from-providers.md))
  gives each record with its `remoteId`, also the ones Dive Hub can't parse. The import preview reads it afresh; it is
  refused while the Connection's import is off.
- **"Found gone" is a fact a Push records** (`push.remote_gone`); `currentRemote` then says the Dive has no remote dive.
  ADR 0027: "a copy found gone counts as deleted (a confirmed delete Push with `remoteGone`)".
- **A Connection keeps its account.** Signing in again with another account is refused (`provider_other_account`). A
  Connection removed and made anew can be another account; its old Pushes then have no `connection_id`.

The danger is the reverse of the feature: a logbook that came back empty or short looks like "everything deleted".
What a wrong finding can cost: a Dive deleted here (restorable, ADR 0026), or a link forgotten (sending again finds the
dive by Dive Hub's reference and links it again). Nothing is lost for good either way, but nothing may happen unasked.

## Decision

### The finding
- **A Dive is gone at a Provider** when it is live, its current remote dive there (`currentRemote`) was made through
  this Connection (`push.connection_id`), and that remote ID is not among the records of a complete read. Compared by
  remote ID over the raw records, never over the parsed ones, and never by time or number.
- **Only a fresh read counts**, not the adapter's two-minute snapshot.
- **An empty logbook is never a finding.** The check answers that the Provider's logbook came back empty and nothing was
  compared.
- **Findings are stored** (`provider_gone_dive`: Dive, Provider, Connection, remote ID and number, when found; one per
  Dive and Provider). Whether one still waits is worked out on reading: its remote ID is still the Dive's current
  remote dive and the Dive is live. A later complete read that lists the dive again removes the finding.

### Where the comparison happens
- **In the import preview**, which reads the logbook afresh anyway: no further call to the Provider.
- **And as its own request** (`POST /api/connections/{id}/gone-dives/check`, one paced action), for a Connection whose
  import is off and for a User who only wants to know. Offered on the Connection ("Check for dives deleted in SSI").
- **Not on every logbook read a Push makes,** and not on a schedule: Dive Hub reads a Provider when the User asks
  (ADR 0049 says how it presents itself there). Manual for now (owner); jobs that sync with a Provider may come later
  and would be their own decision. The comparison is written so that such a job could call it.

### Confirming, then the User's choice
- **Nothing changes when a Dive is found gone.** The Dive, its link and its panel stay as they were; the finding waits
  under "Needs your decision" (the Review page), and the logbook's strip counts it ("2 dives no longer in SSI").
- **Two choices per Dive:** "Delete here too" and "Keep here". Neither is a default, there is no "all", and a Dive is
  never deleted in a batch.
- **Both first confirm with a second read** (`POST /api/connections/{id}/gone-dives/confirm` with the Dive IDs; one
  fresh read for all of them, under each Dive's lease):
  - still gone: a confirmed delete Push with `remoteGone` is recorded, as ADR 0027 does for a copy found gone. The Dive
    has no remote dive there any more; its history says it was found deleted in SSI.
  - there after all: nothing is recorded, the finding is removed, and the User is told.
- **"Keep here"** ends there. The Dive is "not at SSI" like one never sent; sending it again creates it there anew.
- **"Delete here too"** then goes through the Dive's own delete flow (ADR 0026): one Dive, its dialog, restorable. It
  asks about copies at other Providers as always. Nothing is written to the Provider it is gone from: the confirmation
  already took it out of the Dive's Providers, so the delete can't remove a dive that turned out to be there.
- **More than half of the compared Dives gone** (and at least five): the findings are shown with a warning to look at
  the Provider's app first. No other difference.

### Several Providers, several Divers
- A finding is per Dive and Provider; the Dive's copies elsewhere are untouched until the User deletes the Dive.
- Only the Connection's owner can check and confirm, and only Dives of the Connection's Diver are compared. Another
  User who manages the same Diver through a Connection of their own has their own Pushes and findings.
- A Dive linked through a Connection that no longer exists isn't compared: Dive Hub can't know it was the same account.
- **Deleted Dives are not compared.** Their "Still in SSI" reminder (ADR 0026) already records `remoteGone` when its
  "Delete in SSI" finds the dive gone.

### Adapter
Nothing new: `dives.list(context)` without `recent`. A Provider without `list` has no check.

## Considered options
- **Recording `remoteGone` as soon as a read doesn't list the dive:** simplest, and the same fact a failed update
  records today. But the Dive then counts as "not at SSI", and a Push run over that filter would create it at SSI
  again: the User's deletion there undone by one short read or one click on "Send". The fact is recorded only after
  the User looked at it and a second read agreed.
- **Deleting here automatically, or by default:** never; a Dive is the User's record, the Provider's copy is a copy.
- **Requiring two reads some time apart before showing anything:** the confirmation read at the moment of the choice
  does this without making the User wait.
- **Asking the Provider per Dive (`exists`) when confirming:** one whole-logbook read per Dive; the batch reads once.
- **"Delete here too" as the delete dialog with SSI ticked:** if the dive is there after all, that deletes it at SSI.
- **A new Push action `check`:** more exact in the history than a delete Push, but an enum migration and a new case in
  everything that reads Pushes, for the wording of one line. The delete Push with `remoteGone` is fine (owner).
- **Not storing findings,** showing them only in the check's answer: no notice on the logbook then. Stored (owner).

## Consequences
- A second kind of thing under "Needs your decision"; the Review counts and the strip gain a number.
- One table and two requests; API clients get a duty (show the findings, confirm before either choice, never bulk
  delete), so the [client contract](../spec/clients.md) changes with it.
- A Dive kept after its remote dive is gone shows under "not at SSI", and a Push run over that filter sends it again.
  There is no "keep here, never send to SSI"; left out for now (owner).
- A Dive deleted in SSI is found only when the User previews an import or runs the check. Nothing notices by itself.
- The plausibility rule (empty, more than half) is a guess; SSI's failure modes for `get_divelog` beyond the ones the
  client refuses aren't known.
