---
title: "ADR 0050: Certifications — kept per Diver, entered by hand or imported from SSI"
summary: A Diver's cards are stored per managed Diver, seen and edited only by the Users who manage it (external Divers have none); agency and level are free text, an SSI import reads `get_ccards` into cards marked verified with agency (read-only, deduplicated by SSI's card ID, deleted ones stay deleted), the card picture (a PNG SSI serves by card ID without sign-in) is fetched by a worker job into the blob store and served only to the Diver's managers; no MCP tool, no push. Accepted by the owner on 2026-10-11.
status: accepted
date: 2026-10-11
---

# ADR 0050: Certifications — kept per Diver, entered by hand or imported from SSI

## Status
Accepted – 2026-10-11 (slice 24, owner). Evidence and costs: [research note](../research/2026-10-11-certifications.md).

**Owner's answers, 2026-10-11:** 1 both, Diver page only; 2 free text with suggestions; 3 **store the PNG** (the
recommendation was a link); 4 and 6 as recommended. 5 and 8 yes as recommended; 7 "fine for now" (no MCP tool).

## Context
The [data model](../spec/data-model.md) names Certification (gap B3) but nothing is built. SSI's app answers
`get_ccards` with a Diver's cards ([SSI reference](../references/ssi-app-api.md)); the other certification-looking calls
(`get_available_courses`, `GetUserProgress`) are e-learning. [ADR 0028](0028-shared-divers-and-participants.md) keeps
a Diver's personal data, certifications included, away from other Users; [ADR 0024](0024-ssi-target-via-app-api.md) and
[ADR 0030](0030-importing-dives-from-providers.md) set how a Provider is read.

## Decision (recommended)

1. **Scope:** manual entry and import from SSI. Shown in a Certifications section of the Diver page. No strip in the
   logbook or on the account page now.
2. **Agency and level:** free text. The form suggests agencies already used by the Diver's cards. No `agency` table
   yet. An imported card sets agency `SSI`, level = SSI's course name, and keeps SSI's course ID and category code.
3. **Card image (owner: store it):** the PNG at `https://my.divessi.com/cert/<card ID>` is stored in the blob store
   (`putOriginal`, by content hash) and served through the API to the Diver's managers only. No Media entity: the card
   holds the blob key, its SHA-256, size and a state (`none`, `pending`, `stored`, `failed`). The fetch is a worker job
   per card (task `certification_image`), queued by the import, so no request waits on SSI's image host. Rules:
   `image/png` by header and magic bytes, at most 1 MB, three attempts, then `failed` with a "Fetch again" action; it
   uses the SSI client's User-Agent like every call to SSI (ADR 0049). A deleted card drops its image (blob removed when
   no other card refers to its key). The image is never embedded from SSI and never copied elsewhere; it comes back
   with the next import.
4. **Verification:** `self-declared` (manual), `card seen` (set or cleared by a managing User, a statement without a
   check), `verified with agency` (only an import sets it). The fields an import wrote are read-only here; only notes
   can be changed on an imported card.
5. **Who:** only the Users who manage the Diver, as for body weights (ADR 0031). An external Diver has no Certifications.
   Other Users never see a Diver's cards, in lists or pickers.
6. **Import:** `POST /api/connections/{id}/certifications/import` reads `get_ccards` live for the Connection's Diver, with
   no preview. Key `(Diver, source, card ID)`. New → created, same card → updated from SSI's data (or `unchanged`), a card
   the User deleted stays deleted (`deleted_earlier`), a card SSI no longer lists stays (`not_at_provider`). Cards are
   soft-deleted.
7. **MCP and links:** no read tool (revisit with the first feature that needs a level, under a new ADR). A Dive's
   Participant doesn't link to a Certification.
8. **Instructor and centre:** text on the card (name and number; centre name, number, city, country), not links.

## Data

Table `certification`: `id`, `diver_id`, `agency`, `level`, `number` (null), `issued_on` (null), `expires_on` (null),
`dives_at_issue` (null), `instructor_name`, `instructor_number`, `centre_name`, `centre_number`, `centre_city`,
`centre_country` (all null), `verification` (enum), `notes`, `source` (null for manual, `ssi`), `external_id` (the card ID),
`remote_course_id`, `category`, `image_key`, `image_sha256`, `image_bytes`, `image_state`, `imported_at`, `version`, `created_at`, `updated_at`, `deleted_at`. Unique
`(diver_id, source, external_id)` where `external_id` is not null. Revisions on `entity_type = 'diver'` as for body
weights' neighbours: create, edit, delete, import (no instructor names in a Revision's values).

Routes: `GET/POST /api/divers/{id}/certifications`, `PUT/DELETE /api/divers/{id}/certifications/{certId}` (`version`
checked, 409 `certification_changed`), `GET …/{certId}/image` (`image/png`, `Cache-Control: private`),
`POST …/{certId}/image` (fetch again), and the import above. Adapter: `buddies`-like optional
`certifications.find(context)`, declared in `data.certifications.import`.

## Considered options
- **Agency table now:** needs ranking and equivalence nothing uses; a wrong seed is worse than free text.
- **A link to SSI only (the recommendation, not chosen):** no copy, no worker job; the owner prefers to have the card
  independent of SSI.
- **A Media entity for card images:** the blob store already holds content-addressed files; a Media table (kinds,
  attachments to Dives) is wider than this slice needs and comes with its own.
- **Embed SSI's image:** every page load reaches SSI with the viewer's address, and it needs a CSP change.
- **Verified by hand:** a claim nobody checked would carry the agency's name.
- **Certifications of external Divers, seen by everyone:** rejected by ADR 0028.
- **Training progress and the course list as part of Certifications:** not certifications; the cards already say what
  was passed.
- **Re-import restores a deleted card:** undoes a deliberate delete.

## Consequences
- The data model moves Certification from planned to built, minus the catalog (still planned); card images use the blob
  store, not the planned Media entity.
- Dive Hub keeps a copy of an identity-like image of a person (name, number; maybe more): only managers see it, it goes
  with the card, and the privacy text says so. About 200 KB per card.
- The client contract gains the Certification routes and duties ([clients.md](../spec/clients.md)).
- (Corrected at build: Dive Hub has no account export; the Provider export import is not about cards. Nothing carries cards
  between instances.)

## As built (2026-10-11)
- Schema, routes and service as decided; `certifications/` in the server, migration 0035, worker task `certification_image` (3 attempts,
  the last failure sets `failed`; "Fetch again" queues a new job). SSI: `get_ccards` and the public picture at
  `my.divessi.com/cert/<ccard_uid>` (PNG, at most 1,000,000 bytes, magic checked; the card ID must match `[A-Za-z0-9._-]{4,64}`).
- An update of an imported card compares only the fields the client sent, so a notes-only edit works.
- Import report: `created`, `updated`, `unchanged` and the items `deleted_earlier` / `not_at_provider`, which the web names.
- Web: a dialog from the Diver's row (like body weight), agency suggestions as buttons under the field, pictures refetched every 3 s
  while one is pending. Capability `certifications` is null at a Provider that has none.
- Not built: Agency catalog, expiry reminders, MCP tool, visibility to guides.
- A guide can't see a buddy's level in Dive Hub (ADR 0028); that needs a Visibility decision later.
