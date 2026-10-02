---
title: "ADR 0004: API-first system architecture, deployed with Docker Compose"
summary: One app image (API + web client + worker) plus PostgreSQL; all clients use one OpenAPI-described API; built-in accounts first.
status: accepted
date: 2026-10-02
---

# ADR 0004: API-first system architecture, deployed with Docker Compose

## Status
Accepted – 2026-10-02

## Context
Dive Hub is self-hosted and multi-user ([spec](../spec/README.md)). Its first client is a web
client, and a mobile app is expected later: files will arrive by web upload, and later by mobile
file picker or share receiver. Self-hosters run it on home servers, NAS boxes (often 2 GB RAM)
or small VPSs, mostly with Docker. Parsing and matching imported files can take longer than an
HTTP request should.

Research on 16 comparable self-hosted apps supports this shape:
[self-hosted architecture](../research/2026-10-02-self-hosted-architecture.md),
[data, sync, upload, auth](../research/2026-10-02-data-sync-upload-auth.md).

## Decision
- **API-first:** the API server is the only component that touches the database and
  file storage. Every client (web now, mobile later) uses the same HTTP/JSON API, described with
  **OpenAPI**; client code is generated from it.
- **Web client** is a single-page app built separately and served as static files by the app image.
- **Worker:** imports (and later Pushes, watched folders) run as background jobs from a
  maintained Postgres-backed queue library; no Redis or message broker. Jobs are enqueued in the
  same transaction as the data they belong to. By default the worker runs **inside the app
  process**; a setting lets operators run it as a separate service from the same image.
- **PostgreSQL** is the only database.
- **File storage** for Originals and Media is a mounted volume, behind a small storage interface
  so S3-compatible storage can be added later.
- **Deployment:** Docker Compose with two services by default, `app` and `db` (PostgreSQL);
  optional `worker` service from the same image. Images for amd64 and arm64. Versions are pinned
  (including the PostgreSQL major version), services have healthchecks, and the database port is
  not published. TLS and the reverse proxy are the operator's; we document a sample setup,
  including upload size limits.
- **Operations:** database migrations run automatically on start, guarded so only one process
  runs them. The app exposes liveness and readiness endpoints. Configuration comes from
  environment variables.
- **Auth:** built-in accounts (e-mail + password) with revocable sessions usable by web (cookie)
  and mobile (bearer token). OIDC comes later; credentials are stored apart from the user record
  so it fits without redesign.
- **Mobile:** type not decided. The API-first design keeps PWA, cross-platform and native open.

Details: [architecture](../spec/architecture.md).

## Considered options
- **Separate web container (nginx).** Rejected: one more image to build and version, with no
  benefit for a self-hosted install. Most comparable projects ship one image.
- **Always a separate worker service.** Rejected as the default: costs RAM on small NAS boxes.
  It remains an option.
- **Redis-backed queue.** Rejected: one more service to run, secure and back up; Postgres queues
  are mature in every candidate language and our job volume is tiny.
- **Embedded database (SQLite).** Rejected: weaker for multi-user concurrency; we want JSONB and
  the queue in the database.
- **Supporting SQLite and PostgreSQL.** Rejected: twice the testing for little gain.
- **OIDC-only sign-in.** Rejected for phase 1: it requires an identity provider, which most users don't run.

## Consequences
- Each client is a consumer of the API. Nothing is available only in the web client.
- Backup = PostgreSQL dump + the file volume. Built-in scheduled dumps are worth considering.
- The API and the worker are deployed and upgraded together, from one version.
- PostgreSQL major upgrades aren't automatic with the official image; we must document
  (or tool) the upgrade path.
- We depend on PostgreSQL features (JSONB, `SKIP LOCKED`). Moving away later would be costly.
