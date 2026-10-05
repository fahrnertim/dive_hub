---
title: Importing dives from SSI
summary: Design for SSI as a Source of dives, decided and written down as ADR 0030 - trust per dive by evidence (sent by Dive Hub, from a dive computer, typed by hand) and per computer by the User, a Connection setting (off / only add / also create, matching window), hand-typed dives as Dives without a Recording, time zones from the position (geo-tz) or nearby dives, one JSON Original per dive; plus a related topic, holders of a dive computer over time. The implementation prompt is included (done, slice 15).
status: decided
date: 2026-10-06
---

# Importing dives from SSI

Asked by the project owner on 2026-10-06, after slice 14 (buddies): bring the dives of the User's SSI logbook into Dive
Hub. SSI is already a Provider ([ADR 0027](../decisions/0027-providers-as-adapters.md)) whose logbook read (the whole
logbook, profiles included, [SSI reference](../references/ssi-app-api.md)) Dive Hub already makes on every send.

The owner's own SSI logbook (about 90 dives) was never synced from a dive computer: every entry was typed by hand, so
times and depths may be rounded. Another User may have synced (part of) their SSI logbook from a dive computer (e.g. a
Mares); for them SSI is what Garmin and Suunto files are for the owner.

## Decided (owner, 2026-10-06)

1. **Trust is decided per dive, by evidence in SSI's record**, not by one switch for the whole account (one account can
   hold both kinds):
   - **Sent by Dive Hub** (our reference `divehub-…`, or a Push already pointing at it): already ours; linked, never
     imported back.
   - **Synced from a dive computer** (a profile in `diveSamples`, a serial number, SSI's "imported from computer" flag):
     a **Recording**, like a FIT file: its Device by serial number, attached to an overlapping Dive or a Dive of its own,
     may be primary.
   - **Entered by hand** (no profile, no computer): a **logbook entry**, rough values that only fill what Dive Hub lacks.
2. **A Connection setting says what the import may do:** off; only add to Dives already here (link and fill, never
   create); or also create Dives Dive Hub doesn't have. A second switch, "treat SSI's dive computer dives as
   recordings", on by default.
3. **Matching a logbook entry** to a Dive here: the same day and a start within a window; ambiguous matches go to
   "Needs your decision" (ADR 0016) instead of being guessed. The window may be smaller than 30 minutes and is
   **configurable** (per Connection).
4. **An unmatched logbook entry becomes a Dive without a Recording**, marked as entered by hand at SSI, with SSI's
   values. A later Import (the matching FIT file) attaches its Recording, which becomes primary; the rough values yield.
5. **Everything SSI provides with quality fills what the Dive lacks; nothing here is overwritten.** Site (by SSI site
   ID), buddies (buddy-list entries → Divers by SSI account), notes; from a dive confirmed as synced from a dive
   computer also the computer's water setting (and its other settings). A match also links the Dive to that SSI dive,
   so sending updates it instead of making a duplicate.
6. **A synced dive is recognised again** when the User later imports the dive computer's own file: the same Device
   (serial number) and start time, so it attaches to that Recording's Dive instead of making a second one.
7. **Dive computers found in the SSI logbook are listed in the import's preview, and the User decides once per
   computer** whether its dives at SSI are used as recordings or only as logbook entries (replacing the second switch of
   point 2). The default is recordings, unless Dive Hub already has that Device from files (then the files are better
   and SSI's 5 s copy only fills gaps). **The choice is kept per Connection**, not on the Device: another User may have
   dives from the same (lent) computer in their own SSI logbook, and the choice for them is theirs. A computer seen only
   at SSI becomes a Device of the Connection's Diver, the same Device its own files find later (point 6).
8. **Not now: SSI's dive number.** It may be wrong; working out dive numbers from Dive Hub's own data and correcting
   them in SSI is a topic of its own.

## Found (2026-10-06, dive #91 read back)

What SSI returns for a dive is in the [SSI reference](../references/ssi-app-api.md#a-dive-as-ssi-returns-it-checked-2026-10-06).
For the import:
- **The "from a computer" flag is set for Dive Hub's uploads too**, so "sent by Dive Hub" (our reference, or a Push)
  is checked first; a dive another tool uploaded from a computer file counts as synced, rightly.
- **SSI's profile is every 5 s.** Where Dive Hub has the computer's own file, its Recording stays primary.
- **SSI has no field for the computer's water setting.** If a synced Mares dive has none either, decision 5's water
  setting can't come from SSI, and the water stays the site's (ADR 0025).

## Related: a dive computer held by several people over time (its own topic)
Found while designing this (owner, 2026-10-06). Today a Device belongs to one Diver, and an import files a dive under
the Device's Diver, or skips it ("not your diver") when another User keeps that Diver. So a User who borrows another
User's computer can't import their dives from it, and a User who passed a computer on (even before Dive Hub existed)
can't import their own older dives from it afterwards.

Preferred way (owner): **holders of a Device over time** (ADR 0016 named "Device assignments with dates" as the option
for when lending is common). A Device has non-overlapping periods per Diver; an import files each dive under the
Diver who held the computer at the dive's start. A User sets periods for the Divers they keep; a period over another
User's dives from that computer needs that User's agreement (later); dives already in a logbook stay, only imports follow
the dates. Its own slice and ADR (amends 0016), before or after the SSI import. Until then, a borrowed computer's dives
in someone's SSI logbook come in as logbook entries for them instead of being skipped.

## Decided after the first round (owner, 2026-10-06)
- **Matching window:** 5, 15 (default), 30 or 60 minutes, per Connection.
- **How it runs:** on demand from the Connection, a preview first, then an Import in the worker; can be run again.
- **Fields Dive Hub doesn't record yet** (rating, conditions, gear, tanks) stay in the Original: **one JSON file per SSI
  dive** (that dive's record as received), stored like a FIT file; never the whole logbook answer, which holds the
  buddy list's personal data. An unchanged dive has the same hash next time; one changed in SSI's app updates in place.
- **Time zones** (SSI has none): from the position (dive, else its SSI site) through **geo-tz** (exact, territorial
  waters; chosen over `@photostructure/tz-lookup`, which errs on coasts), else the Diver's nearest Dive within 7 days,
  else unknown (wall-clock kept, matched by local time, said on the dive page). Lives in `src/dives/time-zone.ts`.
- **Ambiguous logbook entries** are decided in the preview (the "Needs your decision" panel is about Recordings).
- **Dive sites:** only a site that already has the SSI site ID is used; SSI's site data isn't copied (no licence, ADR 0024).
- **Order:** this import first, holders of a dive computer over time afterwards.
- All of it is [ADR 0030](../decisions/0030-importing-dives-from-providers.md).

## Still to check
- A dive synced by SSI's app from a dive computer (a Mares Puck 4, from another account the owner will connect): what
  SSI's app writes itself (flags, manufacturer and model, settings, a water or salinity field, the sample interval).
  The import is built against dive #91's shape and reads these fields defensively; this check comes before merging.

## Prompt: importing dives from SSI

**Done** (2026-10-06, slice 15 in the [architecture](../spec/architecture.md#implementation-status)); what changed while
building is in [ADR 0030](../decisions/0030-importing-dives-from-providers.md#amended-while-building-2026-10-06-slice-15).

```text
We're continuing Dive Hub. Everything you need is in this repository; read it first and don't rely on any
local memory (AGENTS.md Rule #1).

Task: import dives from a Provider, SSI first, as decided in ADR 0030 and docs/research/2026-10-06-ssi-import.md.
Everything is decided; don't re-litigate it. Ask me before building only if something in the code makes it harder
than it looks.

Read first:
- AGENTS.md, CLAUDE.md, docs/index.md, docs/skills.md
- ADR 0030 (this design), 0027 (providers as adapters), 0029 (requirements, buddies, link Pushes), 0028 (Participants,
  external Divers), 0026 (deleted dives stay deleted), 0024 (SSI, site licence), 0016 (Recordings, Devices,
  Duplicate candidates), 0015 (Overrides, Revisions), 0010 (worker), 0023 (checks)
- docs/research/2026-10-06-ssi-import.md, docs/references/ssi-app-api.md ("A dive as SSI returns it", "Buddies",
  the dive record table), docs/spec/data-model.md (Original, Import, Recording, Dive), docs/spec/clients.md
  (Imports, Dives, Sending a Dive to a Provider, Divers and Devices), docs/spec/architecture.md (slices 13a, 14)
- Code: apps/server/src/imports/ (import-service.ts, matching.ts), worker.ts, src/providers/ (provider.ts,
  push-service.ts, connection-service.ts, buddy-service.ts, routes.ts, ssi/ssi-adapter.ts, ssi-client.ts,
  ssi-record.ts), src/dives/ (dive-service.ts, routes.ts), src/fit/fit-adapter.ts (ParsedRecording), db/schema.ts
  (original, import, recording, device, dive, push, connection), apps/web/src/ (Connections.tsx, ProviderBuddies.tsx,
  ImportPanel.tsx, DiveDetail.tsx, lib/providers.ts), apps/server/test/ (provider-contract.ts, fake-ssi.ts,
  import-pipeline.test.ts, matching.test.ts, ssi-buddies.test.ts)

Build:
- Server:
  - src/dives/time-zone.ts with geo-tz (position → offset with summer time via Intl; else nearest Dive within 7 days;
    else unknown) and dive.utc_offset_source (device, position, nearby, unknown).
  - The dives kind gains import `list`; the SSI adapter offers list(context) (raw records and the context: buddy
    entry → SSI account, SSI site → name and position, no personal data) and parse(record, context) → a typed
    ImportedDive (evidence, local start, values, profile, Device, site ID, buddy accounts, notes). No odin_* outside
    providers/ssi/.
  - Connection settings: import mode (off / only add / also create), matching window (5/15/30/60, default 15), the
    per-computer choice.
  - Preview and start routes (GET/POST /api/connections/{id}/dive-import); the start stores one Original per dive
    (JSON) and an Import the worker runs like an upload. Logbook entries matched by local time and filled where empty
    (site only by an existing SSI site ID, Participants by SSI account, notes); Dives without a Recording when nothing
    matches and the mode allows; dives from a computer as Recordings (parser ssi-app-api, key ssi:<id>, Device by
    serial) through the same placement as files; link Pushes (up to date for Dives made from SSI). A file Recording
    attaching to a Dive whose primary is a Provider's copy becomes primary; any Recording attaching to a Dive without
    one becomes primary. Matching against Dives with an unknown offset compares local times. Deleted Dives stay
    deleted. Migrations generated and reviewed. Regenerate packages/api-client.
- Web: the import on the Connection (settings, the preview with computers and decisions, start, the outcome as an
  Import), the dive page for a Dive without a Recording, where its time zone came from; translations (en, de).
- Tests: test-first where it fits; a fake SSI logbook with hand-typed dives, a computer dive, one sent by Dive Hub and
  ambiguous ones; time-zone unit tests (coast, border, open sea, summer time); the contract suite gains
  dives.import.list; browser tests with area tags; ui-quality cases for every new state.
- Docs: ADR 0030 (amend with what changed while building), data model, architecture (next slice), clients.md (routes,
  duties), the SSI reference, index.md; mark this note's prompt done.

Rules:
- Skills first (AGENTS.md); the search on 2026-10-06 ("data import", "deduplication", "fuzzy matching", "record
  linkage", "data provenance", "sync conflict") found nothing; search again only for new areas.
- Vet geo-tz before adding it (license, size, data, maintenance) and record it in ADR 0030 if anything differs.
- `pnpm check` while working, `pnpm check:full` before proposing a commit, review capture with
  REVIEW_AREAS=dives,account; look at the screenshots.
- Commit only when I say so (on main, short subject, blank line, body).
- End with a short summary: what was built, what you checked, simplifications, what you need me to decide.
```
