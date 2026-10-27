---
title: "ADR 0057: SSI aligned with its app"
summary: The decompiled SSI app (5.0.43) is the source of truth for the integration, and every claim about SSI carries its source ([R] app code, [T] our test on the owner's account, [S] reported, [?] unknown); Dive Hub sends the app's full record with its types and reads answers by the app's rules; everything both sides hold goes both ways (dive type, tank, lead, surface interval, tank pressure, CNS, heart rate); a missing site is matched or created at SSI as private; Participants are added to the SSI buddy list (name-only only if a check shows SSI keeps it); a save is checked against SSI's own answer; checks on the owner's account are announced, repeatable and recorded. Amends 0024, 0029, 0031, 0045, 0047; amended 2026-10-24: private site IDs belong to the owning account (amends 0021); amended 2026-10-27: a send adds a buddy only by a known SSI account, everyone else is linked or added by the User on the Dive's page (no matching by name).
status: proposed
date: 2026-10-23
---

# ADR 0057: SSI aligned with its app

## Status
Proposed – 2026-10-23. From the owner's design session of 2026-10-23
([design](../superpowers/specs/2026-10-23-ssi-app-alignment-design.md),
[review](../research/2026-10-23-ssi-decompilation-review.md)); the owner accepts it (or doesn't).

## Context
The SSI integration ([ADR 0024](0024-ssi-target-via-app-api.md)) was built from community projects' captures and our
own checks. The app's code, read on 2026-10-22, shows its API client, the 345 keys of a saved dive with their types,
how it reads answers and the write bodies of buddies, sites and gear. The review found Dive Hub dropping six keys on an
update, misreading an expired sign-in, sending a wrong flag in every sample, sending every dive as scuba, and sending
nothing of several values it imports.

## Decision
- **The app is the source of truth.** Where its code shows how SSI is called, Dive Hub does it that way. Every claim
  in the [SSI reference](../references/ssi-app-api.md) carries its source: **[R]** read in the app or on the wire,
  **[T]** tested on the owner's account (new), **[S]** reported by others, **[?]** unknown.
- **The record and the answers.** A save sends every key of the app's dive row with the app's types (booleans as
  booleans); an update takes every one of those keys from the record SSI
  returned, so nothing of the row is lost, and sends no key the app doesn't send. An answer is read as the app reads it: 2xx, a body
  `status: 401` is signed out under any HTTP status, 503 is maintenance.
- **Both ways** (amends [0031](0031-lead-suit-cylinders-and-lead-estimate.md) and
  [0045](0045-tank-pressure-cylinders-and-sac-on-a-dive.md), "not sent to SSI"): the dive type (from the Dive's kind and
  the Primary recording's dive mode: apnea 6, CCR 8, SCR 4, extended range 2, else 0), the tank of a Dive with one
  Cylinder, the lead, the surface interval in seconds (corrected 2026-10-24 by the owner's [T] check,
  [values checks](../research/2026-10-24-ssi-values-checks.md); first written as minutes), tank pressure in the
  samples, CNS and heart rate. Read back by
  the import under [ADR 0056](0056-two-way-exchange-and-automation.md)'s rule.
- **Sites** (amends [0024](0024-ssi-target-via-app-api.md) and [0029](0029-push-requirements-and-buddies.md)): a Dive
  whose site has no SSI ID takes a nearby SSI site (100 m and name, [ADR 0021](0021-site-external-ids-and-import.md)), else
  Dive Hub creates the site at SSI as **private** and stores its ID. The blocking requirement becomes something the
  send fixes.
  - **Amended 2026-10-24** (owner, [piece 4](../superpowers/specs/2026-10-23-ssi-app-alignment-design.md); amends
    [0021](0021-site-external-ids-and-import.md)'s "at most one per Source and site"): other Users have their own SSI
    accounts, so a private ID belongs to the account at the Source that owns it, not to the shared site.
    `dive_site_external_id` gets `account_id`, a reference to the Diver's account at that Source
    (`diver_external_id`, removed with it; empty = public), never to a Connection; a site has at most one public ID per Source and at most
    one private ID per Source and account; an ID is still unique per Source. Only the sites module reads the table, and
    never shows an account another account's private ID. A new dive takes the public ID first, then the account's
    private one, then a nearby logbook site, then a new private site; an update keeps the ID the dive already has at
    SSI. The import stores a logbook site SSI marks private and owned by the account as that account's private ID.
- **Buddies** (amends [0029](0029-push-requirements-and-buddies.md)): a Participant missing from the SSI buddy list is
  added (`save_buddy`) when the Diver has an SSI account or an e-mail; with a name only if a check shows SSI keeps such
  an entry. Matched by account, e-mail, then exact name; the entry ID is remembered. The list is read with `get_buddies`.
  - **Amended 2026-10-27** (owner, [piece 5](../superpowers/specs/2026-10-23-ssi-app-alignment-design.md), after the
    [buddy checks](../research/2026-10-27-ssi-buddy-checks.md)): no matching by e-mail or name. A send adds an entry by
    itself only for a Diver with an SSI account, sending only that account (SSI fills the rest from the person's
    profile), and gives an entry made without an account the account once it is known, instead of adding a second one.
    Every other Participant not in the list is asked on the Dive's page (Link or add: pick an entry, scan the person's
    buddy code, or type first and last name and an optional e-mail); names and e-mail reach the Provider only on that
    action, never from a send, so a send still carries only accounts ([ADR 0029](0029-push-requirements-and-buddies.md)).
    Push runs never ask; they leave such Participants out and list the dives. The entry ID is remembered per list
    owner's account and Diver (`account_list_entry`). `search_buddy` is not used, nor any account number its answers leak.
- **Read-back** (amends [0047](0047-push-runs.md)): a save is compared with the record SSI returns in its answer;
  storage is confirmed by one logbook read per run, as [ADR 0049](0049-ssi-app-user-agent.md) still requires.
- **Checks on the owner's account:** allowed, each announced before it runs, each a mode of the owner's check script,
  each recorded in a dated research note (keys sent, what SSI stored, result, app version). The owner signs in in their
  own terminal; the password never reaches an agent. Test data is dated 2000-01-01 or named "Dive Hub test" and deleted.
- **Not done:** gear and gear sets (after equipment items, [ADR 0034](0034-equipment-items-and-service-schedules.md)),
  verifying dives ([ADR 0043](0043-dive-centres-and-ssi-verification-codes.md) stays), public sites.

## Consequences
- A dive edited in SSI's app keeps what Dive Hub doesn't know about.
- SSI receives what Dive Hub has; a site or a buddy no longer keeps a dive or a person from being sent.
- Dive Hub writes to the User's site and buddy lists at SSI, which it never did before.
- When SSI ships a new app version, the key table and the [T] notes show what to check again.
