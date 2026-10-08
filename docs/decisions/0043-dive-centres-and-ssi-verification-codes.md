---
title: "ADR 0043: Dive centres and SSI verification codes"
summary: A shared Dive centre with an SSI centre number, linked to the Dive sites it is responsible for; its SSI verification code is built from number and name, never stored, and shown on the centre and on every Dive at one of its sites. A scanner reads a code by camera or from an image. A Diver has first name, last name, e-mail and leader number; with the SSI account they make the buddy code and the professional's code, which every User sees, and a scanned code of either kind is taken for a Diver. Amends 0028 and 0029.
status: accepted
date: 2026-10-08
---

# ADR 0043: Dive centres and SSI verification codes

## Status
Accepted – 2026-10-08 (decided with the owner). All three slices are built: the Dive centre
([As built (slice 1)](#as-built-slice-1)), the [scanner](#scanner-slice-2-as-built), and buddy and professional codes
([As built (slice 3)](#as-built-slice-3)). Slice 3 amends [ADR 0028](0028-shared-divers-and-participants.md) and
[ADR 0029](0029-push-requirements-and-buddies.md).

## Context
SSI shows a dive as verified once the diver scans a dive centre's or a professional's QR code on that logbook entry.
Dive Hub can't set this: `odin_user_log_confirmed` / `_verified` are derived by SSI
([SSI reference](../references/ssi-app-api.md)), so every dive Dive Hub sends arrives unverified, and an update that
changes a dive's start time removes a verification that was there ([ADR 0038](0038-logbook-checks-and-merging-dives.md),
whose warning about it is not built). An unverified dive doesn't count towards SSI's recognition levels (German
"Anerkennungsstufen"; SSI's English name is not checked). Nothing else depends on it.

What the owner found on real codes (2026-10-08, formats in the SSI reference):

- A centre's code is plain text: `center;<centre number>;name:<name>`. A professional's code is the buddy code with
  `;leaderNr:<number>` at its end.
- The codes never change, carry no token or signature, and SSI's app reads them by camera or from an image file.

So a code is not a secret and not a proof: anyone who knows a centre's number can write it. The User's wish: reach the
code from the dive, to verify it again at SSI, and to show it to the others who were on the dive.

Dive Hub has no dive centre so far; SSI's dive centre field is sent empty.

## Decision

### Dive centre (slice 1)
- **A new shared thing, the Dive centre**, handled like a [Dive site](../glossary.md): every User sees, creates and
  edits it; its creator or an admin deletes it. It has a name and, optionally, an **SSI centre number**: an External ID
  at the source `ssi`, unique on the instance, as for sites ([ADR 0029](0029-push-requirements-and-buddies.md)).
- **A Dive centre is linked to the Dive sites it is responsible for**, many to many. Any User sets the links, from the
  centre or from the site. Deleting a centre removes its links and nothing else.
- **The code is built, never stored.** From number and name the server writes `center;<number>;name:<name>`. The
  name is kept exactly as SSI spells it, because whether SSI's app checks it is unknown.
- **A Dive has no dive centre of its own.** The centres of a Dive are those of its site.
- **Where the code shows:**
  - on the Dive centre, always (when it has an SSI centre number);
  - on a Dive, when its site has at least one Dive centre with an SSI centre number. With several, each is offered
    by name. No other condition: not a Push at SSI, not the Diver, not who is looking, since the people it is shown
    to may not use Dive Hub at all.
- **Always the User's own act, one Dive at a time.** Dive Hub doesn't verify anything itself, in bulk or in the
  background, and doesn't record that a Dive is verified.
- **Creating a centre from a code's text.** The server reads a pasted code and answers with what it is (a centre, a
  buddy, a professional) and its fields; a text it doesn't know is refused. Typing number and name by hand stays.
- **The "Send update" warning of ADR 0038 gets built with this.** Before an update that changes the start time at
  SSI, the card says that SSI removes the dive centre's verification. Where the Dive's site has a centre with a code,
  the card and the result of the update point to it.
- **Clients** get a duty, written into the [client contract](../spec/clients.md) in the same change: the API gives
  the finished text per centre and the client draws it as a QR code. The format stays on the server.
- **In the repository** the formats stand with placeholders only. A real person's code is never written down.

### As built (slice 1)
Decided with the owner on 2026-10-08 while building:
- **The SSI centre number is digits only** (1 to 10, no leading zero). Where a number is typed, the whole text of a
  centre's code is taken too, and the number read from it.
- **Name and display name.** The centre's name is the whole name as its Source spells it (SSI: "name, town"); it is
  what is stored, edited and written into the code. The API also gives a **display name**, made by the rule of the
  Source the centre has an ID at: for SSI, the name without the town after the last comma
  (`providers/ssi/ssi-centre.ts`); another Source may bring another rule. A centre without such an ID shows its whole
  name. Clients show the display name and offer the whole name for editing.
- **Tables:** `dive_centre` (name, version, creator, soft delete), `dive_centre_external_id` (one per centre and
  source, unique per source on the instance) and `dive_centre_site` (the links). Merging two Dive sites moves the
  links to the kept site; deleting a site or a centre removes its links.
- **Revisions are written, not shown yet**: every change to a centre (name, number, links, deletion) writes a
  Revision of the entity `dive_centre`; no client shows a centre's history.
- **API:** `/api/dive-centres` (list, create, rename with `version`, delete), `PUT …/external-ids/{source}`,
  `PUT`/`DELETE …/sites/{siteId}`, and `POST /api/verification-codes/read` for a pasted text. A Dive carries
  `verificationCodes`. Setting the number and the links leaves the centre's `version` alone, as for sites (ADR 0029).
- **The QR code is drawn by the client** with [`uqr`](https://github.com/unjs/uqr) (MIT, no dependencies), error
  correction M, quiet zone 4, black on white in both colour schemes. The text is encoded as UTF-8 bytes. **Whether
  SSI's app reads a name with an umlaut this way is unknown: no code with one has been seen.** If one fails, look here
  first.
- **The "Send update" warning** comes from the Push status (`current.updateRemovesVerification`): the SSI adapter
  compares the start time (to the minute) it would send with the one in the last Push's stored payload. When that
  payload is unknown (the Dive was linked to an entry that was already at SSI, so nothing was sent), **it warns
  anyway**: a warning too many costs a glance, a missing one costs a verification (confirmed by the owner on
  2026-10-08, after slice 1). The web client also says after the update that the verification is gone, and both
  notices lead to the Dive's code when its site has one.
- **Navigation:** Dive centres are a fourth main entry in the web client.

### Scanner (slice 2, as built)
A client reads a code by camera or from an image file and sends its text to the same route
(`POST /api/verification-codes/read`). Nothing changed on the server. Decided with the owner on 2026-10-08:

- **Where:** on the "new centre" form, next to the pasted text, and where a centre's SSI centre number is set. In
  both, the scanned text goes to the server and only what it answers is taken: name and number, or the number. A
  buddy's or a professional's code is told apart and nothing of it is kept, not in a field either (it holds an
  e-mail).
- **Reading the picture** (`apps/web/src/lib/qr-reader.ts`): the browser's own `BarcodeDetector` where it reads QR
  codes (Chrome on Android and macOS), and the library [`qr`](https://github.com/paulmillr/qr) 0.7.2 (MIT or
  Apache-2.0, no dependencies, pinned exactly) everywhere else and whenever the detector finds nothing. Considered:
  jsQR (unchanged since 2021) and zxing-wasm (the strongest decoder, but about 1 MB of WebAssembly that its default
  loads from a CDN). `qr` is young: its author gives 57.5 % on BoofCV's set of hard photos. Our own drawn codes, also
  with umlauts and at one pixel per module, are read in the tests. **How well it reads a code photographed from
  another phone's screen or a printed sign is not measured**: if scanning disappoints, look here first; zxing-wasm,
  served by ourselves, is the next step. With the decoder, the centres' part of the web client is 59 kB (22 kB
  compressed).
- **The camera** (`apps/web/src/CodeScanner.tsx`, built with the skill `media-capture-device-contracts`): asked for
  only when the User presses "Scan with camera", the back camera preferred, no sound. The scanner stops every track
  when the code is read, when the dialog closes and when the camera ends by itself; a camera that answers after the
  dialog closed is stopped unseen. Each failure has its own sentence: blocked (no script can open the browser's
  question again, so the text names the browser's settings), no camera, camera busy, stopped.
- **Plain HTTP gives no camera.** A browser only offers `navigator.mediaDevices` to a page over HTTPS (or on
  `localhost`), so a Dive Hub opened as `http://nas.local` has none. The scanner says so and points to the image
  file, which on a phone also offers taking a photo.
- **Tested** with a camera drawn on a canvas in the page: the scanner's own steps, not the browser's permission
  question or a real camera. **Not checked on a real phone**; that needs the owner's.

### Buddy and professional codes (slice 3)
Decided by the owner in outline before the slice; what was open then is answered in
[As built (slice 3)](#as-built-slice-3). The slice's change amends ADR 0028 and ADR 0029 where they said otherwise.

- **A Diver gets what a buddy code needs**: the SSI account (there already), the e-mail, and a leader number that
  marks them as a professional. From these Dive Hub builds the buddy code, and the professional's code from the same
  parts plus the leader number. This also gives what ADR 0029 left unbuilt: showing a buddy's code so the User can
  add them to their SSI buddy list.
- **The e-mail is stored and seen by every User**, inside the code. This changes two accepted decisions: ADR 0028
  ("nothing else" than the name is seen, no External ID values, no personal data) and ADR 0029 (e-mail "never stored
  nor passed on"). It is stored whether or not SSI's app turns out to need it (owner, 2026-10-08): the code is then
  always the one SSI itself would show, and nobody has to find out what the app checks.
- **Hiding the e-mail can come later** and is not built now: a Diver's e-mail could be made hideable, and their code
  would then not be shown, unless it has been confirmed by then that SSI's app takes a code without the e-mail.

### As built (slice 3)
Decided with the owner on 2026-10-08 while building:

- **A Diver's details** are four optional fields beside its name: **first name** and **last name** as SSI spells
  them, **e-mail**, and **SSI leader number**. The code needs the name in two parts, and a Diver's name can't be cut
  reliably ("Anna Maria Berg"), so both parts are stored; the Diver's name stays what is shown everywhere else. A part
  is one line without a semicolon, the e-mail and the leader number without a space (checked by the API and by a
  constraint in the database), because a semicolon would break the code.
- **The codes are built, never stored** (`centres/verification-code.ts`, `personCodes`): the **buddy code** when
  the Diver has an SSI account, first name, last name and e-mail; the **professional's code** when it also has a
  leader number. One missing part, no code, and the client says what is missing. Dive Hub doesn't check that a leader
  number is real or active.
- **Every User sees** a Diver's details, its accounts with their IDs, and its codes (`GET /api/divers/{id}/details`).
  **Who changes them** (`PATCH …/details`, only the fields sent): any User for an external Diver, its Users for a
  Diver someone keeps the logbook of, as for a Diver's name and account (ADR 0028). The answer says so (`canEdit`).
- **A scanned or pasted code is taken** (`POST /api/divers/from-code`), found by **the SSI account in it**:
  - the Diver that has the account gets what the code says: first name, last name, e-mail, and the leader number of a
    professional's code. A buddy code leaves a leader number that is there. The Diver's name is not changed. Before
    that, `POST /api/verification-codes/read` answers who it is and what would change (`existing.changes`), so the
    User sees it first; someone who may not change that Diver is told so;
  - when no Diver has the account, the User chooses: one of the Divers of that name that have no SSI account and that
    they may change (`candidates`, at most ten; it then gets the account too), or a new external Diver, named by the
    code's first and last name. Nothing is chosen for them: a namesake is not the same person.
  - Refused: a Diver that has another SSI account (`diver_has_other_account`), an account another Diver has
    (`diver_external_id_taken`), a centre's code (`code_not_a_person`).
- **On a Dive**, the professional's code of **every Participant with one** shows beside the centres' codes, with the
  person's name, whatever their role: a guide, an instructor, or a professional who dived along as a buddy. As for
  centres there is no other condition, and the Dive's own Diver is not a Participant, so their own code doesn't show
  on their own Dive. A Dive's `verificationCodes` entries have a `kind` (`centre` or `professional`), centres
  first.
- **The SSI buddy list brings the details along**: importing an entry stores first name, last name, e-mail and leader
  number with the new Diver, and **fills what a Diver already here lacks**, overwriting nothing (the answer counts
  them, `updated`). The list as it is read still shows only name and account. See the amendment to ADR 0029.
- **What a Revision says:** which details changed; for the e-mail only that it was set or removed, never the address,
  so a removed address is gone from the history too.
- **Forgetting:** deleting an external Diver empties its details. Merging two Divers moves the details to the kept
  Diver where it has none and empties them on the merged one.
- **The scanner** of slice 2 is used as it is (`CodeScanner.tsx`): the web client's "Add from a code" on the divers
  page takes a camera picture, an image file or pasted text. On the centre forms a person's code is still told apart
  and nothing of it kept.
- **In the web client** every Diver row has "Codes": the codes, the details, and their form. The form and the scan
  say, before saving, that everyone on the instance sees the details.
- **Not built:** hiding the e-mail (above); showing who changed a Diver's details (Revisions are written, no client
  shows a Diver's history); a way from "not in your SSI buddy list" on the dive page straight to that buddy's code
  (the code is on the divers page).
- **Not checked:** whether SSI's app takes a buddy code or a professional's code drawn by Dive Hub. The text is the
  same as SSI's own; the drawing is the one used for centres. That needs the owner's phone.

## Considered options
- **The code on the Dive site:** what the first note said. Two centres dive the same reef, and one centre dives twenty
  sites, so the code belongs to the centre.
- **A dive centre field on the Dive, suggested from the site:** truer (a private dive at a centre's house reef would
  show no code) and it matches SSI's own field, but one more thing to fill in on every Dive. Derived first; the field
  can be added later without losing anything.
- **Storing the scanned text:** not needed, the text follows from two fields, and a stored copy could disagree with
  them.
- **Only for Dives sent to SSI:** left out, because the code is also shown to others.
- **Treating the code as a secret** (only the creator sees it): it is public information in another spelling.
- **Sending dives as verified:** not possible as far as anyone has reported. Not looked into further.

## Consequences
- A new term, [Dive centre](../glossary.md), a new table with its links to sites, and a second kind of thing with
  External IDs.
- The code also shows on Dives the centre had no part in. The User decides whether to use it.
- With slice 3, every User of an instance sees the e-mail and SSI account of every Diver that has them. That suits an
  instance of people who dive together; it is the reason the slice amends ADR 0028 in the open.
- A Diver's row holds personal data of people who may never have signed up: their e-mail and leader number. Deleting
  the Diver, or merging it, removes them; nothing else keeps a copy.
- SSI's dive centre field stays empty in a Push.
