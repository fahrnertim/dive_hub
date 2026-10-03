---
title: "ADR 0017: Logbook list with offset paging, column sorting and search"
summary: GET /api/dives returns one page { dives, total } (limit ≤ 200, offset), sorted by date, number, depth or duration, searchable by number and notes; the web client keeps these settings in the address.
status: accepted
date: 2026-10-03
---

# ADR 0017: Logbook list with offset paging, column sorting and search

## Status
Accepted – 2026-10-03

## Context
`GET /api/dives` returned the latest 500 Dives as an array, without saying that more existed.
Real logbooks have hundreds of dives, and a club's shared logbook can have thousands. The
[UI review](../research/2026-10-03-ui-review.md) (finding C1) asked for paging, sorting and search
before real logbooks arrive. The project owner chose on 2026-10-03 to fix all review findings.

## Decision
- **One page per request.** `GET /api/dives` takes `limit` (1–200, default 50) and `offset`
  (default 0) and returns `{ dives, total }`. `total` counts every Dive the query matches, so a
  client can show "51–100 of 312" and its page buttons.
- **Offset paging, not cursor paging.** Sorting by several columns, some of them nullable (dive
  number, max depth), makes keyset cursors complex. A logbook has thousands of rows at most, where
  offset costs nothing worth measuring. Revisit if one User's query reaches tens of thousands of Dives.
- **Sorting** by `sort` = `startsAt` (default), `number`, `maxDepth` or `duration`, and by
  `order` = `desc` (default) or `asc`. Dives without the value come last either way. The start time,
  then the id, breaks ties, so pages are stable.
- **Search** by `q`: a whole number matches the dive number; any text matches the notes,
  case-insensitively. `%` and `_` are plain letters. Dive sites and buddies join the search once
  they exist.
- **Scoping is unchanged**: only Divers the User manages; `diverId` narrows to one of them.
- **The web client keeps the settings in the address** (`#/?diver=…&q=…&sort=…&order=…&page=…`,
  defaults left out), so back, reload and shared links keep them. Typing a search replaces the
  address entry instead of adding history. Column headers are sort buttons with `aria-sort`.

## Consequences
- The response shape changed from an array to `{ dives, total }`. The only client is our web
  client (regenerated API client), so nothing else breaks. Before 1.0 this is acceptable; later
  API changes like this need a new version.
- Each list request runs two queries (page and count). That's cheap at logbook scale, with the
  existing index on `dive.diver_id`.
- Search covers what Dives have today (number, notes). A full-text index can come when sites,
  buddies and other text fields arrive.
