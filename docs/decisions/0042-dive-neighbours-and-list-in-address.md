---
title: "ADR 0042: Previous and next dive follow the list the User came from"
summary: A Dive's address carries the logbook's settings (`?list=`); GET /api/dives/:id/neighbours returns the Dives before and after it in that list's order; "Logbook" goes back to the list on the page the Dive is on.
status: accepted
date: 2026-10-07
---

# ADR 0042: Previous and next dive follow the list the User came from

## Status
Accepted – 2026-10-07

## Context
UI redesign 2.4 and 2.5 ([research note](../research/2026-10-07-ui-redesign-proposal.md)): reading a dive day or a trip
should not need a trip back to the list, and "Logbook" on a dive should return to the list as it was (filter, sort, page),
which [ADR 0017](0017-logbook-list-paging.md) keeps in the address and `#/` dropped. A client has to know the list, and
the server has to order the neighbours the way the list is ordered, across page boundaries.

## Decision
- **The list rides in the Dive's address**, not in session state: `#/dives/<id>?list=<the logbook's query, encoded>`
  (e.g. `list=sort%3Dduration%26only%3Dno-site`). Reload, a copied link and a new tab keep it; a Dive opened without
  a list follows the whole logbook, newest first.
- **`GET /api/dives/:id/neighbours`** takes the list's own settings (`diverId`, `siteId`, `q`, `only`, `sort`, `order`;
  not `limit` or `offset`) and returns `previous` and `next` (`{ id }` or `null`), `position` (from 1) and `total`. The
  list and this route share one filter and ordering ([ADR 0040](0040-logbook-rows-and-filters.md)), so they cannot
  disagree. A Dive of someone the User doesn't manage is 404. A Dive the list does not show gets `position: null` and
  no neighbours.
- **"Previous" is the row above in that list**, "next" the row below. With the newest first, "previous" is the newer dive.
- **"Logbook" returns to the list with its page recomputed** from `position` (page size 25), so it is right after
  stepping across a page boundary.

## Consequences
- Each dive page asks one more query (a window function over the filtered list; cheap at logbook scale).
- Links from other places (Review, Sites) carry no list and follow the whole logbook.
- A client without addresses keeps the list in its own navigation state and sends it to the route.
