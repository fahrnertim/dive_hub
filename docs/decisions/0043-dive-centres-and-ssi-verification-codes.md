---
title: "ADR 0043: Dive centres and SSI verification codes"
summary: A shared Dive centre with an SSI centre number, linked to the Dive sites it is responsible for; its SSI verification code is built from number and name, never stored, and shown on the centre and on every Dive at one of its sites. Planned - a scanner, and buddy and professional codes with the Diver's e-mail shared.
status: accepted
date: 2026-10-08
---

# ADR 0043: Dive centres and SSI verification codes

## Status
Accepted – 2026-10-08 (decided with the owner). Nothing is built yet.

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

### Scanner (slice 2, planned)
A client reads a code by camera or from an image file and sends its text to the same route. New technology for the
project: the slice starts with the search for skills (AGENTS.md).

### Buddy and professional codes (slice 3, planned)
Decided by the owner in outline; the slice's own change amends ADR 0028 and ADR 0029 where they say otherwise.

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
- **Open for that slice:**
  - how a scanned code finds a Diver that is already here, so that it doesn't make a second one;
  - where a professional's code shows on a Dive (a Participant with a leader number is the obvious rule).

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
  instance of people who dive together; it is the reason the slice has to amend ADR 0028 in the open.
- SSI's dive centre field stays empty in a Push.
