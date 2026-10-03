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

Built-in accounts (e-mail + password) with Better Auth ([ADR 0011](../decisions/0011-better-auth.md)),
invite-only, first admin from a setup token ([ADR 0012](../decisions/0012-invitations-and-admin-bootstrap.md)).
Sessions are stored in the database. The web client uses an `HttpOnly`, `SameSite=Lax` cookie on the same origin;
mobile will use the bearer plugin or the Expo integration. OIDC (Authentik, Authelia, Keycloak, …) is planned for later.

| Setting | Meaning |
|---|---|
| `DIVEHUB_BASE_URL` | Public URL users open (required in production). With https, cookies are `Secure` and use the `__Secure-` prefix. Invitation links point here. |
| `DIVEHUB_TRUSTED_PROXIES` | Comma-separated IPs/CIDRs of the reverse proxy. Only their `X-Forwarded-For` counts for the client IP (rate limiting, session records). |
| `DIVEHUB_AUTH_SECRET` | Cookie signing secret; generated into the data directory when unset. |

## Open questions

- **Libraries** within the TypeScript stack ([ADR 0005](../decisions/0005-typescript-stack.md)):
  HTTP framework, DB access, queue, auth. FIT parser: [ADR 0006](../decisions/0006-license-apache-2-and-fit-parser.md).
- **How files reach the API:** single file, Garmin "Export Original" zip, full account
  export zip; resumable uploads for large account exports?
- **Sample storage layout** in PostgreSQL (row per sample vs. arrays/compressed blocks per Recording).
- **Notifications** from worker to client (polling vs. server-sent events).

## Implementation status

**Slice 1 (2026-10-02): Garmin FIT import → Dive → depth profile.** See the [development guide](../development.md).

Implemented: pnpm monorepo (`apps/server`, `apps/web`, `packages/api-client`); upload of FIT
files and zips (nested zips, size/ratio/depth limits); Originals stored by hash per User; Import
with its job enqueued in the same transaction; worker in-process; Devices attributed to Divers;
Recording key for re-imports; auto-attach / new Dive / Duplicate candidate; Revisions for
import-driven changes; Sample series as arrays; OpenAPI-generated client; React logbook with
uPlot depth profile; Docker image and Compose files.

Deliberate simplifications, to revisit:
- **Sample series:** each channel stores its own time offsets (simpler than a shared time axis
  for dense channels, at roughly double the storage for time).
- **No Overrides, Conflicts or Duplicate-candidate resolution UI yet**; Duplicate candidates are
  only recorded.
- **Parsed FIT values** are checked with small type guards, not TypeBox schemas (ADR 0009 intent).
- **Uploads** are plain multipart (limit `DIVEHUB_MAX_UPLOAD_MB`, default 512); resumable uploads
  for multi-GB account exports come later.

**Slice 2 (2026-10-03): sign-in** ([ADR 0011](../decisions/0011-better-auth.md), [ADR 0012](../decisions/0012-invitations-and-admin-bootstrap.md)).

Implemented:
- Better Auth 1.7.7 at `/api/auth/*`: Drizzle adapter, tables in `apps/server/src/db/auth-schema.ts`, uuid ids.
- argon2id password hashing; public sign-up off.
- First admin via setup token; Invitations as copy links.
- Every User gets their own Diver.
- `user_id` columns are uuid foreign keys.
- Every logbook route requires a session and is scoped to the signed-in User.
- Imports only write to Divers the User manages: a file from another User's Device is skipped.
- Rate limiting backed by the database in production.
- Client IP taken only from trusted proxies.
- Origin/CSRF checks on in every environment; admins can't impersonate.
- Web client: sign-in, setup, accept-invitation and admin pages; sign-out.

Migration `0001_auth` deletes slice-1 development data (`user_id = 'dev'`).

Deliberate simplifications, to revisit:
- **No 2FA** (later slice, ADR 0012).
- **Recording keys** stay globally unique. If two Users each import a Recording without a Device
  that starts in the same second, the second Import is reported as failed.

**Slice 3 (2026-10-03): account basics** ([ADR 0013](../decisions/0013-account-management.md)).

Implemented:
- Password reset links issued by admins (single-use, 24 h, end all sessions).
- Changing one's own password; listing and ending one's own sessions (never returning tokens).
- Admins change roles, disable/enable Users, sign Users out everywhere, and delete Users with
  everything only they own, including stored files no one else shares.
- There is always one enabled admin (row locks against simultaneous demotion).
- Only `sign-in/email`, `sign-out`, `get-session` and `change-password` of Better Auth are reachable
  over HTTP; they are described in our OpenAPI document.
- Web client: account page (password, sessions), reset page, admin actions per User.

Deliberate simplifications, to revisit:
- **Deleting** keeps Divers someone else also manages; this needs revisiting with Diver sharing.
- **No audit log** of admin actions beyond the server log ("user deleted").

**Slice 4 (2026-10-03): UI foundation** ([ADR 0014](../decisions/0014-design-system-and-localization.md), [design system](design-system.md)).

Implemented:
- Design tokens (light and dark, contrast measured to WCAG 2.2 AA) and a component set on React Aria
  Components; every page moved onto them. IBM Plex Sans bundled; the depth profile is filled with a depth gradient.
- English and German with i18next and typed keys; language from the User's preference or the browser.
- Every API refusal carries a `code`; Import outcomes a `reason`, failed Imports an `errorCode`;
  server errors no longer show internals.
- Per-User display preferences (`user_preference`: language, metric/imperial) with Intl-based formatting.
- Lazy-loaded pages (dive detail, account, admin); error boundaries around the page and the chart.
- A missing static file answers 404 instead of the web client's `index.html`.

Deliberate simplifications, to revisit:
- **Device values** such as water type ("salt") are shown as recorded, untranslated.
- **No browser test suite yet:** layout was checked by screenshots (headless Edge); Playwright is pending.

**Slice 5 (2026-10-03): keeping a Dive** ([ADR 0015](../decisions/0015-overrides-vocabulary-and-browser-tests.md)).

Implemented:
- Device values in our own vocabulary (water type, dive mode, deco model, gas circuit), mapped from
  FIT and translated; unmapped values kept as "other values from the device"; stored summaries migrated.
- Edit mode on the dive page: values become Overrides (marked "edited", resettable to the recording's
  value), notes; one Revision per save; optimistic locking with a reload offer on conflict.
- Choosing the Primary recording; values without Override follow it, also on re-import.
- The Dive's history (its Revisions and its Recordings'), translated, in the User's units.
- New components: NumberField (locale-aware), Select, TextArea, DateTimeField, badge.
- Browser tests with Playwright (6 flows, English and German, feet and a decimal comma).
- Fixed: nullable request fields were coerced (`null` → `0`/`""`).
- The server reports migration files that changed after a database applied them.

Deliberate simplifications, to revisit:
- **Events** (gas switches, alarms) are recorded but not shown yet; they need the same vocabulary.
- **Device data** shows the selected Recording's summary; the Dive's cylinders and gases as their
  own entities come later.
