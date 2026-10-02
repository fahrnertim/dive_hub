---
title: Self-hosted multi-user web apps with Docker Compose
summary: How comparable self-hosted projects package and operate API, web client, worker, queue, database and auth, and what that means for ADR 0004.
status: done
date: 2026-10-02
---

# Self-hosted multi-user web apps with Docker Compose

## Question

What are current best practices for the architecture, packaging and operations of
self-hosted, multi-user web apps deployed with Docker Compose — and does the proposed
[ADR 0004](../decisions/0004-system-architecture.md) (API-first; one app image serving API +
SPA, same image run as worker; job queue in PostgreSQL; PostgreSQL only; files on a volume;
built-in accounts, OIDC later; operator brings reverse proxy/TLS) match them?

Markers: **[V]** checked against a primary source (the project's own repo, compose file or
docs), **[S]** secondary source, **[?]** unverified.

## Method

- Downloaded and read the official `docker-compose.yml` (or the compose snippet in the
  install docs) of 14 projects, plus Dockerfiles, `package.json` and docs pages where the
  compose file did not answer a question (worker, queue, auth, migrations, backups).
- Checked published image architectures via the Docker Hub API (`tags/latest`).
- Read the READMEs of PostgreSQL queue libraries and articles on their limits.
- Searched GitHub issues/discussions for operator complaints. Reddit could not be searched
  effectively with the available tools; complaint evidence is from GitHub and project docs only.
- State as of 2026-10-02 (`main`/default branches).

## Findings

### Comparison of projects

| Project | Services in official compose | Worker | Queue / broker | DB | Web client served by | Auth | Images |
|---|---|---|---|---|---|---|---|
| **Immich** | 4: server, machine-learning, valkey, postgres [V][immich-compose] | In the server container by default (`api` + `microservices` workers); split via `IMMICH_WORKERS_INCLUDE/EXCLUDE` [V][immich-workers] | BullMQ on Redis/Valkey [V][immich-pkg] | Custom Postgres 14 image with vector extensions, pinned by digest [V][immich-compose] | server container [V][immich-compose] | Built-in + OIDC [V][immich-oauth] | amd64, arm64 [V][immich-req] |
| **Paperless-ngx** | 3: webserver, db, broker (valkey) [V][paperless-compose] | Same container: s6-overlay runs `svc-webserver`, `svc-worker`, `svc-consumer`, `svc-scheduler` [V][paperless-s6] | Celery on Redis/Valkey [V][paperless-compose] | Postgres or MariaDB (SQLite possible) [V][paperless-admin] | webserver container [V][paperless-compose] | Built-in + OIDC via django-allauth [V][paperless-config] | amd64, arm64 [V][dockerhub] |
| **Mealie** | 1 (SQLite) or 2 (+postgres) [V][mealie-pg] | none separate [V][mealie-pg] | in-process [?] | SQLite recommended for 1–20 users, Postgres for many concurrent users [V][mealie-checklist] | same container; split frontend/API images were merged [V][mealie-checklist] | Built-in + OIDC [V][mealie-backend] | amd64, arm64; no 32-bit ARM [V][mealie-checklist] |
| **Tandoor** | app + postgres; nginx bundled *inside* the app image since v2 [V][tandoor-docker] | none separate [?] | — [?] | Postgres [V][tandoor-docker] | nginx inside container [V][tandoor-docker] | Built-in + OIDC (allauth) + LDAP [V][tandoor-config] | amd64, arm64 [V][dockerhub] |
| **Linkwarden** | 3: app, postgres, meilisearch [V][linkwarden-compose] | Same container: `concurrently` runs `next start` + `worker.ts` [V][linkwarden-dockerfile] | in-process worker polling the DB [?] | Postgres [V][linkwarden-compose] | app (Next.js) [V][linkwarden-dockerfile] | Built-in + SSO [?] | [?] (ghcr) |
| **Actual Budget** | 1 [V][actual-compose] | none | — | SQLite files on volume [S] | same container [V][actual-compose] | Server password; OIDC required for multi-user [V][actual-oidc] | amd64, arm64 [V][dockerhub] |
| **Firefly III** | 3: app, mariadb, cron (alpine + wget hitting a cron URL) [V][firefly-compose] | cron container calls the app's cron endpoint [V][firefly-compose] | — | MariaDB (default compose) [V][firefly-compose] | app | Built-in or `REMOTE_USER` header from an auth proxy; no native OIDC [V][firefly-auth] | amd64, arm64 [V][dockerhub] |
| **Jellyfin** | 1 [V][jellyfin-container] | in-process | in-process | SQLite (`jellyfin.db`) [V][jellyfin-backup] | same container | Built-in (SSO via plugins) [?] | amd64, arm64 [V][dockerhub] |
| **Vaultwarden** | 1 [V][vaultwarden-readme] | in-process | — | SQLite default; MySQL/Postgres via `DATABASE_URL` [V][vaultwarden-env] | bundled web vault [V][vaultwarden-readme] | Built-in; SSO/OIDC opt-in (`SSO_ENABLED`) [V][vaultwarden-env] | amd64, arm64, arm [V][dockerhub] |
| **Nextcloud AIO** | Mastercontainer orchestrates ~5–10 containers via the Docker socket (Postgres, Redis, Imaginary, Talk, …) [V][nextcloud-aio] | separate containers | Redis (cache/locking) [V][nextcloud-aio] | Postgres [V][nextcloud-aio] | Apache container | Built-in + apps | [?] |
| **authentik** | 3: postgresql, server, worker (same image, `command: server`/`worker`) [V][authentik-compose] | separate container, same image [V][authentik-compose] | **Postgres only; Redis removed in 2025.10** [V][authentik-2025-10][authentik-blog] | Postgres [V][authentik-compose] | server | is an IdP | multi-arch [?] |
| **wger** | 7: web, nginx, db, cache (redis), celery_worker, celery_beat, powersync [V][wger-compose] | separate containers, same image (`/start-worker`, `/start-beat`) [V][wger-compose] | Celery on Redis [V][wger-compose] | Postgres [V][wger-compose] | nginx container [V][wger-compose] | Built-in [?] | amd64, arm64 [V][dockerhub] |
| **Ghostfolio** | 3: app, postgres, redis [V][ghostfolio-compose] | in-process | Bull on Redis [V][ghostfolio-pkg] | Postgres (Prisma) [V][ghostfolio-readme] | app | Token + Google; OIDC experimental [V][ghostfolio-readme] | amd64, arm/v7, arm64 [V][ghostfolio-readme] |
| **Dawarich** | 4: app, sidekiq, redis, postgis [V][dawarich-compose] | separate container, same image (`sidekiq`) [V][dawarich-compose] | Sidekiq on Redis [V][dawarich-compose] | PostGIS [V][dawarich-compose] | app (Rails) | Built-in [?] | amd64, arm, arm64 [V][dockerhub] |
| **OpenDiving** (dive log) | 7: caddy, web, api, worker, admin_init, db, redis [V][opendiving-compose] | separate container, API image with `arq` command [V][opendiving-compose] | arq on Redis [V][opendiving-api] | Postgres 18 [V][opendiving-compose] | separate `web` image behind bundled Caddy [V][opendiving-compose] | Passwordless: e-mail link/code, Google, passkeys; OpenAPI at `/docs` [V][opendiving-api] | amd64, arm64 [V][opendiving-readme] |
| **divetracx** (dive log) | app + Postgres 18 + Hodor auth proxy [V][divetracx-deploy] | none (imports run in server process / CLI) [V][divetracx-readme] | — | Postgres (Drizzle, committed migrations) [V][divetracx-readme] | app (TanStack Start) | **Single-user**; auth delegated to proxy [V][divetracx-deploy] | [?] |

### Packaging patterns

- **One app image is the norm.** Every project above ships one application image that
  contains the web client; the split frontend/backend pattern was abandoned by Mealie
  [V][mealie-checklist], and only OpenDiving (separate `web` image) and wger (separate
  nginx) still ship a separate web container [V][opendiving-compose][wger-compose].
- **Worker = same image, two variants.** (a) separate service with a different `command`:
  authentik, Dawarich, wger, OpenDiving [V][authentik-compose][dawarich-compose][wger-compose][opendiving-compose];
  (b) worker inside the app container by default, splittable by env var or process
  supervisor: Immich, Paperless-ngx, Linkwarden [V][immich-workers][paperless-s6][linkwarden-dockerfile].
  No project ships a separately built worker image.
- **Redis is the most common queue broker** (Immich, Paperless, wger, Ghostfolio, Dawarich,
  OpenDiving), but the trend is away from it: authentik removed Redis entirely in 2025.10,
  citing "one fewer piece to manage" and Redis' 2024 licence change; trade-offs were ~50 %
  more Postgres connections and slightly higher latency for WebSocket/RAC traffic
  [V][authentik-2025-10][authentik-blog]. BullMQ v6 (2026) added a PostgreSQL backend
  because "running [Redis] means one more service to deploy, secure and monitor" [V][bullmq-v6].
- **Reverse proxy/TLS**: most leave it to the operator (Immich, Paperless, Mealie,
  Ghostfolio, authentik, Actual, Dawarich) [V][immich-compose][paperless-compose][mealie-pg][ghostfolio-compose][authentik-compose][actual-compose][dawarich-compose];
  OpenDiving bundles Caddy with automatic certificates but documents "bring your own"
  [V][opendiving-readme]. Vaultwarden's web vault needs HTTPS (Web Crypto secure context)
  [V][vaultwarden-readme]. Upload limits of proxies bite: Tandoor warns that jwilder's
  nginx-proxy limits uploads to 1 MB by default [V][tandoor-docker].
- **Config via env vars / `.env`** is universal [V][immich-env][ghostfolio-readme][dawarich-compose];
  `_FILE` variants for secrets exist in some (e.g. Tandoor `AUTH_LDAP_BIND_PASSWORD_FILE`)
  [V][tandoor-config]. Fail-fast on missing secrets via `${VAR:?msg}` (authentik, Ghostfolio)
  [V][authentik-compose][ghostfolio-compose].
- **Healthchecks**: app health endpoints (`/api/v1/health` Ghostfolio and Dawarich,
  `/health` + `/health/ready` that checks DB and Redis in OpenDiving), `pg_isready` for
  Postgres, `depends_on: condition: service_healthy` [V][ghostfolio-compose][dawarich-compose][opendiving-api][authentik-compose].
- **Hardening** in compose: Ghostfolio uses `cap_drop: ALL` and `no-new-privileges` [V][ghostfolio-compose].
  authentik's worker mounts the Docker socket for outposts, which users question [V][authentik-compose][authentik-18343].
- **Multi-arch**: every image checked publishes `amd64` + `arm64`; some add 32-bit `arm`
  (Vaultwarden, Dawarich, Ghostfolio); Mealie explicitly dropped 32-bit ARM [V][dockerhub][mealie-checklist].

### Operations

- **Migrations run automatically on start** in Immich ("Immich will make some changes to
  the DB during startup") [V][immich-upgrade], Paperless (`init-migrations` s6 stage)
  [V][paperless-s6], Linkwarden (`prisma migrate deploy` before start) [V][linkwarden-dockerfile],
  OpenDiving [V][opendiving-readme]. divetracx requires a manual migrate step [V][divetracx-deploy].
  Upgrade = `docker compose pull && docker compose up -d` (Immich, Paperless, OpenDiving)
  [V][immich-upgrade][paperless-admin][opendiving-readme].
- **Version pinning**: Mealie advises pinning `vX.Y.Z` over `latest` and reading release notes
  [V][mealie-pg]; authentik's compose pins a tag (2026.8.3) [V][authentik-compose]; Immich
  uses a `release` tag + `IMMICH_VERSION` and pins Postgres/Valkey by digest; breaking
  changes only in major versions [V][immich-compose][immich-upgrade]. OpenDiving pins
  third-party images by digest [V][opendiving-compose].
- **PostgreSQL major upgrades are the recurring pain point.** The official image has no
  in-place upgrade; the issue is open since 2014 and pinned [V][pg-issue-37]. Mealie and
  Paperless point users to manual dump/restore or `pg_upgrade` [V][mealie-pg][paperless-admin].
  Since Postgres 18 the image's `PGDATA` is `/var/lib/postgresql/18/docker` and the volume
  should be mounted at `/var/lib/postgresql` (enables `pg_upgrade --link`) [V][pg-docker-docs];
  old-style mounts at `/var/lib/postgresql/data` are a known trap [S][pg18-volume].
- **Backups**: Immich creates scheduled DB dumps itself into the upload volume (default daily,
  keep 14) and states they are useless without the files [V][immich-backup]. Nextcloud AIO
  ships BorgBackup [V][nextcloud-aio]. Paperless offers a document exporter [V][paperless-admin].
  OpenDiving and divetracx document `pg_dump` + file volume [V][opendiving-readme][divetracx-deploy].

### Resource footprint

- Immich needs ≥ 6 GB RAM (4 GB without ML), Postgres ≥ 2 GB under limits [V][immich-req].
- Mealie recommends a 1000 MB memory limit because Python over-allocates at idle [V][mealie-pg];
  Dawarich defaults to `cpus: 0.50`, 4 GB [V][dawarich-compose].
- Typical entry NAS: Synology DS224+, Celeron J4125, **2 GB RAM** (max 6 GB) [S][ds224].
  A stack that must coexist with other containers on such hardware should idle well under 1 GB [?].

### PostgreSQL as a job queue

- Mature libraries exist for every candidate stack: pg-boss (Node, `SKIP LOCKED`,
  transactional enqueue, LISTEN/NOTIFY) [V][pgboss], Graphile Worker (Node) [V][graphile],
  BullMQ v6 Postgres backend (Node, Python, .NET, Elixir) [V][bullmq-v6], River (Go,
  transactional enqueue) [V][river], Procrastinate (Python) [V][procrastinate],
  Hangfire.PostgreSql (.NET) [V][hangfire-pg], Oban (Elixir) [V][oban], Solid Queue (Rails
  default, `FOR UPDATE SKIP LOCKED`) [V][solidqueue].
- Key benefit: enqueue in the same transaction as the domain write — "jobs are guaranteed
  to be enqueued if their transaction commits" [V][river]. That fits our import flow
  (Original + Import + job in one transaction).
- Limits: MVCC dead tuples and index bloat on high-churn tables; long-running transactions
  hold back vacuum; don't hold the row lock while doing long work [S][brandur][planetscale-queue][ms-pg-queue].
  Throughput: BullMQ's Postgres backend peaks ~9,400 jobs/s vs ~23,000 on Redis [V][bullmq-v6] —
  orders of magnitude above Dive Hub's needs.

### API-first / OpenAPI with web + mobile clients

- Immich generates its TypeScript (web) and Dart (mobile) SDKs from the server's OpenAPI
  spec [V][immich-openapi]. OpenDiving serves interactive OpenAPI docs at `/docs` and
  uses bearer tokens for all clients [V][opendiving-api]; Mealie at `/docs` [V][mealie-api];
  Paperless exposes its schema at `/api/schema/view/` [V][paperless-api].
- Mobile + OIDC needs extra care: Immich documents a workaround for IdPs that reject the
  `app.immich:///oauth-callback` redirect URI [V][immich-oauth].

### Complaints and pitfalls seen

- Redis healthcheck failures blocking the whole stack (Ghostfolio #4061) [V][ghostfolio-4061].
- Complex compose files, exposed DB/Redis ports, bundled nginx clashing with existing proxies (Plane #1019) [V][plane-1019].
- Undocumented Docker-socket mounts and removed services confusing new users (authentik #18343) [V][authentik-18343].
- Postgres major upgrades and the Postgres 18 volume path change [V][pg-issue-37][pg-docker-docs].
- `latest` tags pulling breaking changes [V][mealie-pg].
- Reverse-proxy upload size limits [V][tandoor-docker].

## Implications for ADR 0004

| ADR 0004 item | Verdict | Reasoning |
|---|---|---|
| API-first, one documented HTTP/JSON API for all clients | **Confirm**, make OpenAPI explicit | Matches Immich/OpenDiving/Mealie/Paperless. Generate the web (and later mobile) client SDK from the OpenAPI spec as Immich does. |
| SPA built separately, served as static files by the app image | **Confirm** | One app image is the dominant pattern; Mealie merged its split images. Rejecting a separate nginx container is consistent with practice. |
| Worker = same image, different command | **Confirm, refine** | Used by authentik, Dawarich, wger, OpenDiving. Refine: let the app also run the worker in-process by default (Immich `IMMICH_WORKERS_*`, Paperless, Linkwarden) so the default compose can be 2 services (`app`, `db`) and a separate `worker` service is an opt-in for scaling/isolation. Lower RAM on 2 GB NAS boxes. |
| Job queue in PostgreSQL, no Redis | **Confirm** | Library support is mature in every candidate language; authentik and BullMQ moved this way explicitly to avoid one more service. Choose a maintained library (not hand-rolled), use transactional enqueue, keep job transactions short, prune finished jobs. |
| PostgreSQL only (no SQLite) | **Confirm, with caveat** | Postgres is the choice of every multi-user project here except SQLite-first single-container apps (Actual, Vaultwarden, Mealie default, Jellyfin). The ADR's SQLite argument "concurrent writes from API and worker" weakens if the worker runs in-process; the stronger reasons are multi-user concurrency, JSONB and the queue. Accept the cost: we own the Postgres upgrade story. |
| Files on a mounted volume | **Confirm** | Universal. Optional S3 later (OpenDiving, divetracx support it) — not needed now. |
| Compose with `app`, `worker`, `db` | **Change (minor)** | Default to `app` + `db`; document `worker` as optional (see above). Pin image versions (no `latest` in docs), pin the Postgres major, mount Postgres 18+ at `/var/lib/postgresql`, add healthchecks and `depends_on: service_healthy`, don't publish the DB port. |
| Operator brings reverse proxy/TLS | **Confirm** | Majority practice. Document Caddy/Traefik/NAS examples, required upload size limits (account-export zips) and trusted-proxy settings. HTTPS is needed anyway for passkeys/secure cookies. |
| Built-in accounts, OIDC later | **Confirm** | Built-in + optional OIDC is the norm (Immich, Paperless, Mealie, Tandoor, Vaultwarden, Ghostfolio). Plan token issuance so OIDC fits mobile later (PKCE, app redirect URI). First user = admin, invite-only default (OpenDiving) is a good default. Header/proxy auth (Firefly, divetracx) is an optional extra, not a replacement. |
| Backup = `pg_dump` + file volume | **Confirm, extend** | Consider built-in scheduled DB dumps into the file volume (Immich) so one volume backup covers everything. |
| (missing) migrations on upgrade | **Add** | Apply migrations automatically on start (Immich, Paperless, Linkwarden, OpenDiving), guarded so only one process migrates when app and worker start together (e.g. advisory lock) [?]. |
| (missing) multi-arch images | **Add** | Publish `linux/amd64` + `linux/arm64`; skip 32-bit ARM (Mealie dropped it). |
| (missing) health endpoints | **Add** | Liveness and readiness (DB reachable), as OpenDiving does. |

## Open points

- Target footprint: set a concrete idle-RAM budget for `app` + `db` (e.g. fits a 2 GB NAS) once the stack is chosen.
- Postgres upgrade story: document dump/restore per major, or evaluate tooling such as `pgautoupgrade` [?].
- Whether the in-process worker should be the default or the separate `worker` service (decide with the language/framework ADR).
- OIDC on mobile: redirect URI scheme and token model; revisit when the mobile app type is chosen.
- Reddit sentiment on Redis/container count was not checked directly; GitHub evidence only.

## Sources

[immich-compose]: https://github.com/immich-app/immich/blob/main/docker/docker-compose.yml
[immich-workers]: https://docs.immich.app/administration/jobs-workers
[immich-env]: https://github.com/immich-app/immich/blob/main/docs/docs/install/environment-variables.md
[immich-pkg]: https://github.com/immich-app/immich/blob/main/server/package.json
[immich-oauth]: https://github.com/immich-app/immich/blob/main/docs/docs/administration/oauth.md
[immich-req]: https://github.com/immich-app/immich/blob/main/docs/docs/install/requirements.md
[immich-backup]: https://github.com/immich-app/immich/blob/main/docs/docs/administration/backup-and-restore.md
[immich-upgrade]: https://docs.immich.app/install/upgrading
[immich-openapi]: https://docs.immich.app/developer/open-api
[paperless-compose]: https://github.com/paperless-ngx/paperless-ngx/blob/main/docker/compose/docker-compose.postgres.yml
[paperless-s6]: https://github.com/paperless-ngx/paperless-ngx/tree/main/docker/rootfs/etc/s6-overlay/s6-rc.d
[paperless-config]: https://github.com/paperless-ngx/paperless-ngx/blob/main/docs/configuration.md
[paperless-admin]: https://github.com/paperless-ngx/paperless-ngx/blob/main/docs/administration.md
[paperless-api]: https://github.com/paperless-ngx/paperless-ngx/blob/main/docs/api.md
[mealie-pg]: https://github.com/mealie-recipes/mealie/blob/mealie-next/docs/docs/documentation/getting-started/installation/postgres.md
[mealie-checklist]: https://mealie.io/documentation/getting-started/installation/installation-checklist/
[mealie-backend]: https://github.com/mealie-recipes/mealie/blob/mealie-next/docs/docs/documentation/getting-started/installation/backend-config.md
[mealie-api]: https://github.com/mealie-recipes/mealie/blob/mealie-next/docs/docs/documentation/getting-started/api-usage.md
[tandoor-docker]: https://github.com/TandoorRecipes/recipes/blob/develop/docs/install/docker.md
[tandoor-config]: https://docs.tandoor.dev/system/configuration/
[linkwarden-compose]: https://github.com/linkwarden/linkwarden/blob/main/docker-compose.yml
[linkwarden-dockerfile]: https://github.com/linkwarden/linkwarden/blob/main/Dockerfile
[actual-compose]: https://github.com/actualbudget/actual/blob/master/packages/sync-server/docker-compose.yml
[actual-oidc]: https://github.com/actualbudget/docs/blob/master/docs/config/oauth-auth.md
[firefly-compose]: https://github.com/firefly-iii/docker/blob/main/docker-compose.yml
[firefly-auth]: https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/advanced/authentication.md
[jellyfin-container]: https://github.com/jellyfin/jellyfin.org/blob/master/docs/general/installation/container.md
[jellyfin-backup]: https://github.com/jellyfin/jellyfin.org/blob/master/docs/general/administration/backup-and-restore.md
[vaultwarden-readme]: https://github.com/dani-garcia/vaultwarden/blob/main/README.md
[vaultwarden-env]: https://github.com/dani-garcia/vaultwarden/blob/main/.env.template
[nextcloud-aio]: https://github.com/nextcloud/all-in-one/blob/main/readme.md
[authentik-compose]: https://goauthentik.io/docker-compose.yml
[authentik-2025-10]: https://docs.goauthentik.io/releases/2025.10/
[authentik-blog]: https://goauthentik.io/blog/2025-11-13-we-removed-redis/
[authentik-18343]: https://github.com/goauthentik/authentik/discussions/18343
[wger-compose]: https://github.com/wger-project/docker/blob/master/docker-compose.yml
[ghostfolio-compose]: https://github.com/ghostfolio/ghostfolio/blob/main/docker/docker-compose.yml
[ghostfolio-readme]: https://github.com/ghostfolio/ghostfolio/blob/main/README.md
[ghostfolio-pkg]: https://github.com/ghostfolio/ghostfolio/blob/main/package.json
[ghostfolio-4061]: https://github.com/ghostfolio/ghostfolio/issues/4061
[dawarich-compose]: https://github.com/Freika/dawarich/blob/master/docker/docker-compose.yml
[opendiving-readme]: https://github.com/opendiving/opendiving/blob/main/README.md
[opendiving-compose]: https://github.com/opendiving/opendiving/blob/main/docker-compose.yml
[opendiving-api]: https://github.com/opendiving/opendiving-api/blob/main/README.md
[divetracx-readme]: https://github.com/michidk/divetracx/blob/main/README.md
[divetracx-deploy]: https://github.com/michidk/divetracx/blob/main/docs/deployment.md
[plane-1019]: https://github.com/makeplane/plane/issues/1019
[dockerhub]: https://hub.docker.com/ (architectures read from `/v2/repositories/<repo>/tags/latest`, 2026-10-02)
[pg-issue-37]: https://github.com/docker-library/postgres/issues/37
[pg-docker-docs]: https://github.com/docker-library/docs/blob/master/postgres/content.md
[pg18-volume]: https://rdiachenko.com/posts/databases/postgresql/postgres-18-docker-silently-ignores-your-named-volume/
[ds224]: https://global.download.synology.com/download/Document/Hardware/DataSheet/DiskStation/24-year/DS224+/enu/DS224+_Data_Sheet_enu.pdf
[pgboss]: https://github.com/timgit/pg-boss
[graphile]: https://github.com/graphile/worker
[bullmq-v6]: https://bullmq.io/news/260927/bullmq-v6-postgresql/
[river]: https://github.com/riverqueue/river
[procrastinate]: https://github.com/procrastinate-org/procrastinate
[hangfire-pg]: https://github.com/hangfire-postgres/Hangfire.PostgreSql
[oban]: https://github.com/oban-bg/oban
[solidqueue]: https://github.com/rails/solid_queue
[brandur]: https://brandur.org/postgres-queues
[planetscale-queue]: https://planetscale.com/blog/keeping-a-postgres-queue-healthy
[ms-pg-queue]: https://techcommunity.microsoft.com/blog/adforpostgresql/potential-consequences-of-using-postgres-as-a-job-queue/4514332

- Immich: [compose][immich-compose], [workers][immich-workers], [env vars][immich-env], [server package.json][immich-pkg], [OAuth][immich-oauth], [requirements][immich-req], [backup][immich-backup], [upgrading][immich-upgrade], [OpenAPI][immich-openapi]
- Paperless-ngx: [compose][paperless-compose], [s6 services][paperless-s6], [configuration][paperless-config], [administration][paperless-admin], [API][paperless-api]
- Mealie: [Postgres install][mealie-pg], [checklist][mealie-checklist], [backend config][mealie-backend], [API usage][mealie-api]
- Tandoor: [Docker install][tandoor-docker], [configuration][tandoor-config]
- Linkwarden: [compose][linkwarden-compose], [Dockerfile][linkwarden-dockerfile]
- Actual Budget: [compose][actual-compose], [OpenID][actual-oidc]
- Firefly III: [compose][firefly-compose], [authentication][firefly-auth]
- Jellyfin: [container install][jellyfin-container], [backup][jellyfin-backup]
- Vaultwarden: [README][vaultwarden-readme], [.env.template][vaultwarden-env]
- Nextcloud: [All-in-One README][nextcloud-aio]
- authentik: [compose][authentik-compose], [2025.10 release][authentik-2025-10], [We removed Redis][authentik-blog], [discussion #18343][authentik-18343]
- wger: [compose][wger-compose]
- Ghostfolio: [compose][ghostfolio-compose], [README][ghostfolio-readme], [package.json][ghostfolio-pkg], [issue #4061][ghostfolio-4061]
- Dawarich: [compose][dawarich-compose]
- OpenDiving: [README][opendiving-readme], [compose][opendiving-compose], [API README][opendiving-api]
- divetracx: [README][divetracx-readme], [deployment][divetracx-deploy]
- Plane: [issue #1019][plane-1019]
- Docker Hub: [image architectures][dockerhub]
- PostgreSQL image: [issue #37][pg-issue-37], [image docs][pg-docker-docs], [PG 18 volume trap][pg18-volume]
- Hardware: [Synology DS224+ data sheet][ds224]
- Queues: [pg-boss][pgboss], [Graphile Worker][graphile], [BullMQ v6][bullmq-v6], [River][river], [Procrastinate][procrastinate], [Hangfire.PostgreSql][hangfire-pg], [Oban][oban], [Solid Queue][solidqueue], [Brandur: queues and MVCC][brandur], [PlanetScale: healthy Postgres queue][planetscale-queue], [Microsoft: Postgres as job queue][ms-pg-queue]
