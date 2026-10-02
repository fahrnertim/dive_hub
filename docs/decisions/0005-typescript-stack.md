---
title: "ADR 0005: TypeScript end-to-end; React web client"
summary: Server, worker and web client are written in TypeScript; the web client is a React SPA using a client generated from the OpenAPI description.
status: accepted
date: 2026-10-02
---

# ADR 0005: TypeScript end-to-end; React web client

## Status
Accepted – 2026-10-02

## Context
[ADR 0004](0004-system-architecture.md) fixes the shape (API-first, one app image with worker,
PostgreSQL). The language decides the FIT parser, the Postgres job queue, the auth library,
how easy contributions are and how well AI coding agents work with the code.
Research: [server and web stack](../research/2026-10-02-server-and-web-stack.md),
[FIT parsing libraries](../research/2026-10-02-fit-parsing-libraries.md).

## Decision
- **TypeScript** for server, worker and web client, on the **Node.js LTS** runtime.
- **Web client:** React single-page app (Vite), data fetching with TanStack Query, API client
  generated from the OpenAPI description.
- **Library candidates** (chosen in the first implementation spike, each recorded when picked):
  - HTTP framework: **Fastify** ([ADR 0007](0007-fastify-http-framework.md)).
  - Database access and migrations: **Drizzle** ([ADR 0008](0008-drizzle-database-access.md)).
  - Job queue on PostgreSQL: **Graphile Worker** ([ADR 0010](0010-graphile-worker-job-queue.md)).
  - API schemas: **TypeBox** ([ADR 0009](0009-typebox-schemas.md)).
  - Auth: **Better Auth** ([ADR 0011](0011-better-auth.md)).
  - Dive profile charts: uPlot. Dive site maps: MapLibre GL JS.
- **FIT parser:** see [ADR 0006](0006-license-apache-2-and-fit-parser.md).

## Considered options
- **C#/.NET + TypeScript SPA.** Strongest typing and batteries included (Identity, EF Core,
  OpenAPI), official C# FIT SDK. Rejected: two languages and a smaller contributor pool among self-hosters.
- **Go + TypeScript SPA.** Smallest RAM footprint, excellent queue (River). Rejected: no official
  FIT SDK, auth must be built by hand, two languages.
- **Python + TypeScript SPA.** Official FIT SDK and fitdecode. Rejected: optional typing, higher RAM,
  and the main auth library is in maintenance mode.
- **Svelte or Vue for the web client.** Lighter, with self-hosted precedents (Immich, Endurain).
  Rejected: React has the largest ecosystem and a path to React Native/Expo for mobile.

## Consequences
- One language across the code base; shared domain logic (units, gas and profile calculations)
  can live in a common package used by server, web and a future React Native app.
- Runtime validation is needed at the edges (API input, parsed files), since TypeScript types
  vanish at runtime; schema libraries (e.g. Zod) cover this.
- npm dependency churn needs active upkeep (lockfile, automated updates).
- Node uses more RAM than Go; the 2 GB NAS target must be measured, not assumed.
