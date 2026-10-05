---
title: System architecture
summary: Components of Dive Hub, how they talk to each other and how they are deployed.
status: draft
date: 2026-10-05
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
| `DIVEHUB_CONTACT` | Optional: the operator's e-mail address or URL, added to the User-Agent of Site imports ([below](#dive-site-imports-and-licenses)) and of calls to SSI. |
| `DIVEHUB_ENCRYPTION_KEY` | Optional: 32 bytes as base64 (`openssl rand -base64 32`). Encrypts what Dive Hub keeps for Targets (SSI tokens and passwords, [ADR 0024](../decisions/0024-ssi-target-via-app-api.md)). Without it, Users can't choose "Keep me signed in" for SSI, and tokens are stored as they are. Keep it apart from database backups; losing it means every User signs in to SSI again. A wrong length stops the server at start. |
| `DIVEHUB_SSI_URL` | Only for tests: another endpoint for SSI's app API. |
| `DIVEHUB_OVERPASS_URL`, `DIVEHUB_WIKIDATA_SPARQL_URL` | Optional: other endpoints for Site imports (default `overpass-api.de`, `query.wikidata.org`). |
| `DIVEHUB_SSI_SITES_URL` | Optional: another address for SSI's site list (default `api.divessi.com/app/APP_CACHE_SITES.zip`, ADR 0025). |

## Dive site imports and licenses

Admins can import Dive sites from Wikidata, OpenStreetMap ([ADR 0021](../decisions/0021-site-external-ids-and-import.md))
and SSI ([ADR 0025](../decisions/0025-ssi-site-import-and-site-water-type.md)).
The image contains no site data. Each operator imports for their own instance, so the license obligations
are the operator's:

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
- **Deleting a Dive** in the hub doesn't exist yet, so nothing offers deletion in SSI from there.
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
