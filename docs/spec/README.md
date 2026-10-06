---
title: Product specification
summary: Dive Hub is a self-hosted hub that collects dive data from many sources and can forward it to connected services; later features (auto-import of sites near Dives, planning tools: a lead estimate, MOD and bottom time, gas plans for groups; equipment with service intervals; an MCP connector for LLMs; a dive assessment).
status: draft
date: 2026-10-06
---

# Product specification

## Vision

Dive Hub is a **self-hosted hub for divers**: the trunk for everything
dive-related. Your dive data lives on your own instance, independent of any single
vendor or platform.

## Core concept

```
 Sources (inbound)                 Dive Hub                 Targets (outbound)
 ─────────────────            ─────────────────            ──────────────────
 Garmin          ─┐           │               │           ┌─▶ SSI
 Suunto          ─┼──────────▶│  collect,     │──────────▶┤
 Own app / dive  ─┤           │  store,       │           └─▶ (other services)
 computers (later)┘           │  unify        │
                              ─────────────────
```

1. **Sink** – ingests dive data from multiple sources.
2. **Hub** – stores and consolidates it as the single source of truth.
3. **Broadcast** (optional) – pushes data to connected services.

## Decided

- **Multi-user:** one instance serves multiple users (e.g. family, club, dive center).
- **Scope beyond dives:** Dive Hub covers more than dive logs (e.g. certifications,
  equipment, dive sites, trips). Standard formats such as UDDF are used to define
  the scope — see [UDDF gap analysis](../research/2026-10-02-uddf-gap-analysis.md).
- **Own data model, UDDF as adapter:** [ADR 0003](../decisions/0003-own-data-model-uddf-as-adapter.md);
  entities and scenarios in the [data model](data-model.md), vocabulary in the [glossary](../glossary.md).
- **Users and Divers:** a User manages one or more Divers (own, child, dive-center guest);
  external buddies are Divers no User manages, shared like Dive sites; every User sees every Diver by name
  ([ADR 0028](../decisions/0028-shared-divers-and-participants.md)).
- **Buddies and sharing:** each Diver has their own Dive; Dives of the same descent are
  linked as a Joint dive after the buddy accepts a Buddy suggestion. Visibility per Dive:
  private, Joint dive, or instance. Dive sites and Operators are shared instance-wide.
- **Duplicates:** several Recordings per Dive; one is primary, manual Overrides win.
  Unambiguous time overlaps are auto-attached (undoable); otherwise the User decides.
- **Re-imports:** 3-way merge against the previous Import; hub edits win and conflicts are flagged.
- **Outbound:** modelled now (Target, Push state), built in a later phase. The first Target is SSI, through
  its private app API: dives with profile, updated in place, with SSI's dive ID kept on the Push. Passwords
  are stored only when the User chooses, always encrypted. QR payload follows as the fallback
  ([ADR 0024](../decisions/0024-ssi-target-via-app-api.md), [SSI API research](../research/2026-10-04-ssi-api.md)).
- **Phase 1 ingestion:** file import only, and only Garmin FIT files. No cloud APIs
  (Garmin's and Suunto's are business-only, see [dive data sources](../research/2026-10-02-dive-data-sources.md)).
  Suunto (FIT + JSON) follows in a later phase; the data model already covers it.
- **Architecture and deployment:** API-first; one app image (API + web client + worker)
  plus PostgreSQL, deployed with Docker Compose; built-in accounts, OIDC later
  ([ADR 0004](../decisions/0004-system-architecture.md), [architecture](architecture.md)).
- **Stack:** TypeScript end-to-end, React web client ([ADR 0005](../decisions/0005-typescript-stack.md)).
- **License:** Apache-2.0; the published image uses an MIT FIT parser, Garmin's SDK only in tests
  ([ADR 0006](../decisions/0006-license-apache-2-and-fit-parser.md)).

## Sources (inbound)

| Source | Status |
|---|---|
| Garmin (FIT file import) | phase 1 |
| Suunto (FIT + JSON file import) | later phase |
| Other logbooks (UDDF, Subsurface) | later phase |
| Cloud APIs (Garmin, Suunto) | not planned (business-only access) |
| Own app connecting directly to dive computers | later |

## Targets (outbound)

| Target | Status |
|---|---|
| SSI | app API ([ADR 0024](../decisions/0024-ssi-target-via-app-api.md)), built; QR payload later as fallback |
| Others | open |

## Later features

Noted for later; not designed or decided yet.

- **Auto-import of Dive sites near imported Dives** (owner, 2026-10-05). When an admin has configured it, importing
  a Dive with a GPS position also imports the Dive sites close to it from the chosen Sources, so the Dive can be
  linked to a site at once. It would build on the Site import ([ADR 0021](../decisions/0021-site-external-ids-and-import.md),
  [ADR 0025](../decisions/0025-ssi-site-import-and-site-water-type.md)): a small box around the position, the same
  matching and history, then the existing link to the only site within 200 m
  ([ADR 0020](../decisions/0020-dive-sites.md)). To decide then:
  - where it is configured (admin setting: which Sources, how far around the Dive), and how the ODbL and SSI
    confirmations are given once for runs nobody starts by hand;
  - whether it creates sites or only fills ("only fill"), and how often it may ask a Source (Overpass and Wikidata
    fair use, SSI's one large file: download once and reuse it for a while);
  - whether the area's sites are imported, or only the nearest few;
  - what the importing User sees, since the sites are shared by every User.

- **Planning tools, later a dive planner** (owner, 2026-10-06). Tools that help prepare a dive, later combined around a
  planned dive. The first is a **lead estimate** (weight calculator), decided in
  [ADR 0031](../decisions/0031-lead-suit-cylinders-and-lead-estimate.md) and designed in the
  [weight calculator note](../research/2026-10-06-weight-calculator.md): Dives first record lead (placed, with how it felt),
  the exposure suit and Cylinders, Divers a body weight (slice 19); then a Tools page suggests lead from the Diver's own
  Dives with the same suit, adjusted by physics for the cylinder and water, with a rule of thumb when there is no history
  (slice 20). The second is **MOD and bottom time**, decided in [ADR 0032](../decisions/0032-mod-and-no-decompression-limits.md)
  and designed in the [gas and NDL note](../research/2026-10-06-gas-and-ndl-tools.md): MOD, best mix, EAD and END for any
  mix; for air and nitrox to 40 m the shortest of the no-decompression limit (Bühlmann ZHL-16C with the Diver's own GF),
  the oxygen limit and the gas (slice 21). The third is a **gas plan** for a Diver or a group, decided in
  [ADR 0033](../decisions/0033-gas-plans-rules-and-groups.md) and designed in the
  [gas consumption note](../research/2026-10-06-gas-consumption-planning.md): levels, every gas rule explained (rock bottom
  by default, never below 50 bar), any number of Divers with the controlling one marked, SAC per Dive from the logbook
  (slice 22). Not decided yet: sharing a planning SAC with buddies, buoyancy per Equipment item (waits for Equipment items),
  repetitive dives from the logbook, sites' altitude, trimix limits, what a planned dive is and whether it becomes the
  Dive once dived.

- **Equipment and service intervals** (owner, 2026-10-06). A Diver's Equipment items with service schedules the User sets
  up (several per item; months, dives and/or hours, whichever first) and service records; usage from items on every Dive
  while in use (with exceptions), items put on single Dives, Devices and Cylinders; reminders in the app. Decided in
  [ADR 0034](../decisions/0034-equipment-items-and-service-schedules.md), designed in the
  [equipment note](../research/2026-10-06-equipment-and-service.md) (slice 23). Later: lending and holders over time, parts,
  receipts, SSI's gear list.

- **An MCP connector** (owner, 2026-10-06). A User lets their LLM client read their logbook through a read-only MCP
  endpoint in the app, with a personal token (OAuth for claude.ai and ChatGPT later), scopes, a log and an admin switch.
  Decided in [ADR 0035](../decisions/0035-mcp-connector.md), designed in the [MCP note](../research/2026-10-06-mcp-connector.md)
  (slice 17, built 2026-10-06: seven read tools over Dives, sites and Divers; the planned features, now slices 18–23, add
  their tools). Later: OAuth, writes with confirmation.

- **Dive assessment** (owner, 2026-10-06). Findings on every logged Dive from fixed, versioned rules (ascent rate, the last
  metres, safety stop, NDL margin, ceilings, oxygen, gas left, sawtooth, reverse profiles, surface intervals, days in a
  row …), each with its value, threshold, source, evidence and a recommendation; no score; the computer's own events
  beside them. Decided in [ADR 0036](../decisions/0036-dive-assessment.md), designed in the
  [assessment note](../research/2026-10-06-dive-assessment.md) (slice 18, built 2026-10-06 without gas left and the surfacing
  GF, which slices 19 and 21 add). Later: trends across dives.

## Non-goals (so far)

_None defined yet._

## Open questions

- **Users:** what roles exist beyond admin (dive center staff, instructor)? How do Users
  find each other's Divers? More in the [data model](data-model.md#open-questions).
- **Relationship to existing tools** such as dive log apps: replace, complement, or integrate?
