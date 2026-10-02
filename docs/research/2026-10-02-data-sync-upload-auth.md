---
title: Sample storage, uploads, change tracking and auth
summary: Best practices for four cross-cutting concerns (Sample series in PostgreSQL, file uploads and Originals, Revisions and client sync, auth for web + mobile), with what comparable self-hosted apps do and a recommendation each.
status: done
date: 2026-10-02
---

# Sample storage, uploads, change tracking and auth

Markers: **[V]** checked against the primary source (spec, official docs, source code);
**[S]** secondary source (blog, search summary, third-party doc); **[?]** not verified or own estimate.

Terms follow the [glossary](../glossary.md). Context: [architecture](../spec/architecture.md),
[data model](../spec/data-model.md), [ADR 0004](../decisions/0004-system-architecture.md) (proposed).
Language and framework choice, FIT libraries and general deployment are covered by other notes.

## Summary

| Concern | Recommendation |
|---|---|
| Sample storage | One row per (Recording, channel) holding integer-scaled arrays; events in their own table; summary values as columns. No row per sample, no EAV, no TimescaleDB. Samples are a re-derivable cache of the Original. |
| Uploads | Plain multipart upload for single files and small zips in phase 1; a resumable protocol (tus 1.0) for account exports. Content-addressed storage by SHA-256 behind a small blob-store interface; streaming zip extraction with hard limits. |
| Change tracking / sync | Revisions written by the application in the same transaction as the change; a global change feed (sequence + transaction ID) with soft-delete tombstones; cursor-based pull API; `If-Match` on writes. |
| Auth | Opaque, hashed, revocable session tokens in one table, sent as `__Host-` cookie (web) or bearer (mobile); argon2id; invitation-only signup; admin bootstrap by setup token or env var; identities table so OIDC (+PKCE, system browser) can be added later. |

## 1. Sample storage in PostgreSQL

### Findings

**PostgreSQL mechanics**
- Each heap row has a 23-byte header plus a 4-byte line pointer; pages are 8 kB [V][pg-page].
  So per-row overhead is ~28–32 bytes before any data, plus index entries.
- Values wider than ~2 kB are compressed and/or moved out of line (TOAST); compression is `pglz`
  or `lz4`, selectable per column; max value size 1 GB; out-of-line values are stored in ~2 kB
  chunks [V][pg-toast]. A TOASTed array or JSONB value is read and decompressed as a whole [?].
- TimescaleDB: hypertables are in the Apache-2 edition, but the columnstore (compression) and
  continuous aggregates are only in the Timescale-licensed Community edition [V][tsdb-editions].
  It needs a Postgres image with the extension, i.e. not the stock `postgres` image [?].

**What comparable projects do**

| Project | Sample storage | Originals |
|---|---|---|
| Subsurface (git storage) | One text line per sample per dive computer; pressure, NDL, deco etc. are written only when they change (sparse) [V][ss-git] | — |
| divetracx | Row per sample, wide table `dive_profile_samples`: UUID PK, dive FK, ~14 `numeric`/`integer` channels (depth, temp, 2 tank pressures, ceiling, NDL, TTS, CNS, HR, …), created/updated timestamps, two indexes [V][dtx-schema] | Media originals immutable; local FS or S3 [V][dtx] |
| OpenDiving | **One row per Recording**, JSONB `data` with **per-channel** series `{"t":[…], "v":[…]}`, integer-scaled (cm, 0.1 °C, 0.1 bar), ms offsets; events in the same document; no nulls, dropout = gap in `t`. Rationale: profiles are only ever read whole; per-channel because channels are sampled independently. Chose JSONB over packed `bytea` despite ~3× size, for queryability. Profile is re-derived from the stored file, keyed by (file SHA-256, extractor version, reader version). API serves it with an ETag [V][od-dec] [V][od-profile] | Stored on a volume or S3 behind a `blob_store`, one row per file, unique per (user, SHA-256) [V][od-dec] |
| FitTrackee | Per segment: JSON `points` column plus a PostGIS `LINESTRING`; original file path kept [V][ftt-model] | File kept on disk [V][ftt-model] |
| Endurain | `activities_streams`: one row per (activity, stream type) with a JSON array of waypoints (HR, power, cadence, elevation, speed, pace, lat/lon) [V][endurain-model] | — |
| Dawarich | Row per GPS point (`points`, PostGIS `geography`) — location history is queried across time, not per activity [V][dawarich-schema] | Imports kept |

Pattern: apps whose unit is "one activity/dive" store **a block per activity and channel**
(OpenDiving, Endurain, FitTrackee); only divetracx and the location tracker store rows per sample.

**Size estimate** [?] (own calculation from the overheads above)

Assumptions: 5 Users × 2,000 dives = 10,000 Recordings (+20 % if second computers are common);
3,000 samples per Recording on average (50 min at 1 s; worst case ~7,200); ~8 non-null channels per
sample out of ~20 possible.
→ 30 M samples, ~240 M individual values.

| Option | Bytes (approx.) | Total for 10,000 Recordings |
|---|---|---|
| Narrow / EAV (`recording, t, channel, value` + index) | ~80 B per value | **~19 GB** |
| Wide row per sample, compact types (`int8`, `int4`, `real`, PK index) | ~110 B per sample | **~3.5 GB** |
| Wide row per sample, divetracx style (UUIDs, `numeric`, timestamps, 2 indexes) | ~250–300 B per sample | **~8 GB** |
| JSONB per Recording, integer-scaled, per-channel `t`+`v` (TOAST-compressed) | ~100–150 kB per Recording | **~1–1.5 GB** |
| `int4[]`/`real[]` per (Recording, channel), shared time axis, lz4 | ~40–70 kB per Recording | **~0.4–0.7 GB** |
| Packed binary (delta + zstd in the app, `bytea`) | ~10–25 kB per Recording | **~0.1–0.25 GB** |
| Originals (FIT files) on the volume, for comparison | ~100–300 kB per dive | **~1–3 GB** |

All block options are small next to the Originals; even row-per-sample fits a NAS. The real
differences are write/delete cost (an Import replacing a Recording rewrites ~3,000 rows vs. ~10),
vacuum/index churn, and backup/restore time — not disk space.

**Query needs**
- *Render a profile:* reads one Recording's samples whole → blocks are one indexed read; row per
  sample needs `ORDER BY t` over thousands of rows (OpenDiving's main argument) [V][od-dec].
- *Statistics per dive* (max depth, avg depth, min temp, SAC, time below X m): compute once at
  Import and store on the Recording; recompute when the parser version changes.
- *Cross-dive queries* ("all dives deeper than 30 m", "coldest dive") use the summary columns on
  Recording/Dive, never the samples. Rare ad-hoc analysis can `unnest()` arrays over all
  Recordings; at ~30 M values this is a scan of seconds, not hours [?].
- *Multiple Recordings per Dive:* a block keyed by Recording handles this naturally; each
  Recording keeps its own time zero (OpenDiving does the same) [V][od-profile].
- *Re-parsing from Originals:* treating samples as a cache (parser version stored with the block)
  makes re-derivation a normal background job instead of a migration.

### Recommendation

1. **Table `recording_channel`** (name to be decided): one row per (Recording, channel, sensor):
   channel kind, sensor ID (for per-sensor pressure/PO2), unit scale, `t int4[]` (ms from Recording
   start; NULL = uses the Recording's shared time axis) and `v int4[]` (integer-scaled SI, e.g. mm,
   mK, mbar). Dense channels share one time axis; sparse channels (PO2 per sensor, ceiling, NDL)
   carry their own `t`. ~10–25 rows per Recording; fetch depth only for thumbnails, everything for
   the detail view. Set `COMPRESSION lz4`.
2. **Events** (gas switch, alarms, bookmarks, setpoint changes) in a separate narrow table — few per
   dive and worth querying ("all dives with a deco violation").
3. **Summary values** (max/avg depth, duration, temperatures, CNS/OTU, …) as typed columns on
   Recording; Dive values derive from the Primary recording or an Override.
4. **Unknown source fields** (A7 extension area) as JSONB on the Recording; per-sample unknowns as
   extra channels with a source-specific kind.
5. Store **parser version + Original hash** on each Recording; re-derive when either changes
   (OpenDiving's idempotency key). Keep full resolution in the database; downsample in the API
   response (min/max bucketing keeps extremes, as OpenDiving does) [V][od-dec].
6. Don't use TimescaleDB (license split, extra image, no benefit at ~30 M samples) or EAV.
   Revisit packed binary only if size ever matters; the API format can stay the same.
7. Serve profiles with an `ETag` (block version) and `Cache-Control: private` [V][od-dec].

## 2. File upload and Originals

### Findings

- **Garmin exports:** the full account export nests FIT files inside further zips
  (`DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip`, …), mixing activity,
  monitoring, sleep and weight FIT files with opaque names [S][garmin-export]. So the hub must
  read zips inside zips and skip non-dive FIT files cheaply (check the FIT `file_id`/sport first) [?].
- **Proxy limits:** nginx's `client_max_body_size` defaults to 1 MB and returns 413 above it
  [V][nginx]; Cloudflare's proxy limits request bodies to 100 MB on Free/Pro plans [S][cf-limits].
  Multi-GB single requests will fail behind typical self-hosting setups; chunked/resumable
  uploads avoid this.
- **tus 1.0** (stable since 2016): `POST` creates an upload, `HEAD` returns `Upload-Offset`,
  `PATCH` appends; extensions for creation, checksum, expiration, termination and concatenation
  [V][tus]. Client libraries exist for browsers and mobile (Uppy, tus-js-client, TUSKit,
  tus-android-client) [?].
- **IETF "Resumable Uploads for HTTP"** (by tus and Apple authors) is at draft-12 (July 2026),
  intended Proposed Standard, not yet an RFC [V][rufh].
- **OWASP File Upload:** allowlist extensions, validate by content signature not `Content-Type`,
  server-generated file names, store outside the webroot (ideally on separate storage), size
  limits, decompress archives safely and check the real size, optional AV scan, authenticate
  uploads [V][owasp-upload].
- **Zip bombs:** non-recursive bombs with overlapping entries reach 42 kB → 5.5 GB,
  10 MB → 281 TB and 46 MB → 4.5 PB; declared sizes in the header can't be trusted [V][zipbomb].
  Usual controls: cap total uncompressed bytes, entry count, per-entry ratio and nesting depth,
  enforced while streaming [S][zipbomb-wiki].
- **Dedup before upload:** Immich clients send a SHA-1 checksum and call `bulk-upload-check`;
  the server answers `accept` or `reject: duplicate`, so known files are never re-sent [S][immich-bulk].
- **Storage layout:** OpenDiving stores blobs on a named volume behind a `blob_store` with opaque
  keys that are also valid S3 keys, and added an S3 backend later without changing callers; it
  documents backup as "dump the DB first, then copy files" because files are written before their
  rows commit and never mutated [V][od-dec]. It notes that Immich, Nextcloud, Paperless-ngx and
  others default to local disk and that MinIO is in maintenance mode [S][od-dec].
- OpenDiving dedups per (user, SHA-256) with a unique index and turns the race into a 409 instead
  of locking [V][od-dec]. FitTrackee and Endurain keep the original file next to the parsed data
  [V][ftt-model].

### Recommendation

1. **Phase 1 endpoint:** `POST /imports` with `multipart/form-data`, several files per request,
   single files ≤ e.g. 50 MB each (configurable). Accepts `.fit` and `.zip`. Answers with the
   Import ID at once (as in the [architecture](../spec/architecture.md)).
2. **Large uploads** (account export, GBs): a tus 1.0 endpoint (`/uploads/`) that, when complete,
   creates an Import from the finished file. Wrap it so the IETF protocol can replace it once it is
   an RFC. Set `Upload-Expires` and clean up incomplete uploads. Document the proxy settings.
3. **Hash before upload (later, mobile):** `POST /originals/check` with SHA-256 list → known/unknown,
   so the mobile share receiver doesn't re-send files.
4. **Originals are content-addressed:** SHA-256 of the exact bytes; path
   `originals/ab/cd/<sha256>` on the volume; DB row = hash, size, media type, first received at;
   a join table links Originals to Users/Imports (the same bytes from two Users are stored once;
   access is per User). Write the file (temp file + fsync + rename), then commit the row; a
   periodic sweeper removes orphans. Never mutate a stored file.
5. **Zips are containers, not Originals:** extract entries in a streaming way in the worker; each
   relevant entry becomes its own Original; keep the archive itself only temporarily (or optionally
   as an Original of type `zip`, open point). Limits (configurable): nesting depth 3, ≤ 100,000
   entries, ≤ 20 GB total uncompressed, ≤ 100 MB per entry, compression ratio ≤ 100:1 per entry;
   count real bytes, ignore header claims; reject path traversal and symlinks; never extract to
   user-chosen paths.
6. **Validation:** sniff content (FIT header `.FIT` signature and CRC), not extension or
   `Content-Type`. AV scanning is not needed for parsed binary formats that are never served back
   as executable content; keep it as an optional hook for Media later.
7. **Blob-store interface** with `put/get/head/delete/list` and opaque keys from day one; local
   volume default, S3-compatible backend later.
8. **Quotas:** per-User storage and upload-rate limits as instance settings.

## 3. Change tracking and sync for clients

### Findings

- **Immich Sync v2:** ordered change IDs (UUIDv7 `updateId`, set by triggers), deletes captured by
  triggers into `*_audit` tables, a JSON-Lines stream (`application/jsonlines+json`) where each line
  carries type, ack token and data; the client POSTs acks after writing to its SQLite DB;
  checkpoints are per session and entity type, so an interrupted sync resumes [V][immich-sync].
  Immich replaced `updatedAt` cursors because several rows can share a millisecond [V][immich-sync].
- **WatermelonDB sync contract:** `pull(lastPulledAt)` returns `{changes: {table: {created,
  updated, deleted}}, timestamp}`; deletes are IDs only, so the backend needs tombstones; push must
  be fully transactional and must abort if a record changed on the server after `lastPulledAt`
  (client re-pulls and resolves); the backend must keep timestamps monotonic [V][watermelon].
- **Timestamp/sequence cursors and in-flight transactions:** `updated_at = now()` and sequences are
  assigned before commit, so a long transaction can commit with a cursor value a client already
  passed, and the client misses it [?]. PostgreSQL exposes `pg_current_xact_id()` (`xid8`, no
  wraparound) and `pg_snapshot_xmin(pg_current_snapshot())`: every transaction ID below `xmin` is
  committed or rolled back [V][pg-xact]. Returning only changes whose transaction ID is below the
  current `xmin` gives a safe high-water mark [?].
- **Optimistic concurrency:** `If-Match` with an ETag makes an update conditional; a mismatch must
  return 412, which prevents lost updates [V][rfc9110].
- **Audit approaches:**
  - *DB triggers* (Immich audit tables, generic tools like temporal tables) capture everything,
    including manual SQL, but don't know the actor or the reason (User vs Import vs auto-attach)
    unless the app sets a session variable (`SET LOCAL`) [?].
  - *Application-written Revisions* in the same transaction know the actor, the Import and the
    grouping needed to undo an Import, but can be bypassed by code that forgets them [?].
  - *Event sourcing* (events as the source of truth) gives full history but complicates every
    query, schema change and the summary/override logic; overkill for a logbook [?].
- **Soft deletes:** OpenDiving soft-deletes dives (`is_deleted`) but hard-deletes derived blobs and
  file rows, since a soft-deleted blob takes space nobody can read [V][od-dec].

### Recommendation

1. **Revisions in the application, one per change set:** a `revision` row (ID, actor type =
   User/Import/system, actor ID, Import ID, reason, created at, transaction ID) plus
   `revision_change` rows (entity, entity ID, field, old value, new value as JSONB). Written in the
   same transaction as the change through one repository layer. "Undo Import" = apply the inverse
   of all Revisions with that Import ID, raising Conflicts where later Revisions touched the same
   fields. Optionally add a cheap trigger that refuses writes to logbook tables without
   `SET LOCAL divehub.revision_id` to catch forgotten paths.
2. **Every syncable row** carries `id` (UUID, client-generatable — UUIDv7 suits ordering and index
   locality), `version` (int, +1 per change, used as ETag), `updated_at`, `deleted_at`
   (tombstone), `change_seq` (bigint) and `change_xid` (`xid8`). Unique constraints become partial
   (`WHERE deleted_at IS NULL`).
3. **Change feed:** `GET /sync/changes?cursor=…&limit=…` returns changed rows (or IDs + type) in
   `change_seq` order, limited to rows with `change_xid < pg_snapshot_xmin(pg_current_snapshot())`;
   the response's new cursor is the last `change_seq` returned. Scope is "everything this User may
   see" (managed Divers + Visibility). JSON Lines streaming and per-entity checkpoints, as Immich
   does, can come later.
4. **Scope changes** (Visibility revoked, Diver management removed) are emitted as "remove from
   scope" entries; if the server cannot compute them cheaply it returns `410 Gone` with
   "resync required". The same answer for cursors older than the tombstone retention (tombstones
   kept e.g. 180 days, then purged).
5. **Writes from clients:** `PATCH` with `If-Match: "<version>"`; 412 returns the current state.
   Offline mobile edits queue with their base version; on 412 the client (or server) does a
   field-level 3-way merge against the base Revision. Fields changed on only one side merge;
   fields changed on both sides become a conflict for the User.
6. **Fit with the model:** Revisions already store old/new values per field, which is exactly the
   base needed for the 3-way merge, for Imports (Scenario 3) and for mobile edits. Samples are not
   synced as rows; clients fetch a Recording's channels by ETag.
7. **Notifications** (worker → client) can reuse the feed: the client polls `/sync/changes` or an
   SSE endpoint that only says "new changes after cursor X".

## 4. Auth for web and mobile

### Findings

**Standards and OWASP**
- Passwords: argon2id with at least m = 19 MiB, t = 2, p = 1 (alternatives m = 12 MiB/t = 3,
  m = 9 MiB/t = 4); scrypt, bcrypt (≥ 10, 72-byte limit) and PBKDF2 (600,000 × HMAC-SHA-256, for
  FIPS) only as fallbacks [V][owasp-pw].
- NIST SP 800-63B-4: single-factor passwords at least 15 characters, 8 if used with MFA; allow at
  least 64; no composition rules; syncable passkeys are allowed at AAL2 [V][nist].
- Sessions: IDs with ≥ 64 bits of entropy; cookies `Secure`, `HttpOnly`, `SameSite=Strict` (or
  `Lax`), `__Host-` prefix; idle and absolute timeouts; new session ID after login; never store
  tokens in `localStorage`/`sessionStorage` [V][owasp-session].
- MFA: offer TOTP; passkeys/WebAuthn preferred (phishing-resistant); avoid SMS; single-use recovery
  codes; require re-authentication for password/e-mail change and disabling MFA [V][owasp-mfa].
- OAuth (for OIDC later): public clients MUST use PKCE; implicit grant SHOULD NOT be used; the
  password grant MUST NOT be used; refresh tokens of public clients MUST be rotated or
  sender-constrained [V][rfc9700]. Native apps must use the system browser, not an embedded
  web view; redirect via private-use scheme, claimed HTTPS URL or loopback; exact redirect match
  [V][rfc8252].
- OIDC: `iss` + `sub` together are the only stable identifier of a user; `sub` is never
  reassigned within an issuer [V][oidc-core]. E-mail is not a safe account-linking key.

**What self-hosted apps do**

| App | Sessions / tokens | Signup & bootstrap | OIDC / extras |
|---|---|---|---|
| Immich | Session records in PostgreSQL; token as `immich_access_token` cookie (web) or `Authorization: Bearer` (mobile); scoped API keys via `x-api-key` [S][immich-api] | "The first user to register will be the admin user" [V][immich-admin] | OIDC with auto-register, auto-launch, account linking; mobile redirect via `/api/oauth/mobile-redirect`; role/quota claims [V][immich-oauth] |
| Paperless-ngx | Django session (web), `Authorization: Token` (API, from `/api/token/` or profile), Basic, remote-user header, headless allauth for OIDC [V][paperless-api] | `PAPERLESS_ADMIN_USER/PASSWORD` creates a superuser at start; `PAPERLESS_ACCOUNT_ALLOW_SIGNUPS` defaults to false [V][paperless-config] | Social/OIDC via django-allauth; `PAPERLESS_DISABLE_REGULAR_LOGIN` once SSO is set up (API and Django admin still accept local credentials) [V][paperless-config] |
| Mealie | Login sessions last `TOKEN_TIME` = 48 h by default [V][mealie] | `ALLOW_SIGNUP` defaults to false (invitation tokens) [V][mealie] | OIDC off by default; `OIDC_SIGNUP_ENABLED` true; looks up existing users by the `email` claim by default; optional LDAP [V][mealie] |
| Vaultwarden | — | `SIGNUPS_ALLOWED`, domain allowlist, `SIGNUPS_VERIFY`; the admin can always invite; admin page protected by `ADMIN_TOKEN`, recommended as an Argon2 PHC hash [V][vw-signup] [S][vw-admin] | — |
| Jellyfin | Per-device access tokens in `Authorization: MediaBrowser Token=…, Client=…, Device=…, DeviceId=…, Version=…`; Quick Connect lets a signed-in device approve a new one by code [S][jellyfin-auth] | Setup wizard creates the admin [?] | Jellyfin 12 disables legacy `X-Emby-*` headers by default [?][jellyfin-auth] |
| divetracx | Built-in OAuth 2.1 server: mandatory S256 PKCE, refresh-token rotation with replay detection, hashed tokens; deployed behind an auth proxy [V][dtx] | — | — |
| OpenDiving | Passwordless (magic link, Google, WebAuthn table); refresh token in an `HttpOnly`, `SameSite=Lax` cookie; magic-link tokens stored as SHA-256 hashes, single use [V][od-dec] | Invitations table [V][od-dec] | — |

### Recommendation

1. **One session model for both clients:** opaque random token (≥ 128 bits), stored as SHA-256 in
   a `session` table (User, created, last used, expires, device name, IP, client type). Web gets it
   as `__Host-session` cookie (`Secure; HttpOnly; SameSite=Lax`) plus CSRF protection (Origin check
   or custom header); mobile sends `Authorization: Bearer`. The API accepts either. Sessions are
   listed and revocable in the UI. No JWTs: every request hits the DB anyway, and revocation is
   immediate.
2. **Lifetimes:** web sliding idle timeout (e.g. 7 days) and absolute limit (e.g. 30 days); mobile
   long-lived sliding session (e.g. 90 days) with token rotation on refresh. If the mobile app
   later uses OIDC/OAuth tokens, rotate refresh tokens with replay detection (RFC 9700).
3. **Personal access tokens** (scoped: e.g. `import:write`) for scripts, watched-folder agents and
   the CLI, as Immich and Paperless offer.
4. **Passwords:** argon2id (m = 19 MiB, t = 2, p = 1 or stronger), store the PHC string to allow
   re-hashing on login; min 15 chars without MFA (8 with), max ≥ 64, no composition rules,
   blocklist check; rate-limit and lock out per account + IP.
5. **MFA:** TOTP + recovery codes early; passkeys (WebAuthn) next, as second factor and later as
   passwordless login. Re-auth for sensitive actions. Instance setting "MFA required for admins".
6. **User creation:** invitation-only by default. Admin (or, by setting, any User) creates an
   invitation = single-use, hashed, expiring token, optionally bound to an e-mail; works without a
   mail server (copy link). Open signup is an instance setting, off by default.
7. **Admin bootstrap:** not "first user wins" (an exposed fresh instance can be claimed by anyone).
   Instead: `DIVEHUB_ADMIN_EMAIL`/`DIVEHUB_ADMIN_PASSWORD` env vars (Paperless style), or a one-time
   setup token printed to the log on first start and required by the setup page; plus a CLI
   command to reset an admin password.
8. **OIDC-ready schema now:** `user` holds no credentials; `password_credential (user_id, hash)`,
   `identity (user_id, issuer, subject, e-mail at link time)`, `webauthn_credential`, `session`.
   Login methods produce a session the same way. Later OIDC: hub is a confidential client to the
   IdP (authorization code + PKCE); auto-link by e-mail only if `email_verified` and the admin
   enabled it; options for auto-register, auto-redirect and disabling password login.
9. **Mobile + OIDC:** the app opens the system browser at `/auth/oidc/start?client=mobile` with a
   PKCE challenge; the hub completes the IdP flow and redirects to the app's scheme or claimed URL
   with a one-time code that the app exchanges (with the verifier) for a session token (RFC 8252).
   Phase 1 mobile can use direct password login against our own API (as Immich and Jellyfin do);
   this is not the OAuth password grant RFC 9700 forbids, since no third-party OAuth server is involved.

## Open points

- Exact channel list, integer scales and the per-sensor model for `recording_channel`; check
  real Garmin Descent FIT files for sample rates and sizes (the size estimate is unverified).
- Keep an uploaded zip as its own Original (provenance: "these 12 FIT files came from export X")
  or only its entries?
- Is the same Original shared across Users (stored once, linked twice) acceptable for privacy,
  e.g. for "has this file been uploaded by anyone" timing leaks? Per-User dedup (OpenDiving) avoids it.
- Glossary: a mobile-vs-hub edit clash is not a **Conflict** as defined (hub vs Source since the
  last Import). Widen the definition or add a term.
- Tombstone retention period and whether Revisions are ever pruned.
- Should Media use the same content-addressed store and upload path as Originals?
- Mail: invitations and password reset without SMTP (copy link) vs. requiring a mail relay.
- Whether the web client should use a BFF pattern; with a same-origin SPA served by the app image
  and `HttpOnly` cookies, it may be unnecessary.

## Sources

- PostgreSQL: [page layout][pg-page], [TOAST][pg-toast], [transaction ID functions][pg-xact]
- [TimescaleDB editions][tsdb-editions]
- [Subsurface `save-git.cpp`][ss-git]
- divetracx: [README][dtx], [schema][dtx-schema]
- OpenDiving API: [DECISIONS.md][od-dec], [`dive_profile.py`][od-profile]
- [FitTrackee workout model][ftt-model]; [Endurain activity streams model][endurain-model];
  [Dawarich schema][dawarich-schema]
- [tus 1.0 protocol][tus]; [IETF Resumable Uploads draft][rufh]
- [OWASP File Upload Cheat Sheet][owasp-upload]; [A better zip bomb][zipbomb]; [Zip bomb (Wikipedia)][zipbomb-wiki]
- [nginx `client_max_body_size`][nginx]; [Cloudflare upload limits][cf-limits]
- [Garmin export structure (garmin_export_converter)][garmin-export]
- [Immich Sync v2][immich-sync]; [Immich bulk upload check][immich-bulk]; [Immich API auth][immich-api];
  [Immich OAuth][immich-oauth]; [Immich post-install][immich-admin]
- [WatermelonDB backend sync][watermelon]
- [RFC 9110 (HTTP semantics, If-Match)][rfc9110]; [RFC 9700 (OAuth security BCP)][rfc9700];
  [RFC 8252 (OAuth for native apps)][rfc8252]; [OpenID Connect Core][oidc-core]
- OWASP: [Password Storage][owasp-pw], [Session Management][owasp-session], [MFA][owasp-mfa];
  [NIST SP 800-63B-4][nist]
- [Paperless-ngx API][paperless-api]; [Paperless-ngx configuration][paperless-config]
- [Mealie backend configuration][mealie]
- Vaultwarden: [disable registration][vw-signup], [admin token discussion][vw-admin]
- [Jellyfin API authorization][jellyfin-auth]

[pg-page]: https://www.postgresql.org/docs/current/storage-page-layout.html
[pg-toast]: https://www.postgresql.org/docs/current/storage-toast.html
[pg-xact]: https://www.postgresql.org/docs/current/functions-info.html
[tsdb-editions]: https://www.tigerdata.com/docs/about/latest/timescaledb-editions
[ss-git]: https://github.com/subsurface/subsurface/blob/master/core/save-git.cpp
[dtx]: https://github.com/michidk/divetracx
[dtx-schema]: https://github.com/michidk/divetracx/blob/main/src/db/schema.ts
[od-dec]: https://github.com/opendiving/opendiving-api/blob/main/DECISIONS.md
[od-profile]: https://github.com/opendiving/opendiving-api/blob/main/src/app/models/dive_profile.py
[ftt-model]: https://github.com/SamR1/FitTrackee/blob/main/fittrackee/workouts/models.py
[endurain-model]: https://github.com/joaovitoriasilva/endurain/blob/master/backend/app/activities/activity_streams/models.py
[dawarich-schema]: https://github.com/Freika/dawarich/blob/master/db/schema.rb
[tus]: https://tus.io/protocols/resumable-upload
[rufh]: https://datatracker.ietf.org/doc/draft-ietf-httpbis-resumable-upload/
[owasp-upload]: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
[zipbomb]: https://www.bamsoftware.com/hacks/zipbomb/
[zipbomb-wiki]: https://en.wikipedia.org/wiki/Zip_bomb
[nginx]: https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size
[cf-limits]: https://developers.cloudflare.com/cache/concepts/default-cache-behavior/
[garmin-export]: https://github.com/hensing/garmin_export_converter
[immich-sync]: https://immich.app/blog/sync-v2
[immich-bulk]: https://api.immich.app/models/AssetBulkUploadCheckItem
[immich-api]: https://api.immich.app/authentication
[immich-oauth]: https://docs.immich.app/administration/oauth/
[immich-admin]: https://docs.immich.app/install/post-install/
[watermelon]: https://watermelondb.dev/docs/Sync/Backend
[rfc9110]: https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match
[rfc9700]: https://www.rfc-editor.org/rfc/rfc9700.html
[rfc8252]: https://www.rfc-editor.org/rfc/rfc8252.html
[oidc-core]: https://openid.net/specs/openid-connect-core-1_0.html
[owasp-pw]: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
[owasp-session]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
[owasp-mfa]: https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
[nist]: https://pages.nist.gov/800-63-4/sp800-63b.html
[paperless-api]: https://github.com/paperless-ngx/paperless-ngx/blob/main/docs/api.md
[paperless-config]: https://github.com/paperless-ngx/paperless-ngx/blob/main/docs/configuration.md
[mealie]: https://mealie.io/documentation/getting-started/installation/backend-config/
[vw-signup]: https://github.com/dani-garcia/vaultwarden/wiki/Disable-registration-of-new-users
[vw-admin]: https://github.com/dani-garcia/vaultwarden/discussions/5407
[jellyfin-auth]: https://gist.github.com/nielsvanvelzen/ea047d9028f676185832e51ffaf12a6f
