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

## Sources (inbound)

| Source | Status |
|---|---|
| Garmin | planned |
| Suunto | planned |
| Own app connecting directly to dive computers | later |

## Targets (outbound)

| Target | Status |
|---|---|
| SSI | candidate |
| Others | open |

## Non-goals (so far)

_None defined yet._

## Open questions

- **Users:** what roles exist (diver, admin, dive center staff, instructor)? Can users share data with each other (buddies)?
- **Scope of data:** exact list of entities — to be derived from the UDDF gap analysis.
- **Data model:** UDDF as internal model, or own model with UDDF import/export?
- **Ingestion mechanism per source:** research suggests file import (FIT) as the baseline,
  because official Garmin/Suunto APIs are business-only
  ([dive data sources](../research/2026-10-02-dive-data-sources.md)). To be confirmed.
- **Duplicates:** how to merge the same dive arriving from several sources?
- **Outbound:** SSI and PADI have no public API; only QR payloads or unofficial
  automation exist. Is best-effort acceptable, or does outbound move to later?
- **Deployment:** target platform (e.g. Docker, home server, NAS)?
- **Relationship to existing tools** such as dive log apps: replace, complement, or integrate?
