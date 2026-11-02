---
title: An import treats dives another Dive Hub sent like any other dive
summary: A Provider dive carrying a Dive Hub reference whose Dive doesn't exist on this instance at all (sent by another instance, such as a development one) is skipped today as "sent by Dive Hub"; it should be assessed by its evidence like any other dive. Needs an amendment to ADR 0030.
status: draft
risk: medium
date: 2026-11-02
---

# An import treats dives another Dive Hub sent like any other dive

## Goal
When a dive at a Provider has a Dive Hub reference (`divehub-<dive id>`) but no Dive with that id exists on this
instance (live or deleted, any User), the import assesses it by its evidence like any other dive: from a dive
computer it becomes a Recording (or a logbook entry, per the Connection's choice for that computer); typed by hand it
is a logbook entry. A reference naming a Dive that exists here, deleted or another User's, is still skipped as
`sent_by_dive_hub`. Server tests cover all three cases.

## Why
Found 2026-11-02 when the owner planned to move from a development instance to production on the same SSI account.
SSI only gets the reference on dives Dive Hub creates there (`buildCreateRecord`, apps/server/src/providers/ssi/ssi-record.ts),
so a dive the development instance created would be skipped by production without a word, and a dive that exists only
at SSI because of it never reaches production. Dives the computer brought to SSI itself (a Mares) have no reference
and are not affected.

## Read first
- [ADR 0030](../decisions/0030-importing-dives-from-providers.md), "Trust" (evidence order) and the amendment on
  "Sent by Dive Hub".
- apps/server/src/providers/dive-import/dive-import.ts: `assess` (the `ours` branch near :262) and `ownsLive` (:228);
  `REFERENCE_PREFIX` in apps/server/src/providers/provider.ts.
- [data-model.md](../spec/data-model.md), "A Provider's copy".

## Decided
- No database change; "exists on this instance" is a lookup of the Dive id, deleted Dives included (ADR 0026 keeps them).
- A file's Recording still beats a Provider's copy; no per-computer primary source (owner, 2026-11-02: the existing
  rule covers Garmin API, Suunto files and a Mares that only reaches Dive Hub through SSI).

## Open
The ADR amendment's wording: `docs/decisions/` is a protected path, so an unattended run drafts it for the owner.

## Skills to load
postgres-drizzle, security-and-hardening (read each override in [docs/skills.md](../skills.md#overrides) first).

## Don't
- Change the reference format or what Dive Hub sends.
- Import a dive whose reference names a Dive of another User on this instance.
