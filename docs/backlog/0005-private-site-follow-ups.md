---
title: Tidy piece 4's private site IDs - the send's site lock and sites SSI marks private in its public list
summary: The send's find-or-make holds a pool connection while it waits for SSI (a row lease instead), and a site SSI lists publicly yet flags private for its owner flips between public and private here; plus the smaller findings parked from piece 4's reviews.
status: draft
risk: medium
date: 2026-10-26
---

# Tidy piece 4's private site IDs

From piece 4's final review (branch `ssi-private-sites`, 2026-10-26; [design](../superpowers/specs/2026-10-23-ssi-app-alignment-design.md),
[architecture](../spec/architecture.md)). Not ready: needs the owner's look first.

## Goal
- **The send's site lock** (`apps/server/src/providers/site-for-send.ts`, `locked`): a PostgreSQL advisory lock holds a
  pool connection (pool max 10) for the whole find-or-make, SSI calls included (60 s timeout each). About ten sends at
  once that each need a site would hold every connection while each needs another for its queries; the pool waits
  forever, so the server stalls. It also goes against `leases.ts`'s rule (nothing holds a connection while it waits) and
  brings `pg` into `providers/`. Replace it with a row lease keyed on (site, account), like `leases.dive`, or a `db/` helper.
- **A site SSI lists publicly but flags private for its owner** (43 such sites in SSI's zip, [SSI app API](../references/ssi-app-api.md)):
  if the owner uses this instance, each read of their logbook (`settleVisibility`) makes the imported public row private
  and each Site import (`publishIds`) makes it public again; while private, other Users' sends at that site find no ID
  and make permanent private sites at SSI. Possible fix: settle leaves rows a Site import delivered (`siteImportId` set).

## Smaller findings parked from piece 4's reviews
- `counts.created` counts a create the site import skips because the ID is held privately (`import-plan.ts`).
- `siteForSend` runs before `updateThere`'s take, so it may make an SSI site for the Dive's old site (narrow).
- A Connection's Diver without an account answers `provider_unsupported`; `provider_not_connected` fits better.
- While SSI is unreachable, a typed private ID held by another account answers `external_id_taken` (shows that it is held here).
- A public pick can't replace the account's own private row on the same site (409 until the next settle).
- Site merge preview compares by Source only: a private ID that moves isn't listed (`SitesPage.tsx`).
- The site form shows the public typed field (old route, stored public without asking SSI) beside the private one.
- Web: cancelling after a refused private ID leaves the site page stale until a refetch; the Diver label reads "()" while Divers load.
- Tests missing: settle's clash skip; an invalid typed pattern; `get` and `find` both unknown; the preview's count for a nameless site.
