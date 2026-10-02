---
title: Product specification
summary: Dive Hub is a self-hosted hub that collects dive data from many sources and can forward it to connected services.
status: draft
date: 2026-10-02
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
  external buddies are Divers managed only by the User who created them.
- **Buddies and sharing:** each Diver has their own Dive; Dives of the same descent are
  linked as a Joint dive after the buddy accepts a Buddy suggestion. Visibility per Dive:
  private, Joint dive, or instance. Dive sites and Operators are shared instance-wide.
- **Duplicates:** several Recordings per Dive; one is primary, manual Overrides win.
  Unambiguous time overlaps are auto-attached (undoable); otherwise the User decides.
- **Re-imports:** 3-way merge against the previous Import; hub edits win and conflicts are flagged.
- **Outbound:** modelled now (Target, Push state), built in a later phase. First candidate
  is the SSI QR payload (no stored credentials).
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
| SSI | later phase (QR payload first) |
| Others | open |

## Non-goals (so far)

_None defined yet._

## Open questions

- **Users:** what roles exist beyond admin (dive center staff, instructor)? How do Users
  find each other's Divers? More in the [data model](data-model.md#open-questions).
- **Relationship to existing tools** such as dive log apps: replace, complement, or integrate?
