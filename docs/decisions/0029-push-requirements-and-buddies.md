---
title: "ADR 0029: Push requirements, and buddies sent to SSI"
summary: A Provider declares what an export needs (a Dive site's External ID, a way to tell who a Participant is), blocking or advisory; the generic layer checks it against Dive Hub's own data, shows what is unmet and refuses only blocking ones. Fixed through Dive Hub's records - a site's External ID by its own route (the site API loses ssiSiteId), a Diver's account by the Diver. SSI sends Participants as buddies by translating the Diver's SSI account to the entry in the User's SSI buddy list at send time; the buddy list can be imported. Connection Diver mappings wait until a buddy entry without an SSI account is seen. Amends 0027, 0024, 0021.
status: accepted
date: 2026-10-05
---

# ADR 0029: Push requirements, and buddies sent to SSI

## Status
Accepted – 2026-10-05. Amends [ADR 0027](0027-providers-as-adapters.md) ("what an export needs" becomes Push
requirements; `provider_site_id_missing` goes), [ADR 0024](0024-ssi-target-via-app-api.md) (Connection Diver mappings
wait; buddies are sent) and [ADR 0021](0021-site-external-ids-and-import.md) (a typed SSI site ID has its own route).
Agreed in the [provider layer follow-ups](../research/2026-10-05-provider-layer-follow-ups.md).

## Context
ADR 0027 let SSI declare one need, the Dive site's SSI ID (`needsSiteIdFrom`), and the web client mapped it to the
site field `ssiSiteId` and to SSI's QR format. Buddies bring a second need of another shape (per Participant, and not
always fatal), so the vocabulary is designed from two real cases.

What we know of SSI's buddies, checked with the owner's account on 2026-10-05 ([SSI reference](../references/ssi-app-api.md#buddies-checked-2026-10-05)):
a dive lists **entry IDs from the account's own buddy list** (numbers), not SSI accounts; each entry carries the buddy's
SSI account (`buddy_master_id`); every entry seen had one. No call to add an entry is known; in SSI's app a buddy is
added by scanning their QR code, without notifying them.

The project owner decided on 2026-10-05: one route per thing to fix, no second way; all three roles go to SSI as
buddies; build without Connection Diver mappings and add them only if an entry without an SSI account turns up; no
compatibility with Pushes sent before (no Users yet).

## Decision

### Push requirements
- An adapter declares them on its dive export (`dives.export.requirements`), replacing `needsSiteIdFrom`. Each has a
  **type**, a **severity** and an English **description** (shown only by a client that doesn't know the type, with
  "can't be fixed here").
  - **`blocking`:** sending refuses with `provider_requirements_unmet` and the list (`unmet`).
  - **`advisory`:** sent without it, and the Push records what was left out (`leftOut`), which clients show.
- **Two types**, no catch-all; new ones come with a real Provider:
  - **`site_external_id`** (`source`): the Dive's site has an External ID at this site Source. The capabilities add
    whether Users may type one (`typed`), its `pattern` and the `prefixes` accepted before it (SSI's QR says
    `site:3314`). A Dive without a site is its first step (`siteId: null` in the unmet item).
  - **`diver_mapping`** (`source`, `roles`): the Provider can tell who each Participant in these roles is. Today one way
    satisfies it: the Diver has an External ID at `source` (`fixes: ['diver_external_id']`). Connection Diver mappings,
    if they come, add `'connection_mapping'` to `fixes`; clients that don't know it still offer the first.
- **Checked against Dive Hub's own data only**, by the generic layer (`providers/requirements.ts`). The status
  (`GET /api/dives/{id}/providers/{provider}`) lists `unmet` and never calls the Provider. Whether the Provider still
  has what we point at is the adapter's check at send time.
- **SSI declares** `site_external_id` (`ssi`, blocking) and `diver_mapping` (`ssi`, roles buddy, guide, instructor,
  advisory). The test-only ledger adapter declares the opposite severities (`wikidata` advisory, `padi` blocking), so
  each type is proven at both.

### Fixed through Dive Hub's records, one route each
- **A Dive site's External ID:** `PUT /api/dive-sites/{id}/external-ids/{source}` with `{ externalId }` (null clears),
  only for Sources Users may type (SSI today, else `site_source_not_typed`). It takes the prefixed form and stores the
  bare ID, refuses one another site has (`external_id_taken`), writes a Revision under the same key as before
  (`ssiSiteId`) and doesn't change the site's version, so it never conflicts with an edit of the site's other fields.
  **The site API loses `ssiSiteId`** (create, edit and view); `externalIds` carries it. The site form and the dive
  page's "choose the site at SSI" both call this route.
- **A Diver's account at a service:** `PUT /api/divers/{id}/external-ids/{source}` ([ADR 0028](0028-shared-divers-and-participants.md)).
  The dive page's fix picks the person from the User's SSI buddy list, which sets the account of that entry.

### What an adapter gets and gives
- `OutgoingDive.participants`: each Participant's `diverId`, `name`, `role` and `ids`, the Diver's External IDs by
  Source. The adapter takes what it needs (`ids[accountSource]` for SSI) and never sees anything else of the Diver.
- `update(remoteId, dive, previous)`: `previous` is the payload the current Push recorded, so the adapter can tell
  what it set before from what the User set in the Provider's own app.
- `Delivered.leftOut`: Participants it couldn't put on the remote dive (`not_at_provider`). The generic layer adds the
  advisory ones nobody could send (`no_reference`).
- **The buddies kind:** `data.buddies.import` with `find` (the account's buddy list, through a Connection), and
  `buddies.find(context)` returning `{ remoteId, name, account }`. No `buddies.export`: SSI can't create entries.

### SSI
- **Every Participant goes as a buddy** (SSI has no other place for a guide or an instructor; its leader number stays
  empty).
- **Translation at send time:** the logbook read the action already makes carries the buddy list; a Participant whose
  SSI account matches an entry's `buddy_master_id` goes as that entry's `id` (a number). One without an entry is left
  out (`not_at_provider`; the client tells the User to add them in SSI's app, by their QR code, and update the dive).
- **On update** SSI's current buddy IDs minus those Dive Hub sent before, plus those it sends now: buddies added in
  SSI's app stay; one removed in Dive Hub goes.
- **Fingerprint:** our SSI fields plus the Participants' SSI accounts, sorted. Pushes sent before this change show as
  changed once.
- **Read-back** compares the buddy IDs (`buddies`).

### Importing the SSI buddy list
- `GET /api/connections/{id}/buddies`: the account's list, read live: each entry's `name`, `account` (null without
  one) and the Diver who has that account here, if any.
- `POST /api/connections/{id}/buddies/import` with `{ accounts }`: creates an external Diver for each listed entry
  whose account no Diver has, with the entry's name and the account as its SSI External ID. Entries already known are
  skipped; an entry is linked to an existing Diver by setting that Diver's account (route above).
- **Stored:** the name and the SSI account. A name SSI has all in lower case or all in capitals gets a capital at the
  start of each part ("samuel dreier" → "Samuel Dreier"); mixed case stays as typed (owner, 2026-10-05). **Never stored nor passed on:** birth date, e-mail, phone, address, city,
  country, picture, pro number, comments.

### Later
- **Connection Diver mappings** `(Connection, Diver, remote id)` for buddy entries without an SSI account, with
  `PUT /api/connections/{id}/divers/{diverId}`, when such an entry is seen.
- **Adding a buddy to the User's SSI list:** showing the buddy's SSI QR code (format in the SSI reference), or the
  adapter adding the entry once the app's call is known (`buddies` would declare `create`).

## Considered options
- **Keeping `ssiSiteId` beside the route:** two ways to do one thing; a mobile client would keep the old one alive.
- **External IDs in the site's edit body:** one request for the whole form, but a second way next to the route.
- **Mappings now:** a table, a route and a resolver for a case not seen in the owner's data.
- **Sending SSI accounts as buddy IDs:** SSI's app writes entry IDs; the two kinds of number overlap, so a wrong
  reading could put a stranger on a dive.
- **Requirements checked against the Provider:** every dive page would call SSI, and an outage would hide the panel.

## Consequences
- The client contract changes: `needsSiteIdFrom`, `siteExternalId`, `ssiSiteId` and `provider_site_id_missing` go;
  `requirements`, `unmet`, `leftOut`, the two External ID routes and the buddy list routes come, with a duty per
  requirement type and for unknown ones ([clients.md](../spec/clients.md)).
- A buddy not in the User's SSI buddy list reaches SSI only after the User adds them in SSI's app.
- The owner checked on 2026-10-06 that buddies sent from Dive Hub show on the dive in SSI's app.
