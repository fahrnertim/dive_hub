---
title: "ADR 0048: Dive numbers are computed, and a Provider's numbers can follow them"
summary: A Dive's number is its place by start time among its Diver's Dives plus "dives before this logbook" - computed by the server, never typed; apnea sessions count unless the Diver's setting says no. A Connection can be set to number dives at its Provider as Dive Hub does (off by default) - new dives carry the number, a dive whose number differs there offers "Set number", and Dive Hub never gives a dive a number another dive there has.
status: accepted
date: 2026-10-09
---

# ADR 0048: Dive numbers are computed, and a Provider's numbers can follow them

## Status
Accepted – 2026-10-09; built in slice 22b the same day ("As built" at the end). The owner answered the open questions the same day (marked "owner" below). Changes
[ADR 0015](0015-overrides-vocabulary-and-browser-tests.md) in one point (the number is no longer a value of the Primary recording
that can be overridden), settles what [ADR 0040](0040-logbook-rows-and-filters.md) left open ("numbers are to be
calculated"), extends [ADR 0027](0027-providers-as-adapters.md) (a Provider declares whether a client sets its dive
numbers) and amends [ADR 0047](0047-push-runs.md) (what a Push run gains). To be built as slice 22b, before Push runs
(22c) ([plan](../research/2026-10-09-dive-numbers.md)).

## Context
- **A Dive's number today is whatever came in.** `dive.number` is one of the overridable values: a Garmin file fills
  it with the dive computer's own counter, Suunto files and a Provider's logbook entries leave it empty, and the edit
  form lets a User type it. So a logbook has gaps, doubles and Dives without a number, and "Dive 57" means the
  computer's fifty-seventh dive, not the Diver's.
- **A Provider numbers on its own.** SSI's dive number is the client's choice. Dive Hub sends "highest in SSI's
  logbook plus one" on a create and leaves the number alone on an update, so an old Dive sent late gets a high number
  there. SSI's number of each dive sent or linked is on its Pushes.
- The owner's idea (2026-10-09): a number Dive Hub computes, and a Provider's numbers optionally following it.
- **One old Dive added later moves every number after it.** If the number counted as "changed since sent", hundreds
  of Dives would show as outdated. Decided before this ADR: the number is no part of that, and setting it at a
  Provider is the User's choice, off by default.
- **Three things about SSI are not checked yet**: whether an update with another number changes it, whether SSI
  refuses a number twice, and whether a changed number removes a dive centre's verification. The owner runs them as
  the first step of the build (owner); the design below holds for either result and says what each one switches.

## Decision

### Words
- **Dive number**: the Dive's place in its Diver's logbook. Computed by Dive Hub, never typed.
- **Number on the computer**: the counter a dive computer wrote into its file. It stays on the Recording and is shown
  there; it is not the Dive's number.

### What the number is (owner: position plus a start value)
- A Dive's number is **"dives before this logbook" plus its place by start time** among the Dives of its Diver that
  count. Two Dives at the same instant are ordered by their ids.
- **"Dives before this logbook"** is a setting of the Diver (0 to 100 000, 0 until set): the dives a person made
  before the first one that is here.
- **Which Dives count** (owner): every Dive that isn't deleted, also one waiting in a Logbook check. **Apnea sessions
  count unless the Diver's setting "Count apnea sessions" is off** (on until changed, owner). A Dive is an apnea
  session when its Primary recording says so (dive mode `apnea`); a Dive without a Recording counts as a dive.
- A Dive that doesn't count **has no number**: a Deleted dive, and an apnea session of a Diver who doesn't count them.
  It is named by its date and time, as a Dive without a number is today.
- **Nothing is typed.** The number leaves the edit form, the overridable fields and `PATCH /api/dives/{id}` (`set`
  and `reset` refuse it like any unknown field). What a User typed before stays in the Dive's Revisions; the
  computer's counter stays in the Recording's summary (`diveNumber`).
- **Both settings belong to the Diver** and are changed by a User who manages it (`PATCH /api/divers/{id}`:
  `divesBefore`, `apneaCounts`; both in the Diver's view).

### How it is kept
- The number stays **a stored column** (`dive.number`), so the list's search (`q`), its sort and every view that
  names a Dive read it as before. The server keeps it right: one module renumbers a Diver's Dives in one statement
  whenever something changes their order or what counts (a Dive created, deleted, restored, merged, moved to another
  Diver; its start time or Primary recording changed; one of the Diver's two settings changed).
- **Renumbering is not a change of the Dive**: no new `version`, no Revision, no new `updatedAt`. An edit a User has
  open is not refused because another Dive was added.
- Two renumberings of one Diver wait for each other (a lock on the Diver's row), and the one that comes second sees
  what the first wrote.
- Sorted by number, Dives without one come last.

### What a Provider declares (ADR 0027)
`data.dives.export.numbers`, absent when the Provider numbers by itself and a client can't choose:
- `set`: the operations on which the client sets the dive's number: `create`, `update`, or both.
- `changeRemovesVerification`: whether changing the number of a dive already there can remove a verification it has
  (ADR 0043).

**SSI** declares `set: ['create']` and `changeRemovesVerification: true` until the owner's checks say more (they did on 2026-10-10: "As built"):
`update` joins when an update with another number is shown to change it, and `changeRemovesVerification` becomes
false when a verified dive is shown to keep its verification. Each is one line in the adapter and one in the
[SSI reference](../references/ssi-app-api.md).

### The choice (owner: a setting on the Connection, off)
- A Connection has **"Number dives at SSI as in Dive Hub"** (`diveNumbers.follow`, false until the User turns it on;
  refused with `provider_unsupported` at a Provider that declares no `numbers`). There is no tick per send.
- Turning it on **sends nothing**. From then on:
  - a dive Dive Hub **creates** there carries the Dive's number;
  - an **update** of a changed Dive carries it too, where the Provider sets numbers on an update;
  - a dive already there whose number differs shows that, and offers **"Set number"** (below).
- While it is off, everything is as today: "highest plus one" on a create, the number left alone on an update,
  nothing shown about numbers.
- A Dive without a number (an apnea session that doesn't count) is sent the Provider's own way.

### A number another dive there has (owner: never make a duplicate)
Dive Hub **never gives a dive a number another dive at the Provider has**, wherever the adapter can tell (SSI: it
reads the logbook before every save anyway). This doesn't depend on whether SSI itself would refuse.
- **On a create:** the dive is still sent, numbered the Provider's own way ("highest plus one"), and then shows
  "number differs".
- **On an update:** the values go, the number there stays, and it shows "number differs".
- **On "Set number":** refused (`provider_number_taken`), naming the dive that holds the number (its number and start
  there, and the Dive here if Dive Hub knows it). Nothing is saved there. The User sets that one first; a Push run
  does many in the right order (ADR 0047, amended below).
- **Dives that are only at the Provider keep their numbers.** Nothing renumbers what Dive Hub doesn't know. Where the
  setting is turned on, the client says so and points to the import (ADR 0030), which makes them Dives here.

### "Number differs" and "Set number"
- **Its own state, not "changed since sent".** A Dive's status at a Provider (`GET /api/dives/{id}/providers`) gains
  `current.number`: `null` when the Connection doesn't follow, the Provider declares no `numbers` or the Dive has no
  number; else `{ wanted, differs, canSet, removesVerification }`. `wanted` is the Dive's number, `differs` whether
  the Provider's (`remoteNumber`) is another, `canSet` whether the Provider sets numbers on an update,
  `removesVerification` what it declares. `upToDate` doesn't look at numbers.
- `updateRemovesVerification` is also true when an update would change the number at a Provider that declares
  `changeRemovesVerification`.
- **`POST /api/dives/{id}/providers/{provider}/number`** sets the remote dive's number to the Dive's. It changes
  **only the number**: the adapter sends the Provider's current record back with the number changed, so a Dive that
  was "changed since sent" still is, and nothing of Dive Hub's newer values goes along unasked. At SSI it costs what
  an update costs (a logbook read, a save, a read-back). It runs under the Dive's lease and the Connection's pacing
  like any action.
- **It makes a Push** with the new action `number`: the Provider's new number, and the fingerprint and payload of the
  Push before it, so the Dive's state stays what it was. A refusal is a failed Push like any other.
- Problem codes: `provider_number_taken` (409, with the dive that holds it), `provider_numbers_off` (409, the
  Connection doesn't follow), `provider_number_nothing_to_set` (409, the Dive has no number or the Provider has it
  already), and the ones a send has (`provider_not_sent`, `provider_dive_gone`, `provider_unsupported`,
  `provider_busy`, the sign-in ones). Asking twice is safe: the second answers `provider_number_nothing_to_set`.

### What an import and a merge do
- An import (ADR 0030) still doesn't take a Provider's number. The Dives it makes are numbered like any other, and
  the links it makes carry the Provider's number, so "number differs" is known for them without asking again.
- A merge (ADR 0038) deletes one Dive, so the numbers after it move down by one. At a Provider that follows, those
  Dives then show "number differs"; nothing is sent by itself.

### Clients
The duties go into the [client contract](../spec/clients.md) with the code
([list](../research/2026-10-09-dive-numbers.md#client-duties-for-clientsmd)). In short: never ask for a Dive's
number; show the computer's counter as the Recording's; offer the Diver's two settings; offer the Connection's
setting only where the Provider declares `numbers`, off, saying what it does and what it doesn't; show "number
differs" with both numbers and offer "Set number" only when `canSet`; warn before it when `removesVerification`;
show who holds a taken number and lead there.

### What a Push run gains (amends ADR 0047)
- Dives a run **creates** carry the number when the Connection follows; that needs no choice in the run.
- A third choice, **`numbers`** (false until ticked, offered only when the Connection follows and the Provider sets
  numbers on an update): also set the number of dives already there whose number differs. Where the Provider
  declares `changeRemovesVerification`, these also need `updatesRemovingVerification`.
- A Dive that is updated in the run gets its number with that update (one save). A Dive that is up to date, or whose
  update isn't chosen, gets an item of its own with the action `number`.
- **Order:** the number changes first, each when its number is free, then creates and updates oldest first as before.
  The order is worked out when the run is planned, from the numbers on the Pushes: an item goes when no other dive of
  the Connection that Dive Hub knows holds its number (so numbers moving up go from the highest down, numbers moving
  down from the lowest up). Dives that only swap numbers among themselves can't be ordered: they are left out and
  reported (`number_taken`), and go one by one from their pages, through a free number. A number held by a dive only
  at the Provider is found when the item is sent: skipped with `number_taken`.
- The ceiling counts every item, so a logbook that moved by one after an old Dive was added takes several runs; a
  create waits behind the changes that free its number.
- The details (the plan's function, the preview's counts, the run's columns, the tests) are in ADR 0047 and its
  [plan](../research/2026-10-09-push-runs.md#implementation-plan).

## Considered options
- **A typed number holds on its Dive, and later Dives count on from it** (owner: no). Matches a paper logbook dive by
  dive, but allows gaps and doubles, and nobody can say in one sentence what a Dive's number will be.
- **The computed number beside the stored one** (owner: no). Two numbers on every Dive, and which one a Provider
  should follow has to be explained each time.
- **Computing the number in every query instead of storing it.** Nothing to keep in step, but every query that names
  a Dive (the list, its search and sort, the checks, merges, imports, MCP) needs a window over the Diver's whole
  logbook. Rejected for a stored column kept by one module, with a test for every path that changes the order.
- **A database trigger that renumbers.** Can't be forgotten, but hides a write to hundreds of rows behind a single
  insert, away from the code that reads like the rest.
- **Apnea sessions never count, or a "doesn't count" tick per Dive** (owner: a setting per Diver, counting by
  default). The setting needs no new value on a Dive: the Primary recording already says what it is.
- **A tick on every send** (owner: no). A logbook whose numbers follow on some sends and not on others is worse than
  either; the Connection decides once.
- **Setting a taken number anyway, or refusing the send too** (owner: never a duplicate, but the send goes). The
  first leaves doubles at the Provider, the second holds a dive back for a reason that isn't about the dive.
- **Recording a number change on the Push that is there** instead of a new one. No new action, but a Push would stop
  being what was sent then.
- **Sending the number with Dive Hub's values in a normal update only.** No new call, but "Set number" would then
  send every other change too, unasked, and could remove a verification for a start time the User didn't mean to send.
- **Taking the Provider's numbers into Dive Hub.** They are another count (SSI's "highest plus one" in the order of
  sending); ADR 0030 already left them out.

## Consequences
- Every Dive has a number that says what it is, and a logbook has no gaps or doubles. The owner's Dives are
  renumbered by the migration: from 1 until "dives before this logbook" is set.
- A number is no longer something a User can fix on one Dive. What they can change is the start value, whether
  apnea counts, and the Dives themselves.
- Adding, deleting, merging or re-timing one Dive rewrites the numbers after it (one statement, a few hundred rows
  at logbook scale). A link or a note that says "Dive 57" can mean another Dive later; links use ids.
- Each path that changes a Diver's Dives must call the renumbering; a forgotten one leaves stale numbers until the
  next change. The plan lists the paths and a test for each.
- `PATCH /api/dives/{id}` refuses `number`: a breaking change for a client that sent it (the web client is the only
  one; MCP is read-only).
- A Push can now be a number change (`number`); views of a Dive's Pushes need a word for it.
- At SSI, numbers follow only for dives sent after the setting was turned on, until the User sets the others or a
  Push run does (22c). Until the checks were run (2026-10-10), SSI's adapter set numbers on a create only.
- A number change at SSI is a full save of SSI's record. Renumbering a long logbook is as slow as sending it.
- Not designed: a logbook filter "number differs" (the run's preview counts them), renumbering dives that are only
  at the Provider, more than one logbook per Diver, a number per kind (a separate apnea count).

## As built (slice 22b, 2026-10-09)
- As decided, with these points:
  - `set.number` and `reset: ['number']` on `PATCH /api/dives/{id}` answer 400 because they are named in the schema as
    `Type.Never`: Fastify's validator strips unknown properties instead of refusing them, so "400 as for any unknown field"
    did not hold.
  - The detail response has `values.number` (read only); `fromRecording` has none.
  - `PATCH /api/divers/{id}` takes `name`, `divesBefore` and `apneaCounts` (at least one); `PATCH /api/connections/{id}` takes
    `diveImport` and/or `diveNumbers`.
  - `renumber` takes a row lock on the Diver rows (ordered by id), so two changes at once give the same numbers as one after the
    other.
  - Dive Hub's e2e server gives its two seeded Divers `divesBefore` 41 and 500, so the fixtures stay Dive 42 and 501 to 504.
- **What SSI declares, since the owner's checks of 2026-10-10:** `numbers: { set: ['create', 'update'], changeRemovesVerification: true }`.
  The checks ([results](../references/ssi-app-api.md#owners-checks-pending)): an update with another number changes it; SSI
  takes a number twice, by an update and by a create, without refusing; the other dives keep their numbers after a delete. So
  SSI's adapter sets the number on a create, on an update and alone ("Set number": SSI's own record back with only the number
  changed), each time only when no other dive in the logbook it just read has it, and "Set number" answers `taken` with that
  dive. A "Set number" whose dive doesn't have the number in the read right after is `provider_not_stored` (ADR 0049).
  Not checked: a verified dive, so `changeRemovesVerification` stays true and the client warns; it becomes false when a
  verified dive is shown to keep its verification (`round-trip.ts number --dive … --to …`).
  Between 2026-10-09 and these checks SSI declared `set: ['create']`.
- **The checks ran from a temporary panel** on the Connections page, with the Connection's own sign-in (a separate sign-in
  with Dive Hub's User-Agent of then was answered `signed_out`, ADR 0049). The panel and its route are deleted; the checks
  themselves stay as `test/fixtures/ssi/number-checks.ts` for `round-trip.ts number`.
