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

## Sources (inbound)

| Source | Status |
|---|---|
| Garmin | planned |
| Suunto | planned |
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
- **Ingestion mechanism per source:** research suggests file import (FIT) as the baseline,
  because official Garmin/Suunto APIs are business-only
  ([dive data sources](../research/2026-10-02-dive-data-sources.md)). To be confirmed.
- **Deployment:** target platform (e.g. Docker, home server, NAS)?
- **Relationship to existing tools** such as dive log apps: replace, complement, or integrate?
