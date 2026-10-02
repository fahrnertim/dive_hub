---
title: "ADR 0008: Drizzle for database access and migrations"
summary: The database schema is defined once in TypeScript with Drizzle; migrations and validation schemas are generated from it.
status: accepted
date: 2026-10-02
---

# ADR 0008: Drizzle for database access and migrations

## Status
Accepted – 2026-10-02

## Context
[ADR 0005](0005-typescript-stack.md) left database access open between Drizzle and Kysely.
The [data model](../spec/data-model.md) is large and relational (Dives, Recordings, Participants,
Revisions, Pushes, …) and needs PostgreSQL features: arrays for Sample series, JSONB for
per-source extension data, partial unique indexes for soft deletes
([data, sync, upload, auth](../research/2026-10-02-data-sync-upload-auth.md)).
Fastify generates OpenAPI from route schemas ([ADR 0007](0007-fastify-http-framework.md)).

## Decision
- **Drizzle** is the database access library. The schema is defined once in TypeScript.
- **Migrations** are generated from schema changes with `drizzle-kit`, reviewed and committed
  as SQL; hand-written SQL is allowed where Drizzle can't express something (e.g. triggers).
  They run automatically on start ([ADR 0004](0004-system-architecture.md)).
- **Raw SQL** is fine where it's clearer (Sample series arrays, sync queries), through Drizzle's
  `sql` helper so it stays parameterised.
- **Validation schemas** for API input and output can be derived from the Drizzle schema where
  that fits; API shapes stay separate from table shapes when they differ.

## Considered options
- **Kysely.** Close to SQL, stable, used by Immich. Rejected: migrations and types are written or
  generated separately, which means more repetitive code for a large model, and no usable agent skill.
- **Prisma.** Not shortlisted: its own schema language and generated client are heavier than we need.

## Consequences
- One place for table definitions; types, migrations and validation follow from it.
- Generated migrations must still be reviewed: renames and data migrations need manual care.
- Drizzle's API has changed between versions; we pin versions and upgrade deliberately.
