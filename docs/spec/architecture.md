---
title: System architecture
summary: Components of Dive Hub, how they talk to each other and how they are deployed.
status: draft
date: 2026-10-02
---

# System architecture

Decided in [ADR 0004](../decisions/0004-system-architecture.md). Terms follow the [glossary](../glossary.md).

## Components

```
            ┌──────────────┐   ┌───────────────────┐
            │  Web client  │   │ Mobile app (later) │  file picker,
            │  (browser)   │   │                    │  share receiver
            └──────┬───────┘   └─────────┬──────────┘
                   │      HTTPS / JSON API (one API for all clients)
            ┌──────▼─────────────────────▼──────┐
 operator's │            API server             │
 reverse  ─▶│ auth · domain logic · import API  │
 proxy/TLS  └──────┬───────────────┬────────────┘
                   │               │ jobs (queue in DB)
                   │        ┌──────▼──────┐
                   │        │   Worker    │
                   │        └──┬───────┬──┘
            ┌──────▼───────────▼┐   ┌──▼───────────────────┐
            │    PostgreSQL     │   │ File storage (volume) │
            │ logbook, samples, │   │ Originals, Media      │
            │ job queue         │   └───────────────────────┘
            └───────────────────┘
```

| Component | Responsibility |
|---|---|
| **API server** | Authentication, authorization (Diver management, Visibility), domain logic, HTTP/JSON API with an OpenAPI description, receiving files, serving the web client's static files. |
| **Worker** | Background jobs: parse Originals into Recordings, match to Dives (auto-attach, Duplicate candidates), later Pushes and watched folders. Same code and image as the API server; runs in the app process by default, optionally as its own service. |
| **Web client** | Single-page app; uses only the public API. |
| **Mobile app** | Later. Type open; uses the same API. |
| **PostgreSQL** | All structured data, including Sample series and the job queue. |
| **File storage** | Originals (unchanged, by content hash) and Media on a mounted volume. |

## Import flow (phase 1: Garmin FIT)

1. A client uploads one or more files to the API (how is still open, see below).
2. The API stores each file as an **Original** (content hash; a known hash is not stored twice),
   creates an **Import** and queues a job. It answers right away with the Import's ID.
3. The worker parses the FIT file, resolves the **Device** → Diver, creates or updates the
   **Recording**, then creates a **Dive** or auto-attaches to one, and writes **Revisions**.
4. The client polls or is notified of the Import's outcome.

## Deployment

Docker Compose, two services by default (amd64 + arm64 images, pinned versions, healthchecks):

| Service | Image | Notes |
|---|---|---|
| `app` | `divehub` | API + web client + worker (in-process by default); exposes one HTTP port |
| `worker` | `divehub` | optional: same image, worker command, when the in-process worker is switched off |
| `db` | `postgres` | pinned major version; data volume; port not published |

Migrations run automatically on start (one process at a time). Liveness and readiness endpoints.

Volumes: database data, file storage. TLS and the reverse proxy are the operator's
responsibility (Caddy, Traefik, NAS proxy). We document a sample setup.
Backup = `pg_dump` + the file volume.

## Authentication

Built-in accounts (e-mail + password). Sessions use tokens that both browser and
mobile clients can use. OIDC (Authentik, Authelia, Keycloak, …) is planned for later.

## Open questions

- **Libraries** within the TypeScript stack ([ADR 0005](../decisions/0005-typescript-stack.md)):
  HTTP framework, DB access, queue, auth. FIT parser: [ADR 0006](../decisions/0006-license-apache-2-and-fit-parser.md).
- **How files reach the API:** single file, Garmin "Export Original" zip, full account
  export zip; resumable uploads for large account exports?
- **Sample storage layout** in PostgreSQL (row per sample vs. arrays/compressed blocks per Recording).
- **Notifications** from worker to client (polling vs. server-sent events).
