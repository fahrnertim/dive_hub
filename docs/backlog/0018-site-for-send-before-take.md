---
title: Find or make the Dive's SSI site after the update's take, not before
summary: A send finds or makes the Dive's site at SSI (siteForSend) before updateThere's take, so a Dive whose site changed meanwhile may get an SSI site made for its old site. Narrow; fixing it reorders the send.
status: draft
risk: medium
date: 2026-11-03
---

# Find or make the Dive's SSI site after the update's take

Parked from backlog [0005](0005-private-site-follow-ups.md) (piece 4's final review; left out of its
[design](../superpowers/specs/2026-11-03-private-site-follow-ups-design.md#not-in-scope) as narrow). Not ready: needs the
owner's look first.

## Goal
In a send (`apps/server/src/providers/push/push-service.ts`, around the `siteForSend` call and `updateThere`), the site
step reads the Dive's site under the Dive's lease but before `updateThere` takes the record it sends. A change of the
Dive's site between the two can leave an SSI site made (and stored private to the account) for the site the Dive had
before. Done: the site step uses the site of the record that is sent, with a server test that changes the Dive's site
between the two steps and sees no `save_divesite` for the old site.

## Read first
- `apps/server/src/providers/push/push-service.ts` (`send`, `updateThere`)
- `apps/server/src/providers/push/site-for-send.ts`
- [ADR 0056](../decisions/0056-two-way-exchange-and-automation.md) (three-way updates and their take)

## Decided
- Retries and the orphan log of `siteForSend` stay as they are (backlog 0005).

## State
Base `main`. `siteForSend` holds a `provider_lease` per site and account (backlog 0005).

## Open
Where the site step goes in the send's order, and whether the take reads the site once for both.

## Skills to load
`vitest`, `postgres-drizzle`, `karpathy-guidelines`; read each one's override in [skills.md](../skills.md#overrides).

## Don't
Change the lease, the find-or-make rules or the client contract.
