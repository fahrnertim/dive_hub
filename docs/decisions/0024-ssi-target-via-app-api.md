---
title: "ADR 0024: SSI as the first Target, through its private app API"
summary: Dives go to SSI through the MySSI app's private API (create with profile, update in place, delete), our own code; the User chooses at connect between keeping an encrypted password and a token that may expire; honest User-Agent; Divers get External IDs, Connections map Divers to SSI buddies, Pushes keep SSI's number, our reference and the read-back; admins can import SSI's site list like OSM, at the operator's risk (no licence); API slice first, QR later as fallback.
status: accepted
date: 2026-10-04
---

# ADR 0024: SSI as the first Target, through its private app API

## Status
Accepted – 2026-10-04. SSI site import built and amended by [ADR 0025](0025-ssi-site-import-and-site-water-type.md)
(2026-10-05): no alias names, private sites left out, "only fill" runs; sending uses the Dive site's water type.

## Context
The [spec](../spec/README.md) planned the SSI QR payload as the first Target mode, because it needs no stored credentials.
The [SSI API research](../research/2026-10-04-ssi-api.md) found community projects that use the MySSI app's private
JSON API. They report the following:
- Sign-in exchanges e-mail and password for a token of unknown lifetime. There's no OAuth, refresh token, 2FA or app secret.
- One call creates or updates a dive with its full profile and returns the SSI dive ID. Deleting is an update.
- Dives sent this way stay "unconfirmed" in the app, like QR dives.
- SSI's whole site list (24,304 sites) is an unauthenticated download, but it has no licence, and the EU database
  right protects it.
- SSI publishes no terms of use, rate limits or partner programme. The API can change or close without notice.
- It still worked on 2026-10-01, after SSI's app relaunch (5.0).

The project owner decided the points below on 2026-10-04.

## Decision

### Target mode
- **SSI gets Push mode `API`**, using the private app API. QR payload comes later, as the fallback for Users without a
  Connection or when the API fails. Browser automation of the web logbook stays a documented last resort.
- **Our own implementation.** The research note's reference projects are knowledge only. We copy no code, fixtures,
  bundled condition lists or extracted app data. SSI's lists (conditions, wildlife) are fetched at runtime.
- **No partner request to SSI for now.**

### Connection and credentials
- Connecting asks for the SSI e-mail and password, signs in once and shows the SSI account it reached (name, SSI
  account ID). The User then chooses:
  - **"Keep me signed in"**: the password is stored, **encrypted** (AES-256-GCM) with a key the operator sets in
    `DIVEHUB_ENCRYPTION_KEY`. The key is never stored in the database. Pushes keep working, and expired tokens are
    renewed silently.
  - **"Don't store my password"**: only the token is stored (encrypted when the key is set). The screen says up front
    that SSI's token can expire at any time. When it has, the Connection shows **"Sign in to SSI again"**, and Pushes
    wait for it.
  - Without `DIVEHUB_ENCRYPTION_KEY` only the second choice is offered.
- The password and token are never returned by our API, never logged, and never part of an error message. The SSI
  client never logs URLs, because SSI takes both in the query string.
- **Disconnect** deletes the stored password and token. Pushes stay in the history.
- The spec's "no stored credentials" becomes **"passwords only when the User chooses, always encrypted"**.

### Talking to SSI
- **User-Agent:** `DiveHub (+<project URL>)`, plus `DIVEHUB_CONTACT` when set (as in ADR 0021). It's sent with the
  parameters SSI's app sends, and we accept that SSI could block it.
- **Requests go one at a time, with a pause between Pushes.** The logbook (`get_divelog`) is read once per
  sending session, not once per Dive.
- Our interface wraps SSI (`SsiClient`), and tests replay **recorded responses**, never the live service (as in
  ADR 0021). Recordings made with the owner's account are scrubbed of personal data before they're committed.

### Pushes
- **Create:** the Dive's summary plus the Primary recording's samples, resampled to 5 s. Start + offset is sent as
  local time. The Dive site's SSI ID is required; without one, the User picks or types it first.
- **Before creating,** the SSI logbook is checked for a dive within ±2 min (or with our reference). If one exists, the
  User links the Push to it instead of creating a duplicate.
- **After creating,** the Push stores SSI's dive ID and dive number, reads the dive back, and records the fields SSI
  stored differently (read-back result).
- **`outdated` → update in place:** a new Push with the same remote ID re-sends SSI's current record with our
  changes on top, so fields edited in the app survive. The earlier Push stays in the history.
- **Deleting a Dive** offers to delete it in SSI too (soft delete there). If the User declines, the reminder stays.
- A Push in mode `API` that got an ID back is `confirmed`. That means delivered. It is not SSI's dive-centre
  confirmation, which Dive Hub can't set; the client explains that the dive shows as unconfirmed in the app.

### Data model
- **Diver External IDs** `(Diver, Source, external id)`. They're unique per Source among Divers that aren't merged, and
  a Diver has at most one per Source. They record a person's account at a service (SSI account ID, a PADI account).
  - Setting one that another Diver already has proposes linking the two Divers, as in the claim case.
  - Certification numbers stay on Certification (SSI card ID, PADI diver number).
  - Professional numbers stay on Membership (SSI and PADI pro numbers).
- **Connection Diver mappings** `(Connection, Diver, remote id)`: links a Diver to a per-account record at the Target,
  such as an entry in the User's SSI buddy list. They're set by the User, or matched through the Diver's SSI External ID.
- **Push** gains **remote number** (SSI's own dive number), **remote reference** (a stable value we send, for finding
  the dive again when an answer is lost) and **read-back result**.
- Scenario 4 changes accordingly (update in place, deletion offered).

### SSI site import
- Admins can import Dive sites from SSI's site list, **the same way as OSM** (ADR 0021). It's a Site import with
  Source `ssi`, run as a worker job, for a country, a box or everywhere, using the same matching, 3-way re-import and
  history.
  - An imported SSI ID **provides data**. A typed SSI ID stays a reference.
  - Needs no Connection: the file is downloaded without signing in.
- **The admin confirms an explanation first**, and the Site import records who confirmed and when. The explanation says:
  - **SSI gives no licence for this list.** Unlike OpenStreetMap, there are no conditions to accept that would make
    copying it allowed.
  - In the EU the list is protected as a database, so copying large parts of it can infringe SSI's rights.
  - Importing is the operator's decision and risk.
- **Never stored:** SSI's moderation comments (they contain submitters' IP addresses) and its sighting and current
  statistics. Taken: name, alias names, position, country, body of water (salt/fresh) and the SSI ID.
- Sites show "From SSI" without a link (SSI has no public page per site). The operator docs explain the risk.

### Order
1. **API slice:**
   - connect (with the credentials choice);
   - send one Dive with its profile;
   - check for duplicates;
   - store the ID;
   - read it back;
   - update when outdated;
   - offer deletion.

   Buddies, gear, photos, the SSI site import and QR are not part of it.
2. Later, in an order still to be decided: SSI site import, buddies (Connection Diver mappings), QR payload, import
   from SSI as a Source.

The owner runs the account checks from the research note before the API slice is merged: terms, a test dive in the
5.x app, update and delete, the ID in the answer, token lifetime and side effects.

## Considered options
- **QR payload first:** no credentials and can't be blocked. But it has no profile, no updates and no ID back, and
  needs a phone step per dive. It stays as the fallback.
- **Token only, for everyone** (no stored passwords): simplest. Rejected as the only choice, because tokens may expire
  within hours and break unattended Pushes. It stays as the User's choice.
- **Always storing the password:** unattended, but forces the most sensitive choice on every User.
- **Reusing divesend's MIT payload code:** saves work. Rejected: we write our own from the reference, so the mapping
  follows our model and the project carries no unreviewed copied code.
- **SSI sites:**
  - Matching IDs only, or per-Dive lookup only, would carry less risk. The owner chose the full import, accepting the
    risk for operators who opt in.
  - Bundling SSI's list in the image: rejected, as for OSM. It would also make the project the distributor.
- **Asking SSI for partner access first:** may come later. Not now.

## Consequences
- Dive Hub stores secrets for an outside service for the first time. Backups of the database hold encrypted passwords;
  the operator keeps `DIVEHUB_ENCRYPTION_KEY` apart from them. Losing the key means every User signs in to SSI again.
- The API can break without notice. Pushes then fail with a reason, and SSI dives already sent are unaffected.
- The client contract ([clients.md](../spec/clients.md)) gains duties when the slice is built:
  - show what is stored, and offer disconnect;
  - say that a token may expire;
  - explain "unconfirmed";
  - ask before deleting in SSI.
- The glossary's External ID, Connection and Push change. "Confirmed" gets a note.
- An SSI site import makes the operator responsible for using a database without a licence. The explanation and
  the operator docs say so plainly.
