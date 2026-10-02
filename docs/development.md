---
title: Development guide
summary: How to set up, run, test and build Dive Hub locally; repository layout and tooling notes.
status: living
date: 2026-10-02
---

# Development guide

## Prerequisites

- Node.js ≥ 22.12 (the image uses Node 24 LTS).
- pnpm 12 (`packageManager` in `package.json`). Corepack < 0.34 can't start pnpm 12 (a Rust
  rewrite); install pnpm 12 directly or run it as `npx pnpm@12.8.1 …`.
- Docker with Compose, for PostgreSQL.

## First run

```sh
cp .env.example .env                       # local settings, git-ignored
docker compose -f compose.dev.yaml up -d   # PostgreSQL 18 on 127.0.0.1:5432
pnpm install
pnpm --filter @dive-hub/server dev         # API on http://127.0.0.1:3000 (migrates on start)
pnpm --filter @dive-hub/web dev            # web client on http://localhost:5173, proxies /api
```

Until sign-in exists (ADR 0011, next slice), the server acts as a single development user with
one own Diver. **Don't expose it beyond localhost.**

## Layout

| Path | What |
|---|---|
| `apps/server` | Fastify API + Graphile Worker (ADR 0004, 0007, 0010) |
| `apps/server/src/db/schema.ts` | Drizzle schema (ADR 0008); migrations in `apps/server/drizzle/` |
| `apps/server/src/fit/` | FIT adapter (`fit-file-parser`, ADR 0006) |
| `apps/server/src/imports/` | Import pipeline: archives, matching Recordings to Dives, Revisions |
| `apps/web` | React + Vite SPA (ADR 0005), uPlot depth profile |
| `packages/api-client` | Typed client generated from the server's OpenAPI description |

## Common tasks

| Task | Command |
|---|---|
| All tests | `pnpm test` (DB tests create and drop their own database; skipped if PostgreSQL is unreachable) |
| Type check | `pnpm typecheck` |
| New migration after schema change | `pnpm --filter @dive-hub/server db:generate`, then review and commit the SQL |
| Regenerate API client after route changes | `pnpm --filter @dive-hub/api-client generate` |
| Regenerate the synthetic FIT fixture | `pnpm --filter @dive-hub/server exec tsx test/fixtures/synthetic-dive.ts` |
| Build and run the image | `docker build -t dive-hub:dev .`, then `POSTGRES_PASSWORD=… docker compose up -d` |

Real dive files go in `samples/private/` (git-ignored). FIT adapter tests cross-check them against
Garmin's official SDK automatically when present ([samples](../samples/README.md)).

## Tooling notes

- **TypeScript 7** (native compiler) type-checks everything. `packages/api-client` also has
  **TypeScript 5.9** because `openapi-typescript` needs the JavaScript compiler API that TS 7 dropped.
- **TypeBox 1.x** (`typebox` package) is used with `@fastify/type-provider-typebox` 6. `drizzle-typebox`
  still targets `@sinclair/typebox` 0.34, so API schemas are written by hand for now (ADR 0009).
- **Drizzle 0.45** (stable 0.x API, `relations()` style); 1.0 is in beta.
- **pnpm supply-chain defaults stay on**: packages with install scripts must be approved in
  `allowBuilds` (`pnpm-workspace.yaml`); new releases are installable after one day.
- `@garmin/fitsdk` is a dev dependency only and must never reach the image (ADR 0006); the image
  build installs production dependencies only (`pnpm deploy --prod`).
