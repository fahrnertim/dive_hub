---
title: Certifications — what SSI's app gives, and what the slice must decide
summary: SSI's `get_ccards` is the Diver's certifications (one entry per card, with a stable card ID, course, issue date, instructor and centre numbers, image links); `get_available_courses` and `GetUserProgress` are e-learning, not certifications, and stay out. Card images are public by card ID (no sign-in) and Dive Hub has no Media store yet. The note lists the seven decisions with a recommendation and its cost each; ADR 0050 holds them for the owner.
status: open
date: 2026-10-11
---

# Certifications — what SSI's app gives, and what the slice must decide

Slice 24 (slice 23, equipment, is planned and not built; 24 is free). The data model already names the entity
([Certification](../spec/data-model.md), gap B3 in the
[UDDF gap analysis](2026-10-02-uddf-gap-analysis.md)); nothing is built. Sources: the capture of 2026-10-10
(`samples/private/`, never committed; its token and the owner's real values are not repeated here), the
[SSI app API](../references/ssi-app-api.md), [ADR 0028](../decisions/0028-shared-divers-and-participants.md),
[ADR 0030](../decisions/0030-importing-dives-from-providers.md) and the code in `apps/server/src/providers/`.
Nothing was sent to SSI for this note. Markers as in the SSI reference: [R] read from a capture.

## What the capture holds [R]

| Call | What it is | Certification? |
|---|---|---|
| `a21.php?what=get_ccards` (8 KB, 10 cards for the owner) | `{ ccard_amount, ccard_list[], cat_array[] }`, one entry per card | **Yes: this is the list.** |
| `a21.php?what=get_available_courses` (170 KB, 21 entries) | the courses the account can open in the app: `uid`, `title`, `cat`, `status` (`unlocked`), `role` (`student`), e-learning progress cache, and for 7 of 21 `ems_course_brevet_uid` + `ems_course_brevet_issue_date` | **No.** It is the course catalogue with progress. The 7 with a brevet repeat a card: `ems_course_brevet_uid` equals that card's `ccard_uid` and the issue date matches. Nothing here that the card list lacks. |
| `training.divessi.com/?method=GetUserProgress&courseId=…` (one per course, 350 B to 2 KB) | pages visited, quizzes and final exam attempts per e-learning course | **No.** Training progress. Out unless the owner asks. |
| `my.divessi.com/cert/<ccard_uid>?t=<ts>` | the card as a PNG (197 to 233 KB in this capture) | The card's picture. |

**Card fields** (`ccard_list[]`; types from the capture, values invented below):

| Field | Type | Meaning, example |
|---|---|---|
| `ccard_uid` | string | the card ID, `<centre number><letter><13 digits>-<country>` (also printed on the card, and the key of the PNG URL); unique per card; `123456N1234567890123-DE` |
| `ccard_course_name` / `ccard_course_short` | string | `Open Water Diver` / `OWD`; `Wreck Diving` / `SC-WR` |
| `ccard_cat` / `ccard_cat_title` | string | `scubadiving`; a translation key `course_cat_scubadiving` (not text) |
| `ccard_course_id` | number | SSI's course ID (225 = OWD, 271 = Deep, 289 = Advanced Open Water Diver, 1802 = Advanced Specialty Diver). **A different ID space** from `get_available_courses.uid` (4279 for OWD): joinable only through the card ID. |
| `ccard_dives` | number | the Diver's dive count at issue (not the course's dives) |
| `ccard_issue_date` | `YYYY-MM-DD` | the issue date |
| `ccard_expire_date` | null | null for all 10 cards (SSI's cards don't expire in the capture) |
| `ccard_instructor_number` / `ccard_instructor_name` | number / string | the instructor's SSI number and name |
| `ccard_divecenter_number` / `_name` / `_city` / `_country` | number / string ×3 | the issuing centre (the number is the first part of the card ID) |
| `ccard_image_front` / `_back` / `_front_thumb` | URL | JPEG on SSI's CDN (1000 px and 200 px), per course (the picture of the card template, e.g. `…/cards/1000/OWD.jpg`), not per Diver |

`cat_array` is SSI's 21 category codes (`scubadiving`, `extendedrange`, `ccr`, `freediving`, `mermaid`, `snorkeling`,
…, and a `…pro` twin of each, `other`). All 10 of the owner's cards are `scubadiving`.

**Facts that shape the design**

- The card's own picture is `my.divessi.com/cert/<ccard_uid>`: the request in the capture carries **no cookie and no
  token**. Whoever has the card ID can fetch it. So the URL can be derived from the card ID and needs no sign-in; it
  also means a card ID is as good as a link to the card, and a card ID is shown to every viewer of the image.
- The `ccard_image_*` CDN images are the course's template picture, not the Diver's card.
- Dive Hub has **no Media or blob store yet** (the data model names Media; no table or route exists). Storing the PNG is
  therefore a slice of its own, not a column.
- The Diver's card list is read live like the buddy list ([ADR 0029](../decisions/0029-push-requirements-and-buddies.md),
  `adapter.buddies.find`): one call, no paging, 8 KB. A fake SSI answer is easy to build from the shape above.
- No call to save or change a card is known; none is wanted (cards are issued by the agency).
- Card numbers stay on Certification and aren't External IDs ([ADR 0024](../decisions/0024-ssi-target-via-app-api.md),
  [SSI research](2026-10-04-ssi-api.md)); that stands. The card ID is the *import key* (below), stored on the
  Certification with its Source.

## Decisions, with a recommendation and its cost

ADR [0050](../decisions/0050-certifications.md) holds them, proposed, for the owner to answer.

1. **Scope.** *Recommend both*: manual entry (other agencies exist; a card from before SSI) and import from SSI; shown
   on the Diver page only. Cost: the form and its rules are about half the slice. *Cheaper:* import only, read-only
   list (no PADI, no CMAS card ever). *Later:* a strip in the logbook or on the account page; nothing in the product
   needs a card there yet.
2. **Agency and level.** *Recommend free text for both*, the Diver page suggesting the agencies already used (no table),
   and the imported card keeping SSI's `course_id` and category as provider data. A catalog table needs ranking and
   equivalence (OWD = Open Water Diver) that nothing uses yet. Cost of a table now: a curated seed, an admin screen or a
   migration for every new agency, and a mapping that is wrong for half the courses. Cost of free text: the same agency
   spelled three ways; fixable by hand and by the suggestion list.
3. **Card images.** *Recommended a link; the owner chose to store the PNG (2026-10-11).* Found after the choice: the
   blob store (`apps/server/src/storage/blob-store.ts`, content-addressed `putOriginal`) already exists, so no Media
   entity is needed, only a key on the card; the Media table the data model names stays planned. The fetch is a worker
   job per card after the import (200 KB each, no request waits). Costs that remain: a lasting copy of an
   identity-like document (only managers see it; it goes with the card; the export leaves images out); shared
   content hashes mean a blob is deleted only when no card refers to it; which User-Agent `my.divessi.com` accepts
   isn't known (the capture's request had one; it is the SSI client's, ADR 0049, until a check says otherwise). For a
   manual card: no image (a "card seen" records that the User looked). *Alternative not chosen:* a link to the
   derived URL (no copy, no job).
4. **Verification states.** *Recommend:* a manual card is `self-declared`; its manager may tick "I've seen the card"
   (`card seen`: a statement of that User, no check); an **imported card is `verified with agency`** — it is the
   agency's own record, read with the signed-in account that belongs to this Diver (the Connection's External ID), with
   SSI's ID, instructor and centre numbers. No manual way to `verified with agency`. The imported fields are read-only
   here (editing them would break the state); only notes change. Cost: one more rule on updates. *Not recommended:* a
   manual "verified" (a claim nobody checked).
5. **Who may edit.** *Recommend:* the Users who manage the Diver, as for body weights ([ADR 0031](../decisions/0031-lead-suit-cylinders-and-lead-estimate.md)).
   **External Divers have no Certifications**: nobody manages them, and ADR 0028 rejected "Divers shared with all
   their data, certifications included". Not shown to other Users, not in pickers. *Cost:* a buddy's level can't be
   looked up by the guide; accepted by ADR 0028.
6. **Import behaviour.** *Recommend:* `POST /api/connections/{id}/certifications/import` (the Connection's Diver), read
   live, no preview (a few cards; nothing is created that a delete doesn't undo): new cards are created, cards already
   there (same Source and card ID) are updated from SSI's data, the result lists `created`, `updated`, `unchanged`,
   `skipped`. A card the User deleted is **kept deleted** (soft delete, as dives, ADR 0026) and reported
   `deleted_earlier`; a card SSI no longer lists stays here and is reported `not_at_provider` (the person held it).
   Cost: a `deleted_at` column and one report line each; the alternative (re-import restores) undoes a deliberate delete.
7. **MCP and the logbook.** *Recommend no tool and no link yet.* A certification list is personal data and the planning
   and assessment tools use no level today; add a read tool with the first feature that needs it (a Deep card for a
   depth check), under a new ADR for what it exposes. A Dive's buddy or guide role doesn't link to a Certification.
8. **Instructor and centre** (not in the brief's list). *Recommend text snapshots* (instructor name and number, centre
   name, number, city and country) on the card, not links to Divers or Dive centres: linking would create external
   Divers for instructors, whose names every User then sees (ADR 0028). The centre number could link to a Dive centre
   later (ADR 0043 holds the SSI centre ID).

## Tests to write first (recommended design)

Server (`apps/server/test/diver-certifications.test.ts`, `ssi-certifications-import.test.ts`):

1. Create, list, update (with `version`, 409 `certification_changed` on a stale one) and delete a manual card; the list
   is newest first; a field outside its limits is `invalid_input`.
2. A User who doesn't manage the Diver gets `diver_not_found` on every route (scoping), including an external Diver's.
3. An external Diver can't have a card (`diver_not_found` or `certification_unavailable`: one name, fixed at build).
4. A manual card can't be set to `verified with agency`; `card seen` can be set and cleared.
5. Import against the fake SSI: 3 invented cards → 3 created, each `verified with agency`, with course, date, numbers,
   centre, card ID; run it again → 3 unchanged; change one card in the fixture → 1 updated; delete one here → run again
   → reported `deleted_earlier`, still deleted; remove one at SSI → `not_at_provider`, still there.
6. An imported card's agency fields can't be edited (409/422 `certification_read_only`); its notes can.
7. A card of another Diver with the same card ID is a separate row (unique per Diver and Source).
8. Revisions: create, edit, delete and import write Revisions on the Diver, never with the instructor's name.
9. Deleting a Diver removes its cards with it; the account export/import carries them (a case in
   `account-export-import.test.ts`).

10. Image: after an import the worker job stores the fake SSI's PNG (state `pending` → `stored`, the route returns the
    bytes with `image/png`); a non-PNG answer, a body over 1 MB and a 404 end `failed`; "Fetch again" recovers; a
    manager of another Diver gets `diver_not_found` on the route; deleting the card removes the blob unless another
    card refers to it.

Browser (area tag `divers`): add a manual card; "Import from SSI" shows the result and then the card image; an imported
card shows "Verified with agency" and no edit of its fields; delete with a confirmation. `ui-quality.spec.ts`: the empty state and the
list at phone width.

## Client duties (for clients.md, if accepted)

- Show a card's verification state in words (never colour alone) and say that an imported card comes from the agency.
- Don't offer to edit the fields of an imported card; send `version` on edits and handle `certification_changed`.
- Show the card image only when `image_state` is `stored` (through the API route, which needs the session); show
  `pending` as such and `failed` with "Fetch again".
- An external Diver has no Certifications section.
- After an import, show the report (created, updated, unchanged, skipped with reasons) and name the cards skipped.

## Open points

- Whether `ccard_expire_date` ever carries a value is unknown (null in all 10 cards); it is stored as `expires_on`
  and shown when set.
- Other categories (`freediving`, `ccr`, `…pro`) are untested in a capture; the import stores the category code and
  shows the course name, so a new category needs no change.
- Whether the card PNG stays public, or SSI later asks for a sign-in, is SSI's choice; a link that stops working shows
  the page SSI shows, nothing breaks here.
