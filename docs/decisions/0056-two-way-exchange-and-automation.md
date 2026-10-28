---
title: "ADR 0056: Two-way exchange and automation for integrations"
summary: For every Provider, the send gets the import's three-way rule (a change made only at the Provider comes back instead of being overwritten; a change on both sides is a clash), unattended clashes wait in "Needs your decision" per Dive and Connection, and a Connection can send on change (one coalesced entry per Dive, sent after 2 quiet minutes, skipped when the fingerprint is unchanged), send new Dives and delete at the Provider by setting (both off by default), and fetch on a schedule no faster than the Provider declares; unattended runs renew a sign-in only with a kept password. Amended 2026-10-24 - a manual send asks a clash on the Dive's page, a Push run leaves it in "Needs your decision"; a removal is a change both ways (tank and lead too, amending 0031 and 0045). Amended 2026-10-27 - the queue is a table of Waiting pushes (30 s quiet period for a send, 5 min for a delete), unattended sends never duplicate or remove a verification, choices in "Needs your decision" queue the Dive, `limits.fetchEveryMinutes`, a fetch on opening. Amends 0026, 0027, 0030, 0031, 0038, 0045, 0047.
status: accepted
date: 2026-10-23
---

# ADR 0056: Two-way exchange and automation for integrations

## Status
Accepted – 2026-10-28 (owner). Proposed 2026-10-23, from the owner's design session of 2026-10-23
([design](../superpowers/specs/2026-10-23-ssi-app-alignment-design.md)). Built: the three-way send (piece 3,
2026-10-24) and automation for every Provider (piece 6, 2026-10-27,
[plan](../superpowers/plans/2026-10-27-provider-automation.md)).

## Context
- The import already compares per field with a base, three-way ([ADR 0030](0030-importing-dives-from-providers.md),
  amended 2026-10-06): a change made only at the Provider comes back, a change on both sides is a conflict in the
  preview. The **send** doesn't: an update puts Dive Hub's non-empty values over the Provider's record, so a field
  changed in the Provider's app since the last exchange is overwritten when Dive Hub sends first.
- Every exchange is started by the User ([ADR 0047](0047-push-runs.md) runs, manual imports). The owner wants exchange
  to also run by itself, for every integration, not only SSI.
- Unattended runs have no preview to put a conflict in, and no User to sign in again.

## Decision

### The send is three-way too
- Before an update the adapter has the Provider's current record (SSI reads it already). Per field, against the base
  ADR 0030 defines (the newer of the last import's Original and the last sent payload):
  - changed only in Dive Hub: sent;
  - changed only at the Provider: not overwritten; the Dive takes the value (Revision cause `update`, "Updated from its
    source"), and the Push records the fingerprint of the merged result so the Dive isn't queued again;
  - changed on both sides, differently: a **clash**.
- Values from a Recording keep ADR 0030's rule: on a Dive with a Recording they are send-only; on a Dive without one
  they come back three-way. Differences a Provider makes itself (rounding, dropped zeros, 0 for nothing) are compared
  away as today.

### Clashes
- In a manual import's preview: as today.
- From an unattended run (send on change, scheduled fetch): one entry per Dive and Connection in **"Needs your
  decision"** ([ADR 0038](0038-logbook-checks-and-merging-dives.md)), listing the clashed fields, each with "keep Dive
  Hub's" or "take <Provider>'s". While it is open, the base stays and the clashed fields are neither sent nor taken back;
  the rest of the Dive is. "Keep" queues a send, "take" writes a Revision; resolving moves the base.

### Running by itself (settings per Connection, all off by default)
- **Send on change:** a change to a Dive linked to the Connection that alters its fingerprint queues it. One waiting
  entry per Dive and Connection; the Dive is read when sent; it waits until it hasn't changed for **2 minutes**; nothing
  is sent when the fingerprint equals the last sent one; a change during a send queues it once more. Sending goes
  through the Provider's pacing ([ADR 0027](0027-providers-as-adapters.md) `limits`).
- **Send new Dives automatically:** a new Dive is queued the same way.
- **Delete at the Provider when deleted here:** the delete waits through the same quiet period; an Undo cancels it.
  The setting tells that restoring later creates the dive again as a new entry and loses a verification it had. Off,
  deleting asks as [ADR 0026](0026-deleting-dives.md) says.
- **Fetch on schedule:** a worker job runs the same Import as a manual one for each Connection that is due. A dive only
  at the Provider becomes a Dive as a manual import makes it. Where a preview would ask (several candidates, a probable
  non-dive) the entry is skipped as `ambiguous`, as today, and the Connection shows how many wait, linking to a manual
  import.
- **How often:** a Provider declares the shortest schedule interval it allows in its capabilities; a Connection can't
  go below it.

### Signing in unattended
- A Connection that keeps the sealed password renews an expired token by itself. One with a token only pauses its
  queue and schedule and shows `provider_sign_in_needed` until the User signs in.

## Amended 2026-10-24 (owner, before piece 3's plan)
From the [design's "Piece 3" section](../superpowers/specs/2026-10-23-ssi-app-alignment-design.md#piece-3-settled-2026-10-24).
- **A manual send from the Dive's page asks a clash there:** nothing is sent; the answer lists the clashed fields with
  both values; the User chooses per field and sends again. "Needs your decision" is for runs: a **Push run**
  ([ADR 0047](0047-push-runs.md)) sends the Dive without the clashed fields and leaves an entry there, as unattended
  runs do.
- **A removal is a change** in both directions, against the base: removed on one side only, it is removed on the other;
  removed on one and changed on the other, a clash. Without a base the Provider's value stays. The site is never
  cleared by the Provider ([ADR 0030](0030-importing-dives-from-providers.md) stays); values from a Recording stay
  send-only.
- **Amends [ADR 0031](0031-lead-suit-cylinders-and-lead-estimate.md) and
  [ADR 0045](0045-tank-pressure-cylinders-and-sac-on-a-dive.md) ("never removes"):** a weight or tank emptied at the
  Provider removes the Dive's one Lead entry or its one Cylinder, unless a Recording brought it.
- **The Provider's `fields`** governs every direction: the send, the import's three-way and its fill.

## Amended 2026-10-27 (owner, before piece 6's plan)
From the [design's "Piece 6" section](../superpowers/specs/2026-10-23-ssi-app-alignment-design.md#piece-6-settled-2026-10-27).
- **The quiet period** is 30 seconds for a send (Dive Hub saves only on Save, so it covers a quick second save) and
  5 minutes for a delete (the time to Undo), not 2 minutes.
- **The queue is a table**: one Waiting push per Dive and Provider, visible on the Dive, in the logbook and on the
  Connection; the worker sends it through the ordinary Push, one Connection at a time. Held while something here must
  change (a requirement, a sign-in, a decision); after a Provider was unreachable, retried for a day and then stopped
  until Retry or the Provider's next successful call; stopped at once after a refusal.
- **Unattended, never a duplicate or a lost verification:** a dive at the same time already at the Provider waits in
  "Needs your decision" (link or create); an update that would remove a verification waits for the User's Send.
- **A resolved Conflict and every choice in "Needs your decision" queue the Dive, due now**, whatever the settings (as
  "keep queues a send" said); nothing in "Needs your decision" sends directly.
- **Send new Dives** skips an Import that creates more than 20 Dives; it offers a Push run instead.
- **With "Delete at the Provider" on, the Dive is deleted here first** and at the Provider after the quiet period
  (amends [ADR 0026](0026-deleting-dives.md)'s order for this setting only); the list of deleted dives shows the waiting
  or stopped delete in the place of 0026's reminder. Off, 0026 stands. A merge of two Dives both at the Provider treats
  the merged-away Dive's copy the same way ([ADR 0038](0038-logbook-checks-and-merging-dives.md)).
- **The Dive's Connection decides** (the one its current Push was made through): its settings apply whoever changed
  the Dive, and a Connection now at another account never sends the Dive by itself.
- **An open Conflict holds its fields in every import too**, so a newer Original doesn't send a clash as a change.
- **The interval**: `limits.fetchEveryMinutes` (null: no scheduled fetch); SSI 60. The User chooses every hour, 6 hours
  or a day; a scheduled fetch also runs when the User opens Dive Hub and the last is more than an hour old. Dives from a
  dive computer with no choice yet are skipped and counted, like `ambiguous` ones; its Conflicts wait in "Needs your
  decision" as a send's do.

## Consequences
- A change made in a Provider's app is no longer lost when Dive Hub sends first.
- New data per Connection: the settings, the waiting entries, the clash entries; a client-contract change
  ([clients.md](../spec/clients.md)) for the settings, the waiting count and the new kind of decision.
- The worker gets a scheduled task and a queue; tests need a clock for the quiet period.
- Generic: a later Provider gets all of it by declaring its interval and fields.
- Harder: what a run did is no longer always something the User started; the Connection has to show it.
