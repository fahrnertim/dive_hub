---
title: "ADR 0040: Logbook rows, \"Show only\" filters and their counts"
summary: GET /api/dives pages by 25, takes `only` (no-recording, no-site, with-findings, not-at-provider), and returns per-filter counts, the logbook's totals, month figures and, per Dive, Recordings, gas, surface interval, source and Participants.
status: accepted
date: 2026-10-07
---

# ADR 0040: Logbook rows, "Show only" filters and their counts

## Status
Accepted – 2026-10-07. Amends [ADR 0017](0017-logbook-list-paging.md).

## Context
The [UI redesign](../research/2026-10-07-ui-redesign-proposal.md) (section 3, owner's answers under "Outcome") replaces
the logbook table with rows that say what makes each dive this dive, adds "Show only" chips to find dives that lack
something, and groups rows by month under totals. A row is about twice as tall as a table row, so a page is shorter.
The list's summary had none of this: no buddies, gas, source or Recording count, and no way to ask for "the dives without
a Recording". Counts for the chips and the month figures can't be derived by a client from one page.

## Decision
- **Page size 25** (the default `limit`; the maximum stays 200).
- **`only`**: comma-separated filters, all of which must fit ("and"); an unknown value is a 400.
  - `no-recording`: no Recording that isn't deleted (a logbook entry from a Provider or typed).
  - `no-site`: no Dive site.
  - `with-findings`: the list's mark is set (`findings > 0`, [ADR 0036](0036-dive-assessment.md)).
  - `not-at-provider`: the User has a Connection for the Dive's Diver, and at least one such Provider has no current
    dive for it (the same rule as `currentRemote`: the newest Push that decides is none, a delete or "gone"). Not
    "Not in SSI", because the API has no Provider of its own: the client names the Provider it knows. "No number" is
    not a filter: numbers are to be calculated.
  - `total` and the rows follow the filters.
- **`counts`** (`noRecording`, `noSite`, `withFindings`, `notAtProvider`): how many Dives each filter would show for the
  Diver and the search, **whatever filters are applied**, so a pressed chip keeps its number. The client hides a chip
  whose count is 0 (unless pressed).
- **`totals`** (`dives`, `durationSeconds`, `deepestM`, `lastDiveAt`): the Diver's whole logbook, not narrowed by search,
  site or filters ("four numbers every logbook has").
- **`months`**: only while sorted by date; the local months (`YYYY-MM`) of this page in page order, each with the number
  and time of **all** matching Dives of that month, so a heading on page 2 doesn't count only its share. The local month
  is the start plus the UTC offset (`unknown`: the wall-clock time as stored).
- **New fields on each Dive of the list**:
  - `recordings`: how many Recordings (0: a logbook entry only).
  - `fromProvider`: the Provider whose entry it was made from, while it has no Recording ("from SSI").
  - `gases`: the Primary recording's mixes (`o2`, `he`; the tank data stays on the Dive page).
  - `surfaceIntervalSeconds`: the computer's own value, or null. Not computed across Dives: that is the assessment's.
  - `participants`: `diverId`, `name`, `role`, buddies first, then guides and instructors, each by name. Clients draw
    the avatar circles and the initials from the name; the roles stay as text for screen readers.
- Not in this change: "same time as another dive" (the strip and the Review page own the open checks, [ADR
  0038](0038-logbook-checks-and-merging-dives.md)) and the profile sketch (its own ADR, slice D).

## Consequences
- A list request runs more queries (page, count, counts, totals, and for the page: Recordings, Primary summaries,
  Participants, months), each indexed by Dive or Diver. Fine at logbook scale; revisit with [ADR 0017](0017-logbook-list-paging.md)'s
  threshold (tens of thousands of Dives for one User).
- The response gains fields (`counts`, `totals`, `months`, and per Dive the five above): additive, so existing clients keep working.
  The default page size changes from 50 to 25 for clients that don't send `limit`.
- `not-at-provider` counts every Provider the User connected, including one without a dive export. With SSI the only
  Provider that is the same thing; a second, import-only Provider needs the registry's capabilities here.
- A new duty for clients: [client contract](../spec/clients.md#dives).
