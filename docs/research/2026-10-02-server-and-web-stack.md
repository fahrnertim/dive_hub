---
title: Server and web client stack options
summary: Comparison of language/framework combinations for Dive Hub's API server, worker and web SPA; top candidates are TypeScript end-to-end, C#/.NET + TypeScript SPA, and Go + TypeScript SPA.
status: done
date: 2026-10-02
---

# Server and web client stack options

Markers: **[V]** checked against the primary source; **[S]** secondary source; **[?]** not verified
(includes own assessments and estimates).

## Question

Which language/framework combinations suit Dive Hub's API server (+ worker) and web client,
given the architecture in [ADR 0004](../decisions/0004-system-architecture.md) (proposed) and
[architecture](../spec/architecture.md)? This note prepares the "language and framework" ADR;
it does not decide. FIT parsing libraries are covered by a separate research note; here only
the availability of Garmin's official FIT SDK is used as one criterion.

## Method

Official documentation and project pages of the frameworks, job queues and client generators
were checked (see [Sources](#sources)). Compressed base-image sizes were read from the Docker Hub
and MCR registry APIs on 2026-10-02. Popularity figures come from the Stack Overflow Developer
Survey 2025 and GitHub Octoverse 2025. Ratings for "AI agent fit" and "contributor-friendliness"
are own assessments [?].

## Criteria

| # | Criterion | Why it matters for Dive Hub |
|---|---|---|
| C1 | OpenAPI story | API-first; one spec feeds the web SPA now and a mobile app later |
| C2 | PostgreSQL access + migrations | Only database; rich relational model + Sample series |
| C3 | Postgres-backed job queue | Worker without Redis/broker (ADR 0004) |
| C4 | Auth | Built-in accounts now, OIDC later, bearer tokens for mobile |
| C5 | Footprint | Multi-arch (amd64 + arm64) image, low RAM on NAS hardware |
| C6 | Typing/safety | Complex domain (Dives, Recordings, Revisions, merges) |
| C7 | Ecosystem health 2026 | Long-term maintenance by a small team |
| C8 | AI coding agent fit | One developer + agents |
| C9 | Contributor-friendliness | Open-source self-hosted project |
| C10 | Official FIT SDK | Garmin ships C, C++, C#, Java, JavaScript, Objective-C, Python, Swift [V][fit] — no Go, Rust or Elixir |

## Findings

### Server stacks

| Stack | OpenAPI (C1) | Postgres + migrations (C2) | PG job queue (C3) | Auth incl. OIDC (C4) | Footprint (C5) | Typing (C6) | FIT SDK (C10) |
|---|---|---|---|---|---|---|---|
| **TypeScript / Node** — NestJS, Fastify, Hono, AdonisJS | Code-first: NestJS `@nestjs/swagger` [?], Fastify + `@fastify/swagger` [?], Hono `@hono/zod-openapi` (Zod is single source of truth) [S][hono-zod]; AdonisJS has no first-party OpenAPI [S][hono-zod] | Drizzle, Kysely, Prisma, each with migrations [?] | **pg-boss** (SKIP LOCKED, cron, DLQ, retries; Node ≥ 22.12, PG ≥ 13) [V][pgboss]; **Graphile Worker** (LISTEN/NOTIFY, ms latency, up to 10k jobs/s) [V][graphile] | **Better Auth**: email/password, Generic OAuth/OIDC plugin (PKCE, Keycloak etc.), Bearer plugin, Expo integration [V][ba-goauth][ba-expo] | `node:24-alpine` ≈ 62 MB compressed [V][hub]; RAM ~80–150 MB idle [?] | Good (structural, compile-time only; runtime validation via Zod/TypeBox) [?] | **Yes** (JavaScript) [V][fit] |
| **Python** — FastAPI; Django + DRF/Ninja | Code-first from type hints/Pydantic: FastAPI built-in [?], Django Ninja built-in [S][ninja]; DRF via drf-spectacular [?] | SQLAlchemy + Alembic (FastAPI) [S][endurain]; Django ORM + built-in migrations [?] | **Procrastinate** (PG ≥ 13, async, Django integration) [V][procrastinate]; Django 6.0 `django.tasks` defines the API but ships no production worker/backend [S][django6] | Django: built-in accounts, allauth for OIDC [?]; FastAPI: fastapi-users is in maintenance mode, Authlib for OIDC [S][fa-users] | `python:3.13-slim` ≈ 46 MB compressed [V][hub]; RAM ~100–250 MB per process [?] | Optional (mypy/pyright); Pydantic validates at runtime [?] | **Yes** (Python) [V][fit] |
| **Go** — std lib / chi / Huma | Code-first **Huma** (OpenAPI 3.1, JSON Schema, bring-your-own router) [V][huma]; or spec-first with oapi-codegen [?] | sqlc (SQL → typed Go, pgx) [S][sqlc] + goose/Atlas/golang-migrate [?] | **River**: transactional `InsertTx`, cron, unique jobs, Web UI; some features paid "Pro"; inserts also from Python/Ruby/TS/SQL [V][river] | No full framework; build accounts yourself + `coreos/go-oidc`, `x/oauth2` [?] | Static binary on distroless/alpine (alpine ≈ 4 MB) [V][hub]; RAM ~20–40 MB [?] | Static, simple; nil and error handling verbose; weaker for sum types [?] | **No** official SDK (community parsers only) [V][fit] |
| **C# / .NET 10** — ASP.NET Core minimal APIs | First-party `Microsoft.AspNetCore.OpenApi`, document at runtime or at build time [V][ms-openapi] | EF Core + migrations [?]; Dapper for raw SQL [?] | Hangfire (LGPL-3, PG via community `Hangfire.PostgreSql`) [V][hangfire][S][dotnet-jobs]; Wolverine (PG durable) or TickerQ (EF Core) [S][dotnet-jobs] | ASP.NET Core Identity + `MapIdentityApi` (register/login/refresh, bearer tokens for SPA/mobile; not JWT, simple scenarios only) [S][ms-identity]; OIDC handler built in [?] | `aspnet:10.0-alpine` ≈ 54 MB compressed [V][mcr]; Native AOT for smaller/faster apps, but with trimming/reflection limits [V][ms-aot]; RAM ~60–120 MB [?] | Strong (nullable reference types, records, pattern matching) [?] | **Yes** (C#) [V][fit] |
| **Kotlin/Java** — Spring Boot, Ktor | Spring: springdoc-openapi (Kotlin supported) [S][springdoc]; Ktor 3.4 (Jan 2026): compiler plugin + runtime OpenAPI [S][ktor] | Flyway/Liquibase; JPA, jOOQ, Exposed [?] | JobRunr (LGPL-3 OSS, PG, Spring starter) [S][jobrunr]; db-scheduler (Apache-2) [S][jobrunr] | Spring Security: OAuth2 client/resource server, OIDC [S][spring-oauth] | `eclipse-temurin:25-jre-alpine` ≈ 75 MB compressed [V][hub]; RAM typically 200–400 MB for Spring Boot JVM [?] (GraalVM native lowers it [?]) | Strong (Kotlin null-safety, sealed classes) [?] | **Yes** (Java) [V][fit] |
| **Rust** — axum | Code-first `utoipa` (macros, OpenAPI 3.1, `utoipa-axum`) [S][utoipa] | sqlx (compile-time-checked SQL) + `sqlx migrate` [S][utoipa] | `graphile_worker` Rust port (LISTEN/NOTIFY, cron, admin UI) [S][gw-rs]; smaller ecosystem [?] | No framework; build accounts yourself + `openidconnect` crate [?] | Tiny static binary; RAM ~10–30 MB [?] | Strongest (ownership, enums) but slow iteration, steep learning curve [?] | **No** official SDK [V][fit] |
| **Elixir** — Phoenix | `open_api_spex` (OpenAPI 3.0 from Plug/Phoenix code) [S][oas-spex] | Ecto + migrations [?] | **Oban** (PG ≥ 14, also MySQL/SQLite) — best-in-class [V][oban] | `phx.gen.auth` for accounts [?]; `assent`/`ueberauth` for OIDC [?] | Release on alpine, `elixir:1.18-alpine` ≈ 64 MB (build image) [V][hub]; RAM ~50–100 MB [?] | Dynamic; gradual set-theoretic types are being added, inference-only so far [S][elixir-types] | **No** official SDK [V][fit] |

| Stack | Ecosystem 2026 (C7) | AI agent fit (C8) [?] | Contributors (C9) [?] | Well-known self-hosted apps |
|---|---|---|---|---|
| TypeScript/Node | Node.js most-used web tech (49.1 %, SO 2025) [S][so2025]; TypeScript #1 language on GitHub by contributors (Octoverse 2025) [S][octoverse] | Very good: huge training corpus, types give fast feedback; risk: churn of libraries/patterns | Largest pool; one language across server + web | **Immich** (NestJS + Kysely + PostgreSQL; SvelteKit web; OpenAPI-generated clients; jobs via BullMQ/Redis) [V][immich] |
| Python | FastAPI 15.1 % and rising (SO 2025) [S][so2025] | Very good; weaker without strict typing | Large pool; low barrier | **Paperless-ngx** (Django + Angular) [S][paperless]; **Mealie** (Python REST backend + Vue) [S][mealie]; **Endurain** (FastAPI + SQLAlchemy/Alembic + PostgreSQL + Vue 3, imports FIT via fitdecode) [V][endurain]; **FitTrackee** (Flask + PostgreSQL/PostGIS + Vue 3, Leaflet, Chart.js) [V][fittrackee] |
| Go | Stable, backwards-compatible [?] | Very good: small language, explicit code, fast compile/test loop | Good; easy to read | Gitea/Forgejo, Miniflux [?] |
| C#/.NET | Strong; LTS cadence (.NET 10 current) [?] | Good; verbose but well-typed | Smaller in self-hosted scene | Jellyfin [?] |
| Kotlin/Java | Strong, enterprise-heavy [?] | Good | Smaller in self-hosted scene | Few in homelab space [?] |
| Rust | Growing [?] | Medium: borrow checker causes agent loops | Smaller pool, higher barrier | Vaultwarden, Lemmy [?] |
| Elixir | Phoenix most admired framework (SO 2025) [S][so2025]; small community [?] | Medium: less training data | Small pool | Plausible Analytics [?] |

**Observations**

- **Job queue without Redis** is mature in Node (pg-boss, Graphile Worker), Go (River), Python
  (Procrastinate), Elixir (Oban). In .NET and JVM the options exist but are less "PG-native"
  by default [S][dotnet-jobs][jobrunr]. Immich, the closest reference app, still uses Redis [V][immich].
- **Auth** is the biggest gap in Go and Rust (no batteries-included account system). .NET
  (Identity) and TypeScript (Better Auth) cover email/password + OIDC + bearer tokens for
  mobile out of the box [V][ba-goauth][S][ms-identity].
- **OpenAPI**: every serious option is code-first; the best "types are the spec" experience is
  in FastAPI/Ninja, Huma, ASP.NET Core and Hono/Zod [V][huma][V][ms-openapi][S][hono-zod].
- **Footprint**: base images are all 46–75 MB compressed except Go/Rust static binaries [V][hub][mcr];
  RAM differences matter more on a NAS than image size, JVM being the heaviest [?].
- **FIT SDK**: official in TS/JS, Python, C#, Java; not in Go, Rust, Elixir [V][fit].

### Web SPA stacks

| Framework | SPA mode | OpenAPI clients | Notes |
|---|---|---|---|
| **React** (+ Vite, TanStack Query/Router) | Native | All generators support it: openapi-typescript + openapi-fetch (types only, zero runtime cost) [V][oapi-ts]; Hey API (fetch/axios clients, TanStack Query, Zod/Valibot plugins) [V][heyapi]; orval (React/Vue/Svelte Query, SWR, Angular, Zod, MSW mocks) [V][orval] | Largest ecosystem (React 46.9 %, SO 2025) [S][so2025]; same mental model as React Native/Expo for a later mobile app [?] |
| **Vue 3** | Native | orval Vue Query [V][orval]; Hey API/openapi-ts framework-agnostic [V][heyapi] | Used by Endurain, FitTrackee, Mealie [V][endurain][fittrackee]; vue-i18n mature [?] |
| **Svelte 5 / SvelteKit** | `ssr = false` + `adapter-static` with fallback page; docs warn about SPA performance cost [V][sk-spa] | orval Svelte Query [V][orval]; openapi-fetch [V][oapi-ts] | Used by Immich [V][immich]; small bundles [?]; Paraglide for i18n [?] |
| **Angular** | Native | orval Angular, Hey API Angular client [V][orval][heyapi] | Batteries included (router, forms, i18n); used by Paperless-ngx [S][paperless]; heavier [?] |
| **Solid** | Native | Generic clients only [?] | Small ecosystem [?] |

**Building blocks (framework-independent)**

| Need | Option | Facts |
|---|---|---|
| Dive profile chart (depth over time, several series, thousands of points) | **uPlot** | 166,650 points in 25 ms cold start, ~48 KB min; no animations, panning via plugins [V][uplot] |
| | **Apache ECharts** | Line `sampling: 'lttb'` and `large` mode for big series, dataZoom, ~1 MB [S][echarts][V][uplot] |
| | Chart.js | Used by FitTrackee [V][fittrackee]; slower for large series [V][uplot] |
| Dive site maps | **MapLibre GL JS** | Open-source WebGL vector-tile renderer, TypeScript, native counterparts for mobile [V][maplibre] |
| | Leaflet | Raster tiles, simple; used by FitTrackee [V][fittrackee] |
| i18n | react-i18next / vue-i18n / Paraglide / Angular i18n | All mature [?]; Weblate integration used by FitTrackee [V][fittrackee] |

### Does a shared TypeScript stack (server + web + later mobile) pay off?

- **Pro:** one language and toolchain for one developer and agents; FIT SDK is official in
  JavaScript [V][fit]; shared validation schemas (Zod) and domain types (unit conversion, gas
  calculations, profile computation) could run on server and client; Better Auth has an Expo
  integration for React Native [V][ba-expo]; largest contributor pool [S][so2025][octoverse].
- **Con / limits:** with an OpenAPI-generated client, any server language already gives typed
  clients, so the type-sharing gain is mostly for **domain logic**, not API types [?]. Node's
  single thread needs care for CPU-heavy parsing (worker is separate anyway) [?]. Higher
  dependency churn in npm [?]. Immich shows the pattern works but chose Flutter for mobile, so
  TS sharing did not extend to its app [V][immich].

## Recommendation

The user decides; these are the strongest combinations against the criteria.

1. **TypeScript end-to-end** — Fastify or Hono (+ Zod OpenAPI) or NestJS; Drizzle/Kysely;
   pg-boss or Graphile Worker; Better Auth; React (or Svelte) SPA with Hey API/openapi-ts;
   uPlot; MapLibre. *For:* official FIT SDK, one language, best agent/contributor fit, real
   reuse for a React Native/Capacitor app, closest reference (Immich). *Against:* weaker runtime
   type guarantees, npm churn, framework choice on the server is fragmented (NestJS is heavy,
   Fastify/Hono need more assembly).
2. **C#/.NET 10 minimal APIs + TypeScript SPA** — first-party OpenAPI, EF Core migrations,
   Identity with bearer tokens, OIDC handler, official C# FIT SDK; queue via Wolverine/TickerQ/
   Hangfire.PostgreSql or a small custom `SKIP LOCKED` queue. *For:* strongest typed domain
   modelling with batteries included, good footprint. *Against:* two languages, smaller
   self-hosted contributor pool, PG job queue less mature than River/pg-boss/Oban.
3. **Go (Huma + sqlc + River) + TypeScript SPA** — *For:* smallest image and RAM (best for NAS),
   very good agent fit, River is excellent. *Against:* no official FIT SDK (relies on a
   community parser, see the FIT parsing note), auth must be assembled by hand, more
   boilerplate for a rich domain.

Not shortlisted: Python (good fit and official FIT SDK, but optional typing and higher RAM; a
reasonable 4th choice with FastAPI/Django Ninja + Procrastinate), Kotlin/Spring (heavy RAM),
Rust (slow iteration, no FIT SDK), Elixir (small pool, no FIT SDK, despite Oban).

For the web client, **React + Vite + TanStack Query + Hey API (or openapi-typescript)** is the
lowest-risk choice; **Svelte/SvelteKit SPA** or **Vue 3** are lighter alternatives with
precedents in self-hosted apps. **uPlot** for profiles and **MapLibre GL JS** for sites fit any of them.

## Open points

- RAM figures are estimates [?]; measure a hello-world API + worker per shortlisted stack on arm64.
- Outcome of the parallel FIT parsing note (quality of JS vs C# vs Go parsers for dive messages).
- Mobile app type (React Native, Capacitor, Flutter, native) affects how much TS sharing is worth.
- Whether to write the OpenAPI spec first (spec-first) or generate it from code; all shortlisted
  stacks support code-first.
- License check of job-queue choices (River Pro features, Hangfire LGPL, JobRunr LGPL).

## Sources

- [Garmin FIT SDK overview][fit]
- [pg-boss][pgboss], [Graphile Worker][graphile], [River docs][river], [Procrastinate][procrastinate], [Oban][oban], [Hangfire][hangfire]
- [.NET job schedulers 2026][dotnet-jobs], [JobRunr / db-scheduler][jobrunr], [graphile_worker (Rust)][gw-rs]
- [Huma][huma], [ASP.NET Core OpenAPI][ms-openapi], [.NET Native AOT][ms-aot], [ASP.NET Core Identity API][ms-identity]
- [Hono OpenAPI discussion][hono-zod], [Django Ninja][ninja], [springdoc-openapi][springdoc], [Spring Boot OAuth2][spring-oauth], [Ktor 3.4 OpenAPI][ktor], [utoipa][utoipa], [sqlc][sqlc], [open_api_spex][oas-spex], [Elixir gradual types][elixir-types]
- [Better Auth Generic OAuth][ba-goauth], [Better Auth Expo][ba-expo], [FastAPI Users status][fa-users], [Django 6.0 tasks][django6]
- [Docker Hub API (image sizes)][hub], [MCR dotnet/aspnet][mcr]
- [Stack Overflow Developer Survey 2025][so2025], [GitHub Octoverse 2025][octoverse]
- [Immich architecture][immich], [Endurain][endurain], [FitTrackee][fittrackee], [Paperless-ngx][paperless], [Mealie][mealie]
- [openapi-typescript][oapi-ts], [Hey API][heyapi], [orval][orval], [SvelteKit SPA][sk-spa], [uPlot][uplot], [ECharts performance][echarts], [MapLibre GL JS][maplibre]

[fit]: https://developer.garmin.com/fit/overview/
[pgboss]: https://github.com/timgit/pg-boss
[graphile]: https://worker.graphile.org/
[river]: https://riverqueue.com/docs
[procrastinate]: https://procrastinate.readthedocs.io/en/stable/
[oban]: https://oban.hexdocs.pm/Oban.html
[hangfire]: https://github.com/hangfireio/Hangfire
[dotnet-jobs]: https://steadycron.com/blog/dotnet-job-schedulers-compared/
[jobrunr]: https://foojay.io/today/task-schedulers-in-java-modern-alternatives-to-quartz-scheduler/
[gw-rs]: https://github.com/leo91000/graphile_worker_rs
[huma]: https://huma.rocks/
[ms-openapi]: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/overview?view=aspnetcore-10.0
[ms-aot]: https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/
[ms-identity]: https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity-api-authorization?view=aspnetcore-8.0
[hono-zod]: https://github.com/orgs/honojs/discussions/4621
[ninja]: https://github.com/vitalik/django-ninja
[springdoc]: https://springdoc.org/
[spring-oauth]: https://docs.spring.io/spring-boot/reference/security/oauth2.html
[ktor]: https://blog.jetbrains.com/kotlin/2026/01/ktor-3-4-0-is-now-available/
[utoipa]: https://github.com/juhaku/utoipa
[sqlc]: https://sqlc.dev/changelog/
[oas-spex]: https://github.com/open-api-spex/open_api_spex
[elixir-types]: https://elixir.hexdocs.pm/gradual-set-theoretic-types.html
[ba-goauth]: https://better-auth.com/docs/plugins/generic-oauth
[ba-expo]: https://better-auth.com/docs/integrations/expo
[fa-users]: https://fastapi-users.github.io/fastapi-users/latest/
[django6]: https://adamj.eu/tech/2025/12/03/django-whats-new-6.0/
[hub]: https://hub.docker.com/v2/repositories/library/node/tags/24-alpine
[mcr]: https://mcr.microsoft.com/v2/dotnet/aspnet/tags/list
[so2025]: https://survey.stackoverflow.co/2025/technology
[octoverse]: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
[immich]: https://docs.immich.app/developer/architecture
[endurain]: https://github.com/endurain-project/endurain
[fittrackee]: https://github.com/SamR1/FitTrackee
[paperless]: https://github.com/paperless-ngx/paperless-ngx
[mealie]: https://github.com/mealie-recipes/mealie
[oapi-ts]: https://openapi-ts.dev/
[heyapi]: https://heyapi.dev/
[orval]: https://orval.dev/
[sk-spa]: https://svelte.dev/docs/kit/single-page-apps
[uplot]: https://github.com/leeoniya/uPlot
[echarts]: https://www.mintlify.com/apache/echarts/guides/performance
[maplibre]: https://maplibre.org/maplibre-gl-js/docs/
