---
title: "ADR 0060: A paged list is an object with total, every other list a bare array"
summary: Lists that page with limit and offset answer { <resource>: [...], total }; all other lists, capped ones too, answer a bare array. Seven routes that wrapped an unpaged list in an object without total now answer the array.
status: accepted
date: 2026-10-30
---

# ADR 0060: A paged list is an object with total, every other list a bare array

## Status
Accepted – 2026-10-30 (owner's decision during the desloppify cleanup: "the cleaner one")

## Context
List routes had three shapes. The paged ones ([ADR 0017](0017-logbook-list-paging.md),
[ADR 0022](0022-merging-sites-and-site-list-paging.md); also `/api/dive-centres`, `/api/external-divers`,
`/api/me/ai-access-log`) answered `{ <resource>: [...], total }`. About twenty unpaged ones answered a bare array. Seven
unpaged ones wrapped the array in an object with nothing else in it: `GET /api/divers/search`, `GET /api/dives/deleted`,
`GET /api/connections/{id}/buddies`, `GET /api/provider-conflicts`, `GET` and `PUT /api/admin/provider-site-data` and
`GET /api/admin/site-imports`. A client could not tell from the route which shape to expect.

Alternatives: wrapping every list (`{ <resource>: [...] }`, plus `total` when paged) lets a list gain fields later
without a breaking change, but changes about twenty routes for envelopes that carry nothing today; documenting the mix
leaves no rule.

## Decision
- A list that pages (`limit` and `offset`) answers an object: the page under the resource's name, `total` beside it,
  and other fields about the whole list where it has them (the logbook's `totals`).
- Every other list answers a bare array, also one capped by a `limit` alone (`/api/divers/search`) or by the server
  (`/api/dives/deleted`, at most 100).
- The seven wrapped unpaged routes above answer the bare array now. A list that later needs fields about itself
  becomes an object then, with a new ADR.

## Consequences
- The shape says whether a list pages; clients read `Ok<…>[number]` for a bare list and `Ok<…>['<resource>']` for a page.
- The seven routes changed without a transition: the web client is the only HTTP client, and the MCP tools call the
  services directly. The rule is in [docs/spec/clients.md](../spec/clients.md).
- Giving an unpaged list a field later is a breaking change for its clients.
