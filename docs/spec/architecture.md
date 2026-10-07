---
title: System architecture
summary: Components of Dive Hub, how they talk to each other and how they are deployed.
status: draft
date: 2026-10-06
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

An import from a Provider (slice 15, [ADR 0030](../decisions/0030-importing-dives-from-providers.md)) runs the same
way: the API reads the account's dives once when the User starts it, stores one JSON Original per dive, creates the
Import and queues the same job; the worker never calls the Provider.

## Deployment

Docker Compose, two services by default (amd64 + arm64 images, pinned versions, healthchecks):

| Service | Image | Notes |
|---|---|---|
| `app` | `divehub` | API + web client + worker (in-process by default); exposes one HTTP port |
| `worker` | `divehub` | optional: same image, worker command, when the in-process worker is switched off |
| `db` | `postgres` | pinned major version; data volume; port not published |

Migrations run automatically on start (one process at a time). Liveness and readiness endpoints.

Volumes: database data, file storage. TLS and the reverse proxy are the operator's
responsibility (Caddy, Traefik, NAS proxy). We document a sample setup. The proxy's timeout should be at least
2 minutes: sending a Dive to a Provider may wait up to 30 s for its turn and then call the Provider several times.
Several app processes on one database need clocks that agree (NTP), because the Provider leases use the app's time
([ADR 0027](../decisions/0027-providers-as-adapters.md#downsides-accepted-owner-2026-10-05)).
Backup = `pg_dump` + the file volume.

## Authentication

Built-in accounts (e-mail + password) with Better Auth ([ADR 0011](../decisions/0011-better-auth.md)),
invite-only, first admin from a setup token ([ADR 0012](../decisions/0012-invitations-and-admin-bootstrap.md)).
Sessions are stored in the database. The web client uses an `HttpOnly`, `SameSite=Lax` cookie on the same origin;
mobile will use the bearer plugin or the Expo integration. OIDC (Authentik, Authelia, Keycloak, …) is planned for later.
LLM clients reach the MCP endpoint `/mcp` with the key of an AI access instead of a session ([ADR 0035](../decisions/0035-mcp-connector.md)): off until an admin
switches it on; behind a reverse proxy, `/mcp` must be forwarded like `/api`.

| Setting | Meaning |
|---|---|
| `DIVEHUB_BASE_URL` | Public URL users open (required in production). With https, cookies are `Secure` and use the `__Secure-` prefix. Invitation links point here. |
| `DIVEHUB_TRUSTED_PROXIES` | Comma-separated IPs/CIDRs of the reverse proxy. Only their `X-Forwarded-For` counts for the client IP (rate limiting, session records). |
| `DIVEHUB_AUTH_SECRET` | Cookie signing secret; generated into the data directory when unset. |
| `DIVEHUB_CONTACT` | Optional: the operator's e-mail address or URL, added to the User-Agent of Site imports ([below](#dive-site-imports-and-licenses)) and of calls to SSI. |
| `DIVEHUB_ENCRYPTION_KEY` | Optional: 32 bytes as base64 (`openssl rand -base64 32`). Encrypts what Dive Hub keeps for Targets (SSI tokens and passwords, [ADR 0024](../decisions/0024-ssi-target-via-app-api.md)). Without it, Users can't choose "Keep me signed in" for SSI, and tokens are stored as they are. Keep it apart from database backups; losing it means every User signs in to SSI again. A wrong length stops the server at start. |
| `DIVEHUB_SSI_URL` | Only for tests: another endpoint for SSI's app API. |
| `DIVEHUB_OVERPASS_URL`, `DIVEHUB_WIKIDATA_SPARQL_URL` | Optional: other endpoints for Site imports (default `overpass-api.de`, `query.wikidata.org`). |
| `DIVEHUB_SSI_SITES_URL` | Optional: another address for SSI's site list (default `api.divessi.com/app/APP_CACHE_SITES.zip`, ADR 0025). |

## Dive site imports and licenses

Admins can import Dive sites from Wikidata, OpenStreetMap ([ADR 0021](../decisions/0021-site-external-ids-and-import.md))
and SSI ([ADR 0025](../decisions/0025-ssi-site-import-and-site-water-type.md)).
The image contains no site data. Each operator imports for their own instance, so the license obligations
are the operator's. (The image does contain **time-zone boundaries**, geo-tz's data built from OpenStreetMap and so
under the ODbL, unchanged, with the attribution in `NOTICE`; Dive Hub only looks up offsets in it and publishes nothing
derived from it, [ADR 0030](../decisions/0030-importing-dives-from-providers.md).)

- **Wikidata** is CC0: no conditions.
- **OpenStreetMap** is under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
  - Dive Hub shows the Attribution ("© OpenStreetMap contributors", linked to
    [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)) on every site with OSM data and on the
    Dive sites page.
  - Mixing OSM sites with your own makes the site table a derivative database. While the instance is
    private (invite-only family, club or dive center), it is not used publicly. If you make the site list
    available to the public, you must offer that site table under ODbL as well.
  - Users' own dive data is not part of it.
- **SSI** ([ADR 0024](../decisions/0024-ssi-target-via-app-api.md), [ADR 0025](../decisions/0025-ssi-site-import-and-site-water-type.md))
  publishes its site list without any licence, and in the EU it is protected as a database: copying large parts of it
  can infringe SSI's rights. Unlike OSM, there are no conditions to meet that would make copying it allowed.
  - Importing it is your decision and your risk. The admin confirms an explanation before every SSI import, and the
    Site import records when (`ssi_confirmed_at`).
  - **Sites from Users' SSI dives** ([ADR 0030](../decisions/0030-importing-dives-from-providers.md)): when Users import
    their dives, a dive's site that isn't here is made from their logbook's entry (name, position, country, ID) only
    after an admin allowed it on the Admin page, with the same explanation; who and when is kept. Without it, imports
    only give sites already here the SSI ID.
  - To keep the copy small, use **"Only fill dive sites that are already here"**: it adds SSI IDs and water types to
    your sites and creates none. Hand-made sites are never changed; their pages offer SSI's data, and a User decides.
  - Dive Hub never stores SSI's moderation comments (they contain submitters' IP addresses), private sites, statistics
    or wildlife. Sites show "From SSI" without a link (SSI has no page per site).
  - The file is downloaded at run time without signing in to SSI; nothing of it is in the image or the repository.
    `DIVEHUB_SSI_SITES_URL` points elsewhere if needed.
- **Fair use of the public services:**
  - An import makes one query per Source and run, with a User-Agent naming Dive Hub. Set
    `DIVEHUB_CONTACT` (an e-mail address or URL) so the services can reach you, as Wikimedia's User-Agent policy asks.
  - Overpass asks commercial users to use their own or a paid server: point `DIVEHUB_OVERPASS_URL` at it.
    `DIVEHUB_WIKIDATA_SPARQL_URL` does the same for the query service.

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

**Slice 6 (2026-10-03): deciding and assigning** ([ADR 0016](../decisions/0016-recording-decisions-and-divers.md)).

Implemented:
- "Needs your decision" on the logbook: add a Duplicate candidate to a Dive, make it a new Dive,
  discard (kept, reopenable).
- Splitting a Recording off into its own Dive; moving a Dive to another Diver.
- Divers page: the User's Divers (add, rename, delete when empty) and Devices (assign to a Diver
  for future Imports).
- Logbook: Diver column and filter when a User keeps several Divers.
- Recordings named by their Device; the e2e server runs the background worker.

Deliberate simplifications, to revisit:
- **Sharing a Diver** between Users comes with Participants and Buddy suggestions.
- **Device assignment** has no dates; lending is handled by moving single Dives.

**Slice 7 (2026-10-04): Dive sites** ([ADR 0020](../decisions/0020-dive-sites.md)).

Implemented:
- Dive sites shared by every User: `/api/dive-sites` (list by name or near a position, one, create, edit with
  version, delete). Any User edits (Revisions on `dive_site`); the creator or an admin deletes while no Dive is there.
- Entry and exit positions on Recordings from FIT (`session.start_position_*`, `end_position_*`); a Dive shows
  its Primary recording's (exit, else entry). Older Recordings are backfilled from their Originals by the
  `backfill_positions` worker job, queued once per start (job key).
- An Import links a new Dive to the only site within 200 m (Revision cause `auto-site`).
- A Dive's site in `PATCH /api/dives/:id` (`siteId`, under the Dive's version); the logbook shows it, filters
  by it (`siteId`, `#/?site=`) and searches its name.
- Nearby search without PostGIS: bounding box plus haversine in SQL (`src/sites/site-service.ts`).
- Web client: Dive sites page, site page (edit, delete), choosing or creating a site on the dive page,
  positions with an "Open in maps" link (openstreetmap.org), countries named through `Intl.DisplayNames`.

Found in the screenshot review and fixed:
- With a fourth section the phone navigation, a sideways-scrolling strip, hid "Admin" at 320 px; it wraps now.
- A form's unsaved-changes guard stayed on after saving, so moving to the new site's page asked first;
  `releaseLeaveGuard()` (`lib/leave-guard.ts`) ends it once saved.
- Removing a form message on blur moved the buttons under a pressing pointer; such messages now change only on submit.

Deliberate simplifications, to revisit:
- **No map**, no merging of duplicate sites, no aliases, entry points or external IDs yet.
- **A Dive's position** isn't an Override; a hand-logged dive gets one only through its site.
- **Sites created later** aren't linked to earlier Dives nearby; the dive page offers them.

**Slice 8 (2026-10-04): external site IDs and the Site import** ([ADR 0021](../decisions/0021-site-external-ids-and-import.md)).

Implemented:
- **External IDs** (`dive_site_external_id`): unique per Source, at most one per Source and site. Each is either
  data-providing (it keeps what its Source delivered last) or a reference. The Sources (`osm`, `wikidata`, `ssi`)
  and their license, Attribution and link pattern are defined in `src/sites/sources.ts`.
- **Dive sites:**
  - maximum depth (`max_depth_m`);
  - an SSI site ID in the site form (digits, or SSI's "site:3314");
  - `externalIds` with links and Attribution in the API;
  - the site's history (`GET /api/dive-sites/:id/revisions`), naming only the signed-in User.
- **Site import** for admins (`/api/admin/site-imports`, page `#/admin/site-imports`):
  - Wikidata and/or OpenStreetMap, by country, box or everywhere;
  - OSM only after the ODbL explanation is confirmed;
  - one at a time, run by the `import_dive_sites` worker job with progress, counts and findings.
- **Planning without the database** (`src/sites/import/import-plan.ts`):
  - matching by own ID, then the link between the Sources, then 100 m plus the same name;
  - a per-field 3-way merge with OSM before Wikidata;
  - references on hand-made sites.
- **Overpass and Wikidata adapters** behind `SiteSourceAdapter`. Requests go out with a User-Agent, one at a
  time, and retry once after 429/406/503/504. An HTML answer counts as unavailable. Tests and the browser tests'
  server replay recorded answers (`test/fixtures/site-sources/`).
- **Web client:**
  - the site page says where the site comes from ("From OpenStreetMap: node/…" with "© OpenStreetMap contributors");
  - the Dive sites page carries the Attribution when it lists OSM data;
  - an admin shortcut to the import.

Found while building and in the screenshot review, and fixed:
- The ODbL explanation was a `Notice`, which announces its text, so screen readers read it out on page load.
  Standing terms to confirm are now a tinted box (`.terms`) that doesn't announce itself.
- A checkbox with a label that wraps (the ODbL confirmation at 320–390 px) sat at the middle of the label.
  Checkboxes and radios now align with the label's first line, and one-line choices keep their 2.5rem height.
- The site history listed fields in PostgreSQL's jsonb key order. It now follows the form's order.
- Planning a worldwide import took 5 s (name normalising for every pair). A latitude check first and cached
  names bring it to about 0.3 s for 1,750 objects against 1,700 sites.

Deliberate simplifications, to revisit:
- **A Site import saves in batches of 50.** A failure while saving (not while fetching) leaves the batches
  before it saved, and the import says it failed.
- **OSM↔Wikidata matches are rare in today's data.** No cross-link connects the two dive-site sets, and one pair
  meets the 100 m + name rule
  ([research](../research/2026-10-04-dive-site-sources.md#follow-up-while-building-the-import-2026-10-04)).
- **No ODbL export** of the site table for public instances (ADR 0021).

**Slice 9 (2026-10-04): merging sites, paging the site list, the client contract** ([ADR 0022](../decisions/0022-merging-sites-and-site-list-paging.md)).

Implemented:
- **Merging** (`POST /api/dive-sites/:id/merge`, any User, both versions):
  - The kept site's values stay and its gaps are filled.
  - Every User's Dives move, each with a Revision by the system (`site-merge`).
  - External IDs move where the kept site has none from that Source.
  - The merged site gets `merged_into` (and `deleted_at`), and earlier merges are re-pointed.
  - Both sites' histories record it (`merge`).
  - Site imports skip IDs on merged sites (`skippedMerged`).
- **Site page:** a "Close by" panel (sites within 200 m) with "Merge into this site", and a dialog that says
  what happens. A merged site's link leads to the kept one.
- **`GET /api/dive-sites`** returns `{ sites, total }` with `limit`/`offset`, `sort` (`name`, `country`,
  `diveCount`), `order`, `country`, `mine`. The Dive sites page has search, a country filter, "only sites with
  my dives", sortable columns and a pager, kept in the address (`lib/sites-list.ts`).
- **The client contract** ([clients.md](clients.md)), and a rule in AGENTS.md to keep it current.

Found in the screenshot review and fixed:
- The filter row's fields stood out of line (the search field's hint pushed the others down). It now aligns
  at the top, with the checkbox level with the inputs.
- On phones, a short country fitted beside a short site name, so the second line began with its "·". In a
  stacked table without a leading column, the name now takes the whole first line.
- The review capture waited for the invitation notice's text, which the live region also holds. It now waits
  for the Copy button.

Found while writing the client contract and fixed (rules only the web client kept):
- Changing a password now ends the other sessions on the server, whatever `revokeOtherSessions` says
  (`hooks.before` in `src/auth/auth.ts`, ADR 0013).
- Import failures reach clients as codes only. The parser's own words (`message`, a failed Import's `error`) left
  the API; the worker logs them.
- Saving a site waited for every site query to refetch before closing the form, which took seconds under load
  (a flaky browser test showed it). The form now closes at once and the lists refresh behind it.

Deliberate simplifications, to revisit:
- **No undo** for a merge (ADR 0022), and no instance-wide duplicate scan; duplicates are found where they're seen.

**Slice 10 (2026-10-04): sending Dives to SSI** ([ADR 0024](../decisions/0024-ssi-target-via-app-api.md), [SSI app API](../references/ssi-app-api.md)).

Implemented:
- **Connections** (`connection`): one per User and Diver, for SSI. Connecting signs in once and keeps SSI's token,
  and the password only when the User chooses "Keep me signed in". Both are encrypted with `DIVEHUB_ENCRYPTION_KEY`
  (AES-256-GCM, bound to the row and purpose; `src/secrets/secret-box.ts`). An expired token is renewed silently with a
  kept password; otherwise the Connection needs the User to sign in again. Disconnecting deletes both.
  Routes: `/api/connections/ssi` (list, connect, sign in again, disconnect).
- **Diver External IDs** (`diver_external_id`): the SSI account (`mid`) of the connected Diver, unique per Source.
- **Pushes** (`push`): create, update, link, delete, with SSI's dive ID and number, our reference
  (`divehub-<Dive id>`), the record sent (without samples), a fingerprint and the read-back differences.
  "Outdated" is worked out from the fingerprint, not stored. Routes: `/api/dives/{id}/ssi` (state, send, delete) and
  `…/ssi/sites` (sites of the User's SSI logbook, nearest first).
- **Sending:** reads the SSI logbook; updates the SSI dive the Dive has, or offers a dive at the same time (±2 min)
  before creating; creates with SSI's next number, the Dive's summary and the profile on SSI's 5 s grid; reads back.
  One action per Dive at a time (`ssi_busy`).
- **SSI client** (`src/ssi/ssi-client.ts`): never logs or returns a URL, since SSI takes the password and token in the
  query string. Tests and the browser tests' server use an in-memory SSI (`test/fake-ssi.ts`).
- **Web client:** an SSI panel on the account page (connect with the choice, sign in again, disconnect) and on the dive
  page (state, choosing the SSI site, send, update, delete in SSI, the history of sending).
- `test/fixtures/ssi/round-trip.ts`: the owner's checks against the real SSI.

Deliberate simplifications, to revisit:
- **Sending runs in the request** (two logbook reads and a save, seconds), not as a worker job.
- **One process:** the "one action per Dive" guard lives in memory.
- **Not sent yet:** conditions other than water type, tank and pressures, buddies, gear, photos. QR payload, the SSI
  site import and an import from SSI come later (ADR 0024).
- **A Diver's External ID** is set only by connecting; a clash with another Diver is refused (`ssi_account_taken`)
  instead of proposing to link the two.

**Slice 11 (2026-10-05): SSI site import, offers on hand-made sites, the water type on the Dive site** ([ADR 0025](../decisions/0025-ssi-site-import-and-site-water-type.md), [SSI app API](../references/ssi-app-api.md#the-site-list-app_cache_siteszip)).

Implemented:
- **SSI as a Site import Source** (`src/sites/import/ssi-sites.ts`): one GET of `APP_CACHE_SITES.zip` through the polite
  HTTP client (now also for bytes), unpacked with yauzl, filtered by country (alpha-3 → alpha-2, `src/sites/countries.ts`),
  box or everywhere. Private and deleted sites are left out; only ID, name, position, country and water type are kept.
- **Per-field precedence** (`FIELD_PRECEDENCE` in `site-source.ts`): SSI first for name, country and water type, OSM for
  position.
- **"Only fill"** (`create_sites` on the Site import, count `skippedNew`), the **SSI confirmation** (`ssi_confirmed_at`,
  `ssi_not_confirmed`), the import page's SSI choice and explanation (`.terms`), findings capped at 50 per kind.
- **Offers:** references on hand-made sites keep the Source's values (`imported`; the check constraint now only requires
  values for data-providing IDs). The API returns them as `offered`; `POST /api/dive-sites/:id/adopt` takes them (empty
  fields fill, cause `adopt`). The site page has "Use SSI's data" with a dialog; the import lists the sites (`offer`
  findings, count `offered`).
- **Matching by latitude bands** in the plan (30,000 SSI objects against 3,000 sites plan in about 0.3 s in the test).
- **Water type on the Dive site:** column `dive_site.water_type` (the `water_type` enum, limited to fresh, salt, brackish
  by `dive_site_water_type_ck`), in the site API, form (with its note), page, merge and Revisions. The Dive's column is
  gone (migration 0011) and its Overrides too (custom migration 0012). The Dive's API has `waterType` (the site's) and
  `waterMismatch` (`src/dives/water.ts`); the dive page shows both, and the device data shows "Water setting on the
  computer". SSI sending reads the site's water type.

Found in the browser tests and fixed:
- After a site's water type changed, the dive page showed the old one from its cache. Saving a site now refreshes Dives.
- On creation, the site history said "Description changed" for a site without a description.

Afterwards, from the owner's use: the **site pickers** (a Dive's site, the SSI site) became a search field with the
results under it, updated while typing (`ui/SearchList.tsx` on React Aria's `Autocomplete`, skills `ux-search` and
`ux-selection-controls`): picking a result saves it, no radio buttons and no "Choose" button.

Found by the owner and fixed: searching the Dive sites list or the logbook rebuilt the whole page each time the
address took the words (the page's error boundary was keyed by the route including its query), so the field lost
focus mid-typing. Pages are now keyed by path only; sorting, paging and filters no longer rebuild the page either.
The search field follows the address through `lib/address-search.ts`.

Deliberate simplifications, to revisit:
- **No alias names** (no field); they could later help matching.
- **No depth correction** when the computer was set to other water; only the hint.
- **No Revision on Dives** when their site's water type changes, and none when migration 0012 dropped Overrides.
- **Pushes sent before this slice** show as outdated once (the fingerprint covered the computer's setting).

**Slice 12 (2026-10-05): deleting a Dive, here and in SSI** ([ADR 0026](../decisions/0026-deleting-dives.md)).

Implemented:
- **API:** `DELETE /api/dives/{id}` (`version`, `inSsi`; answers `{ ssi: 'deleted' | 'kept' | null }`),
  `GET /api/dives/deleted` (the newest 100, with `ssi` while still in SSI) and `POST /api/dives/{id}/restore`.
  `DELETE /api/dives/{id}/ssi` and `GET /api/dives/{id}/ssi` also work for a deleted Dive; sending doesn't.
- **Soft delete** (`dive-service.ts`, `remove` and `restore`): one `deleted_at` on the Dive and its Recordings, causes
  `delete` and `restore`. Every read already skipped deleted rows; the Diver's count, the site's `diveCount`/`inUse`,
  search and Duplicate candidates are tested for it.
- **Re-imports** (`import-service.ts`): the same Original, or a Recording key of a deleted Recording, gives `skipped`
  with `deleted_earlier` (other Users: `not_your_diver`). The key stays reserved, so restoring can't clash.
- **SSI:** the route checks the version, then deletes in SSI (`ssi.remove`), then here; an SSI error deletes nothing.
  `ssi.currentOf` tells which Dives are still in SSI (for the answer and the list).
- **Web client:** "Delete dive…" in the dive page's More menu (`DeleteDive.tsx`: one dialog with the SSI question);
  back to the logbook with a notice and Undo, the SSI reminder and "Deleted dives" with Restore and "Delete in SSI"
  (`DeletedDives.tsx`, state shared between the pages in `lib/deletion.ts`). The candidates panel says when a
  candidate's Dives are gone; the history shows "Restored".
- **Tests:** `test/dive-deletion.test.ts` (server, against the fake SSI), `test/deletion.test.ts` (web),
  `e2e/dive-deletion.spec.ts` and ui-quality cases for the dialog and the logbook states, with dive 9 from
  `e2e/fixtures/deletable-computer.fit` (`test/fixtures/write-deletion-fixture.ts`); review captures 32–37.

Found in the screenshot review and fixed: with the list of deleted dives open, the SSI reminder stayed above it with
only "Dismiss" left. It now hides while the list is open, which names each dive still in SSI.

Deliberate simplifications, to revisit:
- **The SSI delete runs in the request**, like sending (slice 10).
- **Deleted Dives stay forever** (with their Originals); there is no purge.
- **No "Keep it in SSI"**: the reminder only goes when the dive is deleted in SSI or restored here; dismissing the
  logbook's notice lasts for the visit.
- **The deleted list isn't paged** (the newest 100).
- **An Import's outcome** still links to a Dive deleted since; the dive page then says it wasn't found.

**Slice 13 (2026-10-05): Providers as adapters** ([ADR 0027](../decisions/0027-providers-as-adapters.md), the
[SSI integration review](../research/2026-10-05-ssi-integration-review.md)). A refactor: Users see no change, except that
Connections made before sign in to SSI once more.

Implemented:
- **The seam** (`src/providers/provider.ts`): a Provider adapter declares its capabilities (sign-in kind; per kind of data
  import/export with operations and how `find` works; delivery `confirmed` or `handed_over`; the site ID it needs; read-back
  fields; notices; the pause between actions) and implements `signIn`, `dives.fingerprint`, `dives.open(context)` (find,
  create, update, remove for one action) and `diveSites.find`. Errors are `ProviderError` with a reason.
- **The generic layer:** `registry.ts` (Providers of the instance, problem codes from reasons), `connection-service.ts`
  (Connections, one sealed `credentials` value, renewal with a kept password, "sign in again"), `push-service.ts` (Pushes,
  the current remote dive, outdated by fingerprint, one action per Dive), `pacing.ts` (one action at a time per Connection
  with the Provider's pause; a second request waits), `outgoing-dive.ts` (the Dive as it leaves Dive Hub), `routes.ts`, and
  `layer.ts` that builds them. `main.ts` registers the SSI adapter only.
- **SSI as an adapter** (`src/providers/ssi/`): `ssi-adapter.ts` (capabilities, sign-in, the logbook read, the ±2 min match,
  SSI's numbers, the site ID), with `ssi-client.ts`, `ssi-record.ts` and `ssi-sites.ts` moved in. No `odin_*` field is read
  outside it. Its fingerprint is unchanged, so earlier Pushes stay up to date.
- **One logbook read per action, shared with the read-back:** the read after a save is kept for two minutes per
  Connection and answers the next find or create; updates and deletes read afresh. Sending two new dives in a row reads
  three times instead of four. **The pause between actions** ADR 0024 promised: 2 s per Connection.
- **API** (replacing the SSI routes): `GET /api/providers`, `GET /api/connections`, `POST /api/connections/{provider}`,
  `POST /api/connections/{id}/sign-in`, `DELETE /api/connections/{id}`, `GET /api/dives/{id}/providers`,
  `GET|POST|DELETE /api/dives/{id}/providers/{provider}`, `…/sites`. `DELETE /api/dives/{id}` takes `alsoAt` and answers
  per Provider (`copy`); `GET /api/dives/deleted` gives `stillAt`. Problem codes `provider_*` name the Provider
  (`provider`, `providerName`).
- **Data:** migration 0013 (hand-written; drizzle-kit asks about renames interactively, so its snapshot was edited and
  `drizzle-kit generate` then reports no changes): `target` → `provider` (text), `account_email` → `account_label`, sealed
  `credentials` instead of `token`/`password` (old ones dropped, Connections `needs_sign_in`), `push.remote_gone`, stored
  `ssi_*` codes renamed.
- **Web client:** `Connections.tsx` (a panel per Provider with sign-in) and `ProviderPanel.tsx` (a panel per Provider that
  takes dives) render from `GET /api/providers`; the delete dialog and the deleted dives ask every Provider a Dive is at.
  Texts: `provider.*` with the Provider's name, and `providers.ssi.*` where SSI is worded itself; every SSI text reads as
  before in both languages (checked by comparing the old and new translations).
- **Tests:** `test/provider-contract.ts` (the contract every adapter passes), run in `provider-contract.test.ts` against the
  fake SSI and the test-only hand-over adapter (`test/fake-handover-provider.ts`: token sign-in, no ID back, never
  registered in production); `provider-layer.test.ts` (the routes with that adapter, pacing, `provider_busy`,
  `provider_unsupported`); `ssi-adapter.test.ts` (logbook reads); `pacing.test.ts`; migration 0013 in `migrations.test.ts`.

What is left of the slice 10–12 simplifications:
- **Sending and deleting at a Provider run in the request**, not as worker jobs (unchanged; with batch sending or importing).
- ~~**One process:** pacing and the Dive lock live in memory.~~ Leases in PostgreSQL since slice 13a.
- **Not sent yet:** conditions other than water type, tanks and pressures, gear, photos; QR payload and importing from
  SSI come later. Buddies are sent since slice 14.
- ~~**A Diver's External ID** is still set only by connecting.~~ Also by hand since slice 14 (a clash names the Diver
  that has it instead of proposing to link).
- Done: the pause between actions, one logbook read per action, deleting through every Provider, no SSI fields outside
  the adapter, the Connection no longer assumes e-mail and password.

Deliberate simplifications, to revisit:
- **OAuth sign-in** is designed (ADR 0027) but not built.
- **Dive site import** keeps its own `SiteSourceAdapter`; only SSI's moved into its Provider folder.
- ~~**With several Providers**, deleting a Dive deletes at them one after another; if a later one fails, the earlier copies
  are already gone while the Dive stays here.~~ Each is checked first since slice 13a; one that still fails is answered per
  Provider.
- **A two-minute-old logbook** may miss a dive logged in SSI's app just before the next create.
- **No browser test for "sign in again"** after an expired SSI sign-in: the browser tests can't expire the fake SSI's
  tokens; the server tests cover it.

**Slice 13a (2026-10-05): provider layer cleanup** ([ADR 0027, amended](../decisions/0027-providers-as-adapters.md#amendment-2026-10-05-leases-in-postgresql-and-deleting-at-several-providers),
the [follow-ups](../research/2026-10-05-provider-layer-follow-ups.md)). Users see no change in behaviour or texts.

Implemented:
- **Leases in PostgreSQL** (`src/providers/leases.ts`, replacing the in-memory `pacing.ts` and Dive lock): `dive_lease`
  (one action per Dive and Provider, one conditional upsert) and `connection.next_action_at` (pacing per Connection; a
  request waits what is left of the pause, or looks again every 250 ms, for at most 30 s, then `provider_busy`). Leases
  hold at most 5 minutes, so a crashed process frees them by itself. No advisory locks, no transaction around a Provider
  call. Times come from the app's clock (`Clock`; `skippingClock` in tests and the browser tests' server). The SSI logbook
  snapshot stays per process. Migration 0014 (generated, reviewed: one table, one nullable column).
- **Deleting at several Providers** (`pushes.removeAt`): each checked first (Connection, signed in, `exists` at the
  adapter), then deleted under the Dive's leases at all; one that still fails stops it, keeps the Dive, and the refusal
  carries `providers` with each `copy`. At one Provider as before, without a check.
- **Typed text overrides:** `ProviderOverrideKey` and `StrayOverride` in `apps/web/src/lib/providers.ts`; the type check
  and `test/translations.test.ts` refuse a `providers.<id>.*` key that overrides nothing.
- **A second test-only adapter**, the ledger (`test/fake-ledger-provider.ts`: token sign-in, an ID back, update and delete,
  no find or link). The contract suite runs a case per declared operation and fails on one without a case.
- **Tests:** `leases.test.ts` (two app instances on one database: a second request refused, actions paced across
  instances, a turn waited for and refused after the bound, crashed leases running out, no transaction open during a
  Provider call); `dive-deletion.test.ts` (SSI and the ledger: a refusal in the check deletes nothing, a failed delete
  keeps the Dive and says which copy is gone, a copy deleted in the Provider's app counts as gone); the contract suite
  for three adapters. The browser test "an unknown dive says so at once" counts its requests instead of timing them
  (it failed at about 1 s on a busy machine, before this slice too).

Deliberate simplifications, to revisit:
- **The web client** still says "Nothing was deleted" on any refusal while deleting. It can't be otherwise in production
  (SSI is the only Provider that deletes); a client showing two such Providers must read `providers` (clients.md).
- **A failed delete stops** the deleting at the remaining Providers instead of going on.
- **The wait for a turn polls** (every 250 ms) instead of being woken; fine for a handful of requests per Connection.
  Waking would be PostgreSQL `LISTEN`/`NOTIFY` (one listening connection per process, polling kept as a fallback for
  missed notifications), or only in-process waking with polling across processes. Worth it when the worker sends
  batches (ADR 0010), not before.
- **Leases hold 5 minutes** whatever the Provider; a crashed action keeps its Dive and Connection busy that long.


**Slice 14 (2026-10-05): buddies, on Push requirements** ([ADR 0028](../decisions/0028-shared-divers-and-participants.md),
[ADR 0029](../decisions/0029-push-requirements-and-buddies.md), the [follow-ups](../research/2026-10-05-provider-layer-follow-ups.md)).

Implemented:
- **Push requirements** (`src/providers/requirements.ts`): an adapter declares `dives.export.requirements` (replacing
  `needsSiteIdFrom`), `site_external_id` or `diver_mapping`, each `blocking` or `advisory`. The push service evaluates them
  from Dive Hub's data (`unmet` in every status, no Provider call), refuses a blocking one with
  `provider_requirements_unmet` and the list (replacing `provider_site_id_missing`), hands the adapter the Dive without the
  Participants an advisory one leaves out, and records them with those the adapter couldn't place (`push.left_out`).
  `GET /api/providers` gives each requirement with how a site ID may be typed (from `SOURCE_INFO`: `typed`, `pattern`,
  `prefixes`).
- **A site's typed External ID** has its own route, `PUT /api/dive-sites/{id}/external-ids/{source}` (Sources with
  `typed` in `SOURCE_INFO`, SSI today): takes "site:3314", keeps the bare ID, a Revision under `ssiSiteId` as before, the
  site's version untouched. `ssiSiteId` left the site API; site merges move every External ID the same way.
- **Divers seen by name, external Divers, Participants** (ADR 0028): `GET /api/divers/search`, `GET|POST /api/external-divers`,
  `PATCH|DELETE /api/external-divers/{id}`, `PUT /api/divers/{id}/external-ids/{source}`, `PUT /api/dives/{id}/participants`;
  the Dive view lists `participants`. Migration 0015 (generated, reviewed, plus one statement renaming stored codes):
  `participant` (with `participant_role`), `diver.created_by`, `push.left_out`.
- **Buddies at SSI:** the client reads `logbook_buddies` (entry ID, name, `buddy_master_id`; nothing else is kept); the
  adapter declares `buddies` `find` and both requirements (site ID blocking, Participants advisory), sends every
  Participant as a buddy by finding the entry with the Diver's SSI account in the logbook read the action makes anyway,
  leaves out one not in the list (`not_at_provider`), keeps buddies set in SSI's app on update (SSI's IDs minus those
  sent before, from the current Push's payload), counts the Participants' SSI accounts in the fingerprint and reads the
  buddy IDs back. `GET /api/connections/{id}/buddies` and `POST …/buddies/import` read the list live and create external
  Divers with name and SSI account (`src/providers/buddy-service.ts`).
- **Web client:** `Participants.tsx` (buddies, guides and instructors on the dive page; a role radio group and a live
  search over every Diver, or a new one by the typed name, when adding; a role dropdown per row that saves at once); `ProviderPanel.tsx` renders one resolver per requirement type
  (the site picker takes its ID forms from the capabilities; "Find … in your SSI buddy list" sets the Diver's account), an
  unknown type with the Provider's description, and who a Push left out; `ProviderBuddies.tsx` (the SSI buddy list under
  the Connection: add one or all, or link an entry to a Diver here); "Other divers" on the Divers page; the site form's
  typed site IDs come from the requirements. No `ssiSiteId` or SSI QR format in the web code; SSI's own sentences are
  `providers.ssi.*` texts.
- **Tests:** `provider-requirements.test.ts` (both types at both severities, through SSI and the ledger, whose
  requirements are SSI's with the severities swapped), `participants.test.ts`, `site-external-ids.test.ts`,
  `ssi-buddies.test.ts` (against the fake SSI with a buddy list: import, sending, left out, update keeping app buddies,
  nothing personal stored or answered); the contract suite checks requirement types and runs a Participant case and a
  `buddies.import.find` case; browser tests `buddies.spec.ts` (@account, @divers, @dives) and ui-quality cases for the
  dive's buddies, both dialogs, the SSI buddy list and other divers. `leases.test.ts` now checks the 30 s bound on the
  time that passed, not on the sum of the test clock's sleeps (it failed under load since slice 13a).

Deliberate simplifications, to revisit:
- **No Connection Diver mappings:** a buddy entry without an SSI account can't be sent (none seen in the owner's list).
  They come with `PUT /api/connections/{id}/divers/{diverId}` and `fixes: ['connection_mapping']`.
- **No adding to the SSI buddy list:** a buddy not in it is left out with a notice to scan their QR code in SSI's app.
  Later: show the buddy's SSI QR code, or add the entry once the app's call is known (follow-ups note).
- **Buddy suggestions, Joint dives, Visibility, merging two Divers** come later (ADR 0028); another User's Diver can be put
  on a Dive and nothing reaches that User.
- **Same-name Divers** look the same in the picker; it shows only whether a Diver is yours, another User's or external.
- **Requirement descriptions are English** (shown only for types a client doesn't know).
- **The owner's check** passed (2026-10-06): buddies sent from Dive Hub show on the dive in SSI's app.

**Slice 15 (2026-10-06): importing dives from a Provider, SSI first** ([ADR 0030](../decisions/0030-importing-dives-from-providers.md),
the [design note](../research/2026-10-06-ssi-import.md)).

Implemented:
- **Time zones** (`src/dives/time-zone.ts`, geo-tz 8.1.9): a wall-clock time becomes an instant from the time zone at the
  dive's position, else its site's at the Provider (summer time through `Intl`), else the offset of the Diver's closest
  Dive within 7 days, else `unknown` (kept as if UTC). `dive.utc_offset_source` and `recording.utc_offset_source`
  (`device`, `position`, `nearby`, `unknown`); the Dive's follows its Primary recording. Placement and logbook matching
  compare local times where an offset is unknown (`alignedForMatching`, `entryMatches` in `src/imports/matching.ts`).
- **The adapter** declares `dives.import` `list` and offers `dives.list(context, { recent })`, `dives.parse(record,
  context)` and `dives.parser`; SSI's are in `src/providers/ssi/ssi-import.ts` (evidence, local start, values, profile,
  Device, site ID and position, buddies as SSI accounts, notes). `ImportedDive`, `ImportContext` and `REFERENCE_PREFIX`
  are in `provider.ts`.
- **The import** (`src/providers/dive-import.ts`, part of the provider layer): the Connection's settings (`import_mode`
  off / add / create, `import_window_minutes` 5–60, `import_computers`), `PATCH /api/connections/{id}`, the preview
  (`GET /api/connections/{id}/dive-import`: computers with choice and suggestion, counts, the entries to decide) and the
  start (`POST`: one JSON Original per dive, an Import with `provider`, `connection_id` and its `plan`: the context,
  choices, decisions, settings and Diver). The worker's `process_import` hands such an Import to it: per dive, in local
  time order and its own transaction, sent by Dive Hub → skipped; a Recording made before → placed again; linked →
  filled where empty; a computer's dive → a Recording (`ssi-app-api`, key `ssi:<id>`, Device by manufacturer and
  serial) through the same placement as files (`src/imports/placement.ts`, split out of the import service); a logbook
  entry → linked and filled, decided, a Dive without a Recording (`dive.from_provider`), or left out. Links are `link`
  Pushes, up to date (with the fingerprint) for Dives made from the Provider's dive.
- **Primary recordings** (`attachRecording`): a Recording attaching to a Dive without one becomes primary; a file's over a
  Provider's copy (a Recording whose Import has a Provider). Values without Override follow, with the offset's source.
- **API:** the Dive and the dive list carry `utcOffsetSource`, the Dive `fromProvider`; an Import `provider`, results
  `linked`, reasons `sent_by_dive_hub`, `no_match`, `ambiguous`, `left_out`, outcomes `remoteId`/`remoteNumber`; problem
  `provider_import_off`; Revision cause `fill`. Migration 0016 (generated, reviewed: additions only; existing rows are
  `device`).
- **Web client:** `ProviderDiveImport.tsx` under each Connection (what the import may do and the window, saved at once;
  the preview with the computers' choices and the entries to decide; the start and the outcome, polled); an import from
  a Provider is summed up by result in the Imports list; the dive page says where a time zone came from and shows a Dive
  without a Recording; an `unknown` time shows as logged, without an offset.
- **Tests:** `time-zone.test.ts` (coast, border, open sea, summer time and its change, nearby, unknown),
  `ssi-import.test.ts` (parsing), `matching.test.ts` (local time, the window, midnight, unknown offsets),
  `ssi-dive-import.test.ts` (against a fake SSI logbook with hand-typed dives, a computer's, one Dive Hub sent and
  ambiguous ones: preview, run, run again, sending a linked Dive, files becoming primary, deleted Dives, the modes,
  nothing personal stored); the contract suite's `dives.import.list` case; `dive-import.spec.ts` (@account, @dives) and
  ui-quality cases for the preview, the outcome and a Dive without a Recording, with Lena's SSI logbook in the e2e
  server.

Deliberate simplifications, to revisit:
- **SSI's dive from a computer is read against dive #91's shape** (Dive Hub's own upload); what SSI's app writes for a
  synced Mares is still to check before merging (design note), and the import reads those fields defensively.
- **No water setting from SSI** (it has no field); the water stays the site's (ADR 0025).
- **Re-runs are by the User**, never scheduled; nothing reads the Provider in the background.
- **Two entries matching one Dive:** the earlier links, the next is matched without that Dive; the preview judges each
  entry alone, so it may say "link" for both.
- **SSI's dive number, rating, conditions, gear and tanks** stay in the Originals (not taken yet).
- **Holders of a Device over time** (a lent computer) are their own topic (design note).

**Slice 15a (2026-10-06): the dive sites imported dives name** (ADR 0030, amended by the owner).

Implemented:
- `src/sites/provider-sites.ts`: a dive's SSI site is the site here with its ID, else the same site by the Site import's
  rule, else (with the admin's permission) a new site from the logbook's entry; `matchingSite` moved out of
  `planSiteImport` into an exported function both use. The logbook's context keeps each site's country (alpha-2) and
  water type (`bow`, read like the SSI site import's `WATER_OF_BOW`), so a site made from it has both.
- `provider_site_data` (migration 0017): an admin's permission per Provider; `GET /api/admin/provider-site-data`,
  `PUT /api/admin/provider-site-data/{provider}` (`confirm` required to allow; `provider_site_data_not_confirmed`).
- The preview's `sites` (known, match, create, missing) and `sitesAllowed`; linked dives are filled on every run.
- Web: the sites in the preview, and a panel per Provider on the Admin page with the explanation, the confirmation,
  who allowed it and when, and stopping it.
- Tests: `ssi-dive-import.test.ts` (a match by name and position, nothing made without permission, only admins allow and
  only after confirming, a site made from SSI's values with its country); `dive-import.spec.ts` and a ui-quality case for
  the admin panel (@admin).

**Slice 15b (2026-10-06): changes made at the Provider come back** (ADR 0030, amended by the owner).

Implemented:
- `src/providers/three-way.ts` (pure): the fields, comparing as the Provider keeps values, and the decision per field
  (take, conflict, nothing). `dive-import.ts`: the base (`baseOf`: the last finished Import's Original or the last Push
  that sent values, the newer), the Dive's side (`hubOf`), taking values (`takeChanges`: one Revision `update`, the site
  through `siteForProvider`, Participants with an account replaced, values and their Overrides on Dives without a
  Recording, and a new up-to-date `link` Push when the Dive was up to date), for linked dives, Recordings' Dives and dives
  Dive Hub sent. `parse` takes the remote ID for a record that doesn't name it (what was sent before SSI gave one).
- The preview's `counts.changed` and `conflicts` (with both values as shown); the start's `conflicts` choices, kept on the
  Import's plan.
- Web: the count, and "Changed in both places" with a choice per field (keep Dive Hub's preselected).
- Tests: `three-way.test.ts`; `ssi-dive-import.test.ts` (a site changed in SSI's app on a dive Dive Hub sent comes back and
  the dive stays up to date; a change made only here stays; a conflict kept, then asked again and taken; a Dive without a
  Recording follows SSI's depth); `dive-import.spec.ts` and a ui-quality case for the conflict. The e2e server has a
  test-only route (`POST /e2e/fake-ssi/dive`) for browser tests to change a dive on SSI's side, as in its app.

Found while building (owner's account, 2026-10-06): **SSI answers an update with its usual answer wrapped in
`success`** (`{ success: { ok, error, odin_user_log_id }, result }`), so Dive Hub, reading only the top level, had refused
every update SSI had in fact stored (SSI reference). The client now reads `success` when it is an object; the fake SSI
answers updates that way. And the import's computer list leaves out SSI dives already
linked to a Dive here (the owner's #90 had the Mk3's profile from such an update). Also fixed: `SearchList` gave React Aria
an empty state even with nothing to show, which leaves an option without a name while results change (axe, seen in the
site picker's browser tests); it passes one only when there is text. The server tests' default timeout is 15 s
(`vitest.config.ts`): tests of 1-2 s passed 5 s when the machine was busy.

With Samuel's account (2026-10-06): SSI's older records name the computer only in `divecomputer_ref`
("Mares Puck4_2418005226"); `ssi-import.ts` reads it. A computer dive already linked as a logbook entry is placed as a
Recording on the next import (attaching to its Dive) unless the Dive has that computer's Recording. Also fixed:
`SearchList` (the site picker) could leave its field pointing (`aria-activedescendant`) at a result that had left the list
while typing, until an arrow key; the list now starts fresh for each set of results. Page checks wait for such
references before axe.

Deliberate simplifications:
- **People Dive Hub doesn't know** (an SSI account without a Diver here) aren't shown in a buddies conflict and can't be
  added; they need importing from the buddy list first.
- **A Dive changed by taking SSI's values** shows "changed since sent" when it wasn't up to date before (sending then
  writes Dive Hub's full values to SSI).

**Slice 16 (2026-10-06): claiming an external Diver** ([ADR 0028](../decisions/0028-shared-divers-and-participants.md),
amended by the owner).

Implemented:
- `src/divers/merge.ts`: merging an external Diver into another (Participants without duplicates or the Diver's own
  Dives, accounts, `diver.merged_into`, Revisions `merge`). Migration 0018.
- Connecting an account an external Diver holds answers `provider_account_held` with that Diver and its Dive count;
  `claim: true` merges it in the Connection's transaction. Another User's Diver stays `provider_account_taken`.
- `POST /api/admin/divers/{id}/merge` (admins): `diver_not_external`, `diver_external_id_taken`.
- Web: the question in the connect form (yes connects again with `claim`), and "Merge into…" for admins under Other divers.
- Tests: `diver-claim.test.ts` (asked first, merged on claim, Tim's buddy list then finds Samuel's own Diver, another User's
  Diver never taken, admins only); `dive-import.spec.ts` (@account, @divers) and ui-quality cases for the question and the
  merge dialog, with Lena's SSI account held by an external Diver.

**Slice 17 (2026-10-06): the MCP endpoint, read-only, with AI accesses** ([ADR 0035](../decisions/0035-mcp-connector.md),
its [amendment](../decisions/0035-mcp-connector.md#amendment-2026-10-06-as-built-slice-17), [client contract](clients.md#the-mcp-endpoint)).
- `apps/server/src/mcp/`: `access-service.ts` (AI accesses on Better Auth's api-key plugin, the instance's switch, the
  log), `access-routes.ts`, `endpoint.ts` (`/mcp`: Origin check, bearer key, 401/429 that say what to do, the SDK's
  stateless handler for both protocol eras), `server.ts` (the tools an access's scopes allow, the instructions),
  `tool.ts` (what every tool shares: argument checks, a read-only transaction with a time limit, paging, the size cap,
  logging), `tools-logbook.ts`, `tools-sites.ts`, `tools-divers.ts`, `profile.ts` (the profile summary).
- Tools: `logbook_search_dives`, `logbook_get_dive`, `logbook_stats`, `sites_search`, `sites_get`, `divers_buddies`,
  `divers_list`. Schemas are TypeBox, handed to the SDK as JSON Schema; no Zod in our code.
- Migration `0019_ai_access.sql`: `apikey` (Better Auth), `ai_access_setting`, `ai_access_log`. A daily worker job
  (`purge-ai-access-log`, 03:17 UTC) deletes log entries older than 90 days.
- Routes: `GET /api/me/ai-access`, `POST /api/me/ai-accesses` (the key once), `DELETE /api/me/ai-accesses/{id}`,
  `GET /api/me/ai-access-log`; admins: `GET`/`PUT /api/admin/ai-access`, `DELETE /api/admin/ai-accesses`. Codes
  `ai_access_off`, `ai_access_not_found`.
- Web: `AiAccess.tsx` — on the account page what an access hands to the AI provider, creating one (the key once, with
  lines for Claude Code, VS Code and mcp-remote from `lib/ai-access.ts`), the accesses with their last use, revoking, and
  what was read; on the admin page the switch and "Revoke all". `CopyField`'s button is now named with what it copies.
- Better Auth's log no longer prints an error with a stack for every unknown key (`auth.ts`, `logger`).
- Tests: `mcp-endpoint.test.ts` (the SDK's client against `/mcp`: 401s, both eras, isolation, positions only with the
  scope, marked texts, every tool against its output schema, paging and caps, the time limit, no writes, the log, the
  rate limit, revoking, the switch, a disabled or deleted User), `mcp-profile.test.ts`; web `ai-access.test.ts`;
  browser `ai-access.spec.ts` (@account, @admin) and three ui-quality cases.
- Not yet: OAuth for claude.ai and ChatGPT, body weight (slice 19), key expiry, a filter by access in the log's UI.

**Slice 18 (2026-10-06): the dive assessment** ([ADR 0036](../decisions/0036-dive-assessment.md), its
[amendment](../decisions/0036-dive-assessment.md#amendment-2026-10-06-as-built-slice-18-engine-version-1), [client contract](clients.md#the-dive-assessment)).
- `apps/server/src/assessment/`: `rules.ts` (pure: spike cleaning, splitting at the surface, 15 s windows, fourteen rules
  with their thresholds, evidence labels and sources, `ENGINE_VERSION` 1), `assessment-service.ts` (stored findings,
  refreshed per Diver by a stamp of engine version and Primary recording; dismissals, muted rules), `routes.ts`,
  `texts.ts` (English sentences and the fixed note, for MCP).
- Migration `0020_dive_assessment.sql`: `dive_assessment`, `dive_finding`, `finding_dismissal`, `muted_rule`.
- Refreshed after every Import (`afterImport`), after every change through `dives/routes.ts` and
  `dives/candidate-routes.ts` (an `onSend` hook), when read, and by the worker at start (`assess-dives`).
- Routes: `GET /api/dives/{id}/assessment`, `PUT /api/dives/{id}/findings/{rule}/dismissal`,
  `PUT /api/divers/{id}/muted-rules/{rule}`; `GET /api/dives` carries `findings` per Dive. Code `finding_not_found`.
- Computer events: `COMPUTER_EVENTS` in `vocabulary.ts`, Garmin's `dive_alert` codes in `fit/fit-vocabulary.ts`.
- MCP: `logbook_get_dive_assessment` (eight tools now).
- Web: `Assessment.tsx` (the panel under the Recordings, the findings' lane, a context shared with the profile),
  `DepthProfile.tsx` (the ascent coloured by speed with a legend in words, the selected finding's stretch),
  `lib/assessment.ts`, the mark in `DiveList.tsx`; tokens `--color-ascent-1..3`.
- Tests: `assessment-rules.test.ts` (every rule on synthetic profiles, what must not fire, 5 s data, real files when
  present), `assessment.test.ts` (API: after imports, edits, deleting and restoring, dismiss, mute, another User, a new
  engine version, a Dive without a Recording), the MCP tool in `mcp-endpoint.test.ts`; web `assessment.test.ts`; browser
  `assessment.spec.ts` (@dives) and three ui-quality cases; fixture `assessed-computer.fit` (dive 77).
- DAN's no-fly time is computed when an assessment is read (`noFlyAfter`) and returned beside the findings; a Diver's
  muted rules are in `GET /api/divers` and on the Divers page.
- Not yet: gas left (slice 19), the surfacing GF (slice 21), trends, rules for apnea and rebreathers.

**Slice 18a (2026-10-07): Suunto files; file formats behind a registry** ([ADR 0037](../decisions/0037-suunto-file-import-and-file-formats.md),
[Suunto formats](../references/suunto-formats.md)).
- `apps/server/src/imports/formats.ts`: the registry (`FileFormat`: `format`, `mediaType`, `parser`, `parserVersion`,
  `detect`, `parse`). `import-service.ts`, `archive.ts` (`extractFiles` with a predicate) and the position backfill ask
  it; none names a format. `parsed-recording.ts` holds what every adapter delivers (moved out of `src/fit/`).
- `apps/server/src/suunto/`: `suunto-json.ts` (the app's JSON export: Device, offset, summary, channels `depth`,
  `temperature`, `ndl`, `tts`, `ceiling`, `tankPressure`, events), `suunto-vocabulary.ts` (dive modes, RGBM models,
  computer events).
- `fit/fit-adapter.ts`: a Suunto dialect (the summary from `session`, the developer field `dive_mode`, the key
  `suunto:fit:…` without a serial). Garmin files read as before, plus `otuEnd`.
- `placement.ts`: `replacesKey` (a JSON takes over the FIT's Recording in place, with a `reimport` Revision) and
  `fullerCopyLike` (a FIT finds the JSON's Recording by key pattern, duration and maximum depth: `skipped`,
  `fuller_copy_here`); only among Recordings of Divers the User manages.
- No migration: summaries are JSON, reasons and channels are text. Reasons `no_dive_file` (replaces `no_fit_file`, which
  stays valid for stored Imports) and `fuller_copy_here`; deco models `suunto_fused_rgbm`, `suunto_fused2_rgbm`; computer
  events `safety_stop_mandatory`, `deep_stop_started`, `deep_stop_broken`, `tank_pressure_low`
  (`imports/computer-events.ts` maps stored events of any Source). The assessment's ceiling rule reads `nextStopDepth`,
  else `ceiling`. MCP: `ceiling` and `tankPressure` are sample channels.
- Web: the import texts name Suunto, `.json` is accepted by the picker, the new words are translated (en, de).
- Tests: `suunto-formats.test.ts` (detection, both adapters, vocabulary, the assessment on 10 s samples; real files in
  `samples/private/suunto` cross-checked when present), `suunto-import.test.ts` (PostgreSQL: scenario 1 with a Garmin and
  a Suunto, a drifting clock, a Recording overlapping two Dives, FIT then JSON and the reverse, a zip, re-imports,
  another User's Device); browser `suunto-import.spec.ts` (@dives); fixtures hand-made by `test/fixtures/suunto-dive.ts`.
- Deliberate simplifications: a FIT after a JSON **without a serial number** is not recognised as the same dive (it
  attaches as a second Recording); an Ocean's positions and header-less gases are not read; a pod is not a Device and
  tank pressure is stored, not shown.
- Not yet: Cylinders and SAC from the pod (slices 19, 22), the pod as a Device (23), SML and DM5 XML, merging two files
  of one dive.

**Slice 18b (2026-10-07): merging two Dives; a linked Dive moves as a copy** ([ADR 0038](../decisions/0038-logbook-checks-and-merging-dives.md),
[Logbook housekeeping](../research/2026-10-07-logbook-housekeeping.md)).
- `apps/server/src/dives/merging.ts` (`createMerging`): `candidates` (the Dives of the same Diver that overlap one, by
  the import's `overlaps` and tolerance, local times where an offset is unknown; with their Recordings, the Providers
  they are at, which a merge keeps), `merge` (both Dives locked in id order; the other's Recordings attached, Participants
  added, links moved, gaps filled, notes appended, then the other deleted) and `move` (as before for an unlinked Dive; a
  linked one is copied, its Recordings moved, the old one deleted with its links). `dive-service.ts` exports
  `lockManagedDive` and `applyToDive` for it and no longer moves Dives.
- **Links are the Pushes** (`currentRemote` per Provider): moving a link moves the Dive's Pushes at that Provider to the
  kept Dive, so what Dive Hub sent and saw (the base of the three-way comparison) stays with it; a `link` Push is added
  when older Pushes of the kept Dive there would hide it. No Provider is named.
- Routes: `GET /api/dives/{id}/merge-candidates`, `POST /api/dives/{id}/merge` (`alsoAt` deletes the left-over dive at a
  Provider first, through the Push service, as deleting does), `POST /api/dives/{id}/move` answers the Dive where it is
  now; `GET /api/dives/deleted` gains `mergedInto` and `movedTo`, read from the deleting Revision. Problem
  `merge_not_possible`. No migration.
- Web: `MergeDive.tsx` (the hint on the dive page and the dialog), the move dialog says when a Dive moves as a copy, the
  deleted dives say where a Dive went, the history tells merges and copies (en, de); icon `merge`.
- Tests: `dive-merging.test.ts` (PostgreSQL, SSI's fake and the ledger: the two observations of the research note, a
  merge from either side, filling and appended notes, links moved or left behind, deleting at the Provider when asked,
  restoring, a Dive at two Providers merged and moved, an unlinked move); browser `dive-merge.spec.ts` (@dives) and a
  ui-quality case; fixtures `mergeable-main.fit`, `mergeable-backup.fit` (`test/fixtures/write-merge-fixture.ts`).
- Deliberate simplifications: a merged or moved Dive's findings put aside don't follow it (the assessment is computed
  again); a moved Dive's Device stays with the old Diver (ADR 0016); no undo beyond restoring.
- Not yet: finding such pairs unasked, in "Needs your decision" (slice 18c, below).

**Slice 18c (2026-10-07): logbook checks** ([ADR 0038](../decisions/0038-logbook-checks-and-merging-dives.md)).
- `apps/server/src/dives/logbook-check-rules.ts` (pure, `LOGBOOK_CHECKS_VERSION` 1): `ruleFor` two Dives
  (`recording_beside_entry` with the import's tolerance when exactly one has a Recording, `overlapping_dives` on a real
  overlap otherwise; local times where an offset is unknown) and `findChecks` over a logbook (each pair once; `obvious`
  when an import would have attached them: one partner each, depths agreeing).
- `logbook-checks.ts` (`createLogbookChecks`): `list` (the User's Divers' live Dives, the pairs, without those answered),
  `against` (one Dive's pairs, for the dive page's merge candidates, which follow the same rules now) and `answer`.
  `logbook-check-answers.ts`: `keepApart`, called when a Recording is split off (`detach`) or a Duplicate candidate
  becomes a Dive of its own.
- Table `logbook_check_answer` (migration 0021): the rule, the two Dives (smaller id first), their starts when answered
  (the answer holds while both are unchanged), who answered. Nothing else is stored: checks are computed on every read.
- Routes: `GET /api/logbook-checks?status=open|answered`, `PUT /api/logbook-checks/answer`; `merge-candidates` gains
  `rule` and `answered`. Problem `check_not_found`.
- Web: `LogbookChecks.tsx` on the Review page (`ReviewPage.tsx`, since UI redesign slice B; first inside "Needs your decision"): the pairs with "Merge the two…" (the merge
  dialog, staying on the logbook) and "They are two dives" (with Undo), "Merge the N clear pairs…" from two obvious pairs
  on, the answered pairs with "Ask again"; the dive page's hint leaves answered pairs out (en, de).
- Tests: `logbook-check-rules.test.ts` (the rules), `logbook-checks.test.ts` (PostgreSQL: both observations found, another
  User sees none, answering, taking back, asked again after a time change, resolved by merging and by moving a time, a
  split-off pair answered by itself); browser `dive-merge.spec.ts` (@dives) and the ui-quality case.
- Deliberate simplifications: every read compares each Dive with those starting within its length plus 28 hours (fine
  for thousands of Dives; no index or cache); the checks run when asked for, not in the worker, and an Import's outcome
  doesn't count them (the panel above the logbook does, as soon as the Import ends); merging the clear pairs is one request
  per pair from the client; no rule looks at Dives of two Divers (a dive filed under the wrong Diver shows up as an
  overlap only in its own logbook).
- Afterwards (2026-10-07): the import follows a dive Dive Hub sent to the Dive it is linked to now (`assess` in
  `providers/dive-import.ts`: the current link before our reference), so a Dive merged into another keeps taking changes
  made at the Provider; and the web client says which of two Dives a merge keeps (the hint, the pair, the dialog).
- Not yet: rules beyond overlaps (a number twice, a dive inside a no-fly time), telling by e-mail, the checks over MCP.
