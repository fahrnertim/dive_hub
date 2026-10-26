---
title: Offer to move dives from a private SSI site to its public counterpart
summary: When a site an account holds privately at a Provider gets a public ID, "Needs your decision" offers to move that account's dives to the public site or keep them; the decision changes only Dive Hub's side and the next send of any kind carries it.
status: draft
risk: medium
date: 2026-10-24
---

# Offer to move dives from a private SSI site to its public counterpart

From the owner's piece 4 session ([design](../superpowers/specs/2026-10-23-ssi-app-alignment-design.md), "Piece 4,
settled 2026-10-24"). Not ready: it waits for piece 4 (private site IDs per account) and its checks.

## Goal
- **Detect:** a Dive site has a private ID for an account at a Source (`dive_site_external_id.account_id` set) and gets
  a public one (the Site import, a typed ID, a logbook site read as public).
- **Ask:** one "Needs your decision" entry per site and account: "Move your dives at <site> to SSI's public site" or
  "Keep them on your private site".
- **Move:** only Dive Hub's side changes: the account's Dives at that site use the public ID from then on, so each counts
  as changed since sent and goes out with whatever send comes next (by hand, a Push run, piece 6's automatic send). No
  bulk run inside the decision.
- **Keep:** the entry closes and isn't raised again for that site and account.

## Open
- ~~Whether SSI lets a site be deleted~~: piece 4's first check (2026-10-24) found it can't be deleted with
  `odin_dive_sites_deleted`, and the app has no delete ([research](../research/2026-10-24-ssi-site-checks.md)); "move"
  therefore leaves the private site at SSI.
- The entry is about a site, not a Dive; today's entries are per Dive and Connection (ADR 0056).
