---
title: Client contract
summary: What every client of the Dive Hub API must do (web client, native mobile app, scripts) - legal and privacy obligations first, then conventions; with reasons, ADRs and where the web client does it.
status: living
date: 2026-10-04
---

# Client contract

The API enforces what it can: who may see or change what, versions, validation. Some duties only a client can
fulfil: what it shows, what it asks before acting, how it formats. They are listed here, so a new client (the
planned native mobile app) misses none of them. Decided in [ADR 0022](../decisions/0022-merging-sites-and-site-list-paging.md);
terms follow the [glossary](../glossary.md).

**Keeping it current:** a change that gives clients a new duty updates this file in the same change
([AGENTS.md](../../AGENTS.md)).

Each rule says **must** (an obligation: legal, privacy or data safety) or **should** (a convention that keeps
clients consistent), and where the web client (`apps/web/src`) does it.

## 1. Obligations

### Licenses
- **Must show OpenStreetMap's Attribution wherever OSM data is shown.** A Dive site with an External ID
  from `osm` that `providesData` shows its `attribution` (text and link, from the API) on the site's page.
  A list that shows such sites carries it once. ODbL 1.0
  ([ADR 0021](../decisions/0021-site-external-ids-and-import.md)). *Web:* `SitesPage.tsx` (`SiteOrigin`,
  `OsmAttribution`), `lib/site-origin.ts`.
- **Must show the ODbL explanation and get a confirmation before an OSM Site import** (`confirmOdbl`). The
  API refuses without it, but the explanation is the client's job (ADR 0021). *Web:* `SiteImportPage.tsx`.
- **Must take license, Attribution and link from the API** (`externalIds[].attribution`, `.url`), never hard-code
  them. They are defined once on the server (`src/sites/sources.ts`).

### Privacy
- **Must not show who else created, edited or dives at a Dive site.** The API names only the signed-in User
  (`actor.type` `you`) and says `user` for anyone else. Don't try to fill in names from elsewhere
  ([ADR 0020](../decisions/0020-dive-sites.md)).
- **Must say that a new site is shared** when creating one, especially from a Dive's position. Every User
  sees a site's position, while a Dive's own position stays private (ADR 0020). *Web:* `SiteForm.tsx` (`sites.sharedHint`).
- **Must warn before merging sites that other Users' Dives move too**, without counting them (ADR 0022).
- **Must treat Invitation and password reset tokens as secrets.** They travel in the URL fragment
  (`#/invite/<token>`, `#/reset/<token>`), never in a query string or a log
  ([ADR 0012](../decisions/0012-invitations-and-admin-bootstrap.md), [ADR 0013](../decisions/0013-account-management.md)).
  A copy link is shown once.
- **Must not send positions anywhere by itself.** "Open in maps" is a plain link the User follows. A map with
  tiles needs its own ADR first (tile source, privacy).

### Data safety
- **Must send the version an edit started from** (Dive `version`, site `version`, both sites' versions for a
  merge), and on 409 `dive_changed` or `site_changed` **offer to reload instead of overwriting**
  ([ADR 0015](../decisions/0015-overrides-vocabulary-and-browser-tests.md)). *Web:* `DiveEditForm.tsx`, `SiteForm.tsx`.
- **Must confirm hard-to-undo actions** and say what will happen: deleting a site or a User, discarding a
  Duplicate candidate, splitting a Recording off, merging sites (no undo). *Web:* `ConfirmButton`, `ConfirmDialog` (`ui/Overlay.tsx`).
- **Should guard unsaved changes** when leaving a form, and release the guard once saved before navigating.
  *Web:* `lib/leave-guard.ts` (`releaseLeaveGuard()`).
- **Must send `null` to clear a field**, and leave a field out to keep it. The two mean different things in every PATCH.

## 2. Talking to the API
- **Sessions:**
  - The web client uses the session cookie on the same origin and sends an `Origin` header (Better Auth's
    CSRF checks).
  - A native client will use bearer tokens. That isn't built yet, and its ADR comes with the mobile app
    ([ADR 0011](../decisions/0011-better-auth.md)).
  - Only the four Better Auth endpoints in the OpenAPI document exist (ADR 0013).
- **On 401, ask the User to sign in again.** Retry only network failures and 5xx, once. A 4xx stays the same.
  *Web:* `api.ts` (`shouldRetry`, `isUnauthorized`).
- **Must show errors by their `code`,** translated (`errors.<code>`), never the English `error` text, which
  is for logs ([ADR 0014](../decisions/0014-design-system-and-localization.md)). The same goes for Import
  `reason`/`errorCode`, a Site import's `failureCode` (an error code), Revision `cause` and device vocabulary
  (water type, dive mode, deco model, gas circuit).
  - Values without our word are shown as recorded ("other values from the device").
- **Use the generated client or the OpenAPI document** (`/api/openapi.json`). Enums there are the complete
  lists to translate.
- **Background work is polled:** an Import (`GET /api/imports/:id`) or a Site import
  (`GET /api/admin/site-imports/:id`) until it is `done` or `failed`. Say when it finishes; screen readers
  need it too.
- **Lists page:** `limit`/`offset` with `total` (`/api/dives` ADR 0017, `/api/dive-sites` ADR 0022). Keep sort,
  filters and page in the client's navigation state (the web client uses the address), so back and reload keep them.
- **Follow merged sites:** a site with `mergedInto` is gone. Open the kept site instead (ADR 0022).
- **Use the server's flags for what is allowed** (`canDelete`, `inUse`, the User's `role`) instead of
  recomputing the rules.
- **Uploads:** multipart, one file per request in the field `file`. FIT files or zip archives, up to the
  server's limit (413 `upload_too_large`). The answer comes before processing; poll the Import.

## 3. Showing values
- **Units:** values come in SI (metres, seconds, °C, WGS84 degrees). Show them in the User's units
  (`preferences.units`, else the device's region) and language (`preferences.language`, else the device's).
  *Web:* `lib/display.ts` (`useDisplay`), `lib/units.ts`.
- **Accept input in the User's units and number format** ("18,5" in German), and send SI.
- **A Dive's time** is UTC plus the UTC offset at the dive. Show the local time at the dive, not the device's
  time zone (gap A8 in the [data model](data-model.md)).
- **Positions** look like "28.4950° N, 34.5160° E", four decimals, with the hemisphere letters in the UI
  language. **Countries** are ISO codes, named in the UI language. *Web:* `lib/geo.ts`.
- **Distances** are in m or km (ft or mi for imperial). *Web:* `lib/geo.ts` (`formatDistance`).
- **SSI site IDs:** accept what SSI's QR code says ("site:3314") as well as the number, and send digits.
- **Names:** Recordings are named by their Device, not "Recording 2" ([ADR 0016](../decisions/0016-recording-decisions-and-divers.md)).
  Use the [glossary](../glossary.md)'s words and its German words.

## 4. Accessibility and feel
- **WCAG 2.2 AA:** contrast, labels, keyboard, focus after navigation, one h1 per screen, announcements for
  results ([design system](design-system.md#rules-every-page-follows)). A native app follows the platform's
  equivalents (VoiceOver, TalkBack, Dynamic Type).
- **Icons always beside text,** never icon-only controls ([ADR 0018](../decisions/0018-icons-and-motion.md)).
- **Motion only where it explains,** and none with reduced motion (ADR 0018).
- **Errors never time out,** and notices can be dismissed (WCAG 2.2.1, 4.1.3; AGENTS.md).

## Open for the mobile client
- Authentication with bearer tokens or the Expo integration (ADR 0011), and how a phone signs in to a
  self-hosted instance (its URL).
- Offline use, sync and conflict handling ([data, sync, upload](../research/2026-10-02-data-sync-upload-auth.md)).
- Push notifications for finished Imports.
