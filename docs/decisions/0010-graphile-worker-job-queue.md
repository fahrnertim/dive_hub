---
title: "ADR 0010: Graphile Worker as job queue"
summary: Background jobs (Imports, later Pushes) run on Graphile Worker, enqueued with SQL inside the same transaction as the data they belong to.
status: accepted
date: 2026-10-02
---

# ADR 0010: Graphile Worker as job queue

## Status
Accepted – 2026-10-02

## Context
[ADR 0004](0004-system-architecture.md) puts the job queue in PostgreSQL, run by a maintained
library, with jobs enqueued in the same transaction as their data. Candidates were pg-boss and
Graphile Worker ([server and web stack](../research/2026-10-02-server-and-web-stack.md)).

## Decision
- Background jobs use **Graphile Worker**.
- Jobs are enqueued with its SQL function (`graphile_worker.add_job`) inside the transaction that
  creates the Import (or later the Push), via Drizzle. Either both exist or neither does.
- Job keys deduplicate work where a job must not run twice for the same thing.
- The worker runs inside the app process by default and can run as its own service from the same
  image (ADR 0004). Graphile Worker's own schema is migrated by the library on start.

## Considered options
- **pg-boss.** Popular, with a JavaScript API, dead-letter queue and more built-in management.
  Rejected: joining an existing transaction needs extra wiring, and it polls instead of being
  notified (LISTEN/NOTIFY).

## Consequences
- An Import's job can't be lost or orphaned: it commits or rolls back with the Import.
- New jobs are picked up almost immediately.
- There's no agent skill for it; its `llms.txt` and docs are the reference.
- Failed jobs need our own visibility (Import status), since there's no built-in dead-letter UI.
