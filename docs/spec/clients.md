---
title: Client contract
summary: What every client of the Dive Hub API must do (web client, native mobile app, scripts) - obligations first, then each area's duties and conventions; with reasons, ADRs and where the web client does it; plus server gaps found while writing it.
status: living
date: 2026-10-04
---

# Client contract

The API enforces what it can: who may see or change what, versions, validation, the last admin. Some duties
only a client can fulfil: what it shows, what it asks before acting, how it formats, what it forgets. They are
listed here, so a new client (the planned native mobile app) misses none of them. Decided in
[ADR 0022](../decisions/0022-merging-sites-and-site-list-paging.md); terms follow the [glossary](../glossary.md).

Written from a walk through every page and every API call of the web client (`apps/web/src`) on 2026-10-04.

**Keeping it current:** a change that gives clients a new duty updates this file in the same change
([AGENTS.md](../../AGENTS.md)).

**Must** marks an obligation: legal, privacy, security or data safety. **Should** marks a convention that
keeps clients consistent. Paths in *Web:* are under `apps/web/src`.

## 1. Obligations

### Licenses
- **Must show OpenStreetMap's Attribution wherever OSM data is shown.** A Dive site with an External ID
  from `osm` that `providesData` shows its `attribution` (text and link, from the API) on the site's page.
  A list that shows such sites carries it once. ODbL 1.0
  ([ADR 0021](../decisions/0021-site-external-ids-and-import.md)). *Web:* `SitesPage.tsx` (`SiteOrigin`,
  `OsmAttribution`), `lib/site-origin.ts`.
- **Must explain ODbL and get a confirmation before an OSM Site import** (`confirmOdbl`). The API refuses
  without the flag, but the explanation is the client's job (ADR 0021). *Web:* `SiteImportPage.tsx`.
- **Must take license, Attribution and link from the API** (`externalIds[].attribution`, `.url`), never
  hard-code them. They are defined once on the server (`src/sites/sources.ts`).

### Privacy
- **Must not show who else created, edited or dives at a Dive site.**
  - The API names only the signed-in User (`actor.type` `you`) and says `user` for anyone else. Don't fill in
    names from elsewhere ([ADR 0020](../decisions/0020-dive-sites.md)).
  - A merge tells a Dive's owner "Dive Hub" moved it (ADR 0022).
- **Must say that a site is shared** when creating or editing one, especially one made from a Dive's position.
  Every User sees a site's position, while a Dive's own position stays private (ADR 0020).
  *Web:* `SiteForm.tsx` (`sites.sharedHint`).
- **Must warn before merging sites that other Users' Dives move too,** without counting them (ADR 0022).
- **Must not send positions anywhere by itself.** "Open in maps" is a plain link the User follows. A map with
  tiles needs its own ADR first (tile source, privacy).

### Security
- **Must forget everything about the previous User** when the User changes: after sign-in, sign-out, setup,
  accepting an Invitation, using a reset link, or ending the current session. Drop every cached response;
  on a shared device the next person must see nothing. *Web:* `Account.tsx` (`useUserChanged`: `resetQueries`).
- **Must treat Invitation and password reset tokens as secrets.**
  - They travel in the URL fragment (`#/invite/<token>`, `#/reset/<token>`), never in a query string or a log
    ([ADR 0012](../decisions/0012-invitations-and-admin-bootstrap.md), [ADR 0013](../decisions/0013-account-management.md)).
  - Take them out of the address once used. *Web:* `useUserChanged` (`history.replaceState`).
  - Invitation and reset links an admin creates are shown once, to copy. Don't store them.
  *Web:* `Admin.tsx` (`LinkToPassOn`), `ui/Overlay.tsx` (`CopyField`).
- **Must not tell whether an e-mail address has an account.** A failed sign-in says "wrong e-mail or password".
  Only "too many attempts" (429) and "disabled" (`BANNED_USER`) get their own message. *Web:* `Account.tsx` (`SignIn`).
- **Changing the password ends the User's other sessions.** The server enforces it, whatever
  `revokeOtherSessions` says. Tell the User afterwards that their other sessions were signed out. *Web:* `AccountPage.tsx` (`ChangePassword`).
- **Must ask for the current password** to change it, and the server checks it (`INVALID_PASSWORD`).
- **Should let password managers work:** mark fields `username`, `current-password` and `new-password`, and on
  the invitation and reset forms include the (read-only) e-mail so the manager saves the pair.

### Data safety
- **Must send the version an edit started from:** the Dive's `version` for edits, moving it, the Primary
  recording and splitting off; the site's `version`; both sites' versions for a merge. On 409 `dive_changed` or
  `site_changed`, **offer to reload instead of overwriting**
  ([ADR 0015](../decisions/0015-overrides-vocabulary-and-browser-tests.md)). *Web:* `DiveEditForm.tsx`, `SiteForm.tsx`, `DiveDetail.tsx`.
- **Must confirm what can't be undone, and say what will happen:**

  | Action | Confirmation | *Web:* |
  |---|---|---|
  | Deleting a User | type the User's e-mail (`confirmEmail`; the server checks it) | `Admin.tsx` (`DeleteUserDialog`) |
  | Disabling a User; signing a User out everywhere | dialog | `Admin.tsx` |
  | Taking one's own admin role away | dialog: the Admin page disappears | `Admin.tsx` |
  | Signing out everywhere else; ending the current session | dialog | `AccountPage.tsx` |
  | Revoking an Invitation | dialog | `Admin.tsx` |
  | Deleting a Dive site | dialog | `SitesPage.tsx` |
  | Merging sites (no undo) | dialog with what moves and fills | `SitesPage.tsx` (`NearbySites`) |
  | Splitting a Recording off | dialog | `DiveDetail.tsx` |

  Discarding a Duplicate candidate is not confirmed. It offers **Undo** at once (reopen) and keeps a list of
  discarded ones ([ADR 0016](../decisions/0016-recording-decisions-and-divers.md)). *Web:* `Decisions.tsx`.
- **Should guard unsaved changes** when leaving a form, including through the address, and release the guard
  once saved before navigating. *Web:* `lib/leave-guard.ts` (`releaseLeaveGuard()`), `App.tsx` (`useRoute`).
- **Must send `null` to clear a field, and leave a field out to keep it.** The two mean different things in every
  PATCH. A Dive edit sends only the fields the User changed (`set`) and the ones to give back to the recording
  (`reset`); see [Dives](#dives).

## 2. Talking to the API
- **Sessions:**
  - The web client uses the session cookie on the same origin and sends an `Origin` header (Better Auth's CSRF checks).
  - A native client will use bearer tokens. That isn't built yet, and its ADR comes with the mobile app
    ([ADR 0011](../decisions/0011-better-auth.md)).
  - Only four Better Auth endpoints exist: sign-in, sign-out, get-session, change-password (ADR 0013).
- **On 401 anywhere, the session has ended:** show sign-in. Retry only network failures and 5xx, once; a 4xx
  stays the same. *Web:* `main.tsx`, `api.ts` (`shouldRetry`, `isUnauthorized`).
- **Must show errors by their `code`,** translated (`errors.<code>`), never the English `error` text, which is
  for logs ([ADR 0014](../decisions/0014-design-system-and-localization.md)).
  - The same goes for Import `reason`/`errorCode`, a Site import's `failureCode`, Revision `cause` and the
    device vocabulary (water type, dive mode, deco model, gas circuit).
  - A device value without our word shows as recorded, under "other values from the device".
- **Use the generated client or the OpenAPI document** (`/api/openapi.json`). Its enums are the complete lists
  to translate.
- **Background work is polled** until it is `done` or `failed`:
  - Imports (`GET /api/imports`), every second while one runs;
  - Site imports (`GET /api/admin/site-imports`), every two seconds.

  When one finishes, refresh what it changed (the logbook) and say so, for screen readers too.
  *Web:* `api.ts` (`importsQuery`, `siteImportsQuery`), `ImportPanel.tsx`, `SiteImportPage.tsx`.
- **Lists page** with `limit`/`offset` and `total` (`/api/dives` [ADR 0017](../decisions/0017-logbook-list-paging.md),
  `/api/dive-sites` ADR 0022). Keep search, filters, sort and page in the client's navigation state (the web
  client uses the address), so back and reload keep them. *Web:* `lib/logbook.ts`, `lib/sites-list.ts`.
- **Follow merged sites:** a site with `mergedInto` is gone. Open the kept site instead (ADR 0022).
- **Use the server's flags for what is allowed** (`canDelete`, `inUse`, `isOwn`, `diveCount`/`deviceCount`, the
  User's `role`). Don't offer what the server would refuse, but never rely on hiding it.

## 3. Area by area

### Signing in and the first start
- **First start:** if `GET /api/setup` says `needed`, show the setup form. Whoever has the setup token from the
  server log creates the first admin. Say where the token is (ADR 0012). *Web:* `Account.tsx` (`Setup`).
- **Invitations and reset links:** look the token up first (`/lookup`), then show for whom it is (the e-mail).
  An invalid, used or expired link says so and to ask the admin for a new one. *Web:* `AcceptInvitation`, `ResetPassword`.
- **Passwords:** 15 to 128 characters, enforced by the server. Say the rule beside the field
  ([ADR 0012](../decisions/0012-invitations-and-admin-bootstrap.md)). *Web:* `NewPasswordField`.
- **There is no self sign-up.** Say that access comes from an admin's Invitation.

### The User's account
- **Display settings:** language and units, each "same as the device" (null) or a choice, saved at once
  (`PATCH /api/me/preferences`). The UI follows them immediately, including number and date input.
  *Web:* `AccountPage.tsx`, `main.tsx` (`I18nProvider`), `App.tsx` (`useLanguage`).
- **Sessions:** list them with device, IP address, sign-in and last activity, and mark the current one. Ending
  another session is immediate; ending the current one is signing out. *Web:* `AccountPage.tsx` (`Sessions`).

### Admin
- **Admin pages only for admins.** The server refuses anyone else (`admins_only`).
- **Users:**
  - Don't offer to demote, disable or delete the last enabled admin, or to disable or delete oneself; the
    server refuses those too (ADR 0013).
  - No password reset links for disabled Users.
  - After an admin demotes themselves, refresh `me`: the navigation changes.
- **Admins never see other Users' Dives,** and the API gives them none. Don't build admin views that would need them.
- **Site imports:** see [Dive sites](#dive-sites).

### Imports
- **Files:** FIT files and zip archives (Garmin "Export Original", account exports), one file per request
  (`POST /api/imports`, multipart field `file`), up to the server's limit (413 `upload_too_large`).
  *Web:* `api.ts` (`uploadFile`), `lib/importable.ts`.
- **Name the files that weren't sent** (a dropped `.gpx`), so the User learns why they didn't arrive.
- **Each file's outcome:** created, attached, updated, unchanged ("already imported": the same User sent the same
  content before), Duplicate candidate, skipped (for example a Device of another User's Diver), failed. Link to
  the Dive where there is one, and say what became of a Duplicate candidate since. *Web:* `ImportPanel.tsx` (`ImportRow`).

### Dives
- **Overrides:**
  - A value set by hand is marked "edited", with what the recording says, as visible text and not a tooltip.
  - The User can give a field back to the recording (`reset`).
  - While editing, mark a field as edited while typing, not on blur (nothing should move under a pointer about
    to press Save). *Web:* `DiveDetail.tsx`, `DiveEditForm.tsx`.
- **Time:** a Dive's start is UTC plus the UTC offset at the dive. Show and edit it as the local time at the dive.
  The offset is edited in quarter hours. Without a known offset, the device's time zone stands in.
  *Web:* `DiveEditForm.tsx`, `lib/units.ts`.
- **Notes** are the Dive's own; an empty text clears them (`null`).
- **Recordings:**
  - Name them by their Device ("Garmin Descent Mk3 (777)"), not "Recording 2" (ADR 0016).
  - Show which one is primary. Changing it makes values without Override follow the new one.
  - The Dive's last Recording can't be split off; the server refuses (`last_recording`).
- **Moving a Dive** to another Diver the User manages names that Diver; the Dive's site and values stay.
- **History:** Revisions newest first, translated by `cause`. The web client groups one person's edits within ten
  minutes into one entry, and shows three entries before "Show the whole history". *Web:* `DiveHistory.tsx`, `lib/history.ts`.
- **The depth profile needs a text alternative:** a summary (deepest point and when, duration, temperature range)
  and the samples per minute as a table (WCAG 1.1.1). *Web:* `DepthProfile.tsx`, `lib/profile.ts`.
- **A Dive's position is private.** Show it only to the Users who manage the Diver, as the API does.

### Duplicate candidates
- **Show them where the User decides,** first on the logbook ("Needs your decision"), with the Recording (time,
  depth, duration, Device), why it waits (`reason`) and the Dives it might belong to (ADR 0016).
- **Three decisions:** add to one of those Dives, make it a Dive of its own, or discard. Discard offers Undo, and
  discarded ones can be shown and reopened. *Web:* `Decisions.tsx`.
- **Several candidates at once:** every button names the Recording or Dive it acts on (in its accessible name).

### Divers and Devices
- **Divers:**
  - A User's own Diver is marked and can't be deleted.
  - Other Divers can be deleted only while they have no Dives and no Devices; offer it only then.
  - Two Divers with the same name are allowed, but warn about it.
  - *Web:* `DiversPage.tsx`.
- **Devices:** assigning one to another Diver affects only Imports from then on (ADR 0016). Say so where it is
  changed; single Dives move with "Move".
- **The logbook offers a Diver filter only when the User keeps several Divers,** and then shows the Diver column.

### Dive sites
- **Shared and editable by every User** (ADR 0020). Deleting is for the creator or an admin while no Dive is
  there: use `canDelete` and `inUse`, and say why it can't be deleted.
- **Creating a site from a Dive's position** pre-fills the position and says it becomes visible to every User.
  *Web:* `SitePicker.tsx`.
- **Choosing a site for a Dive:** offer the sites within 2 km of the Dive's position (nearest first, with
  distance), or search by name. "No dive site" is a choice. *Web:* `SitePicker.tsx`.
- **SSI site ID:** accept what SSI's QR code says ("site:3314") as well as the number, and send the digits.
  `external_id_taken` means another site has it.
- **Where a site comes from:** "From OpenStreetMap: node/…" with the Attribution, "Also in …" for a reference,
  nothing for a site made here ([Licenses](#licenses)).
- **Merging:** offer the other sites within 200 m. Explain before confirming, then follow the kept site
  ([Privacy](#privacy), [Data safety](#data-safety)).
- **Site imports (admins):**
  - sources, area (country, box or everywhere) and the language of names;
  - the ODbL explanation and confirmation for OSM;
  - one import at a time (`site_import_running`);
  - progress while running;
  - counts and the new sites near existing ones when done, each linked.

## 4. Showing values
- **Units:** values come in SI (metres, seconds, °C, WGS84 degrees). Show them in the User's units
  (`preferences.units`, else the device's region) and language (`preferences.language`, else the device's).
  *Web:* `lib/display.ts` (`useDisplay`), `lib/units.ts`.
- **Accept input in the User's units and number format** ("18,5" in German), and send SI.
- **Positions** look like "28.4950° N, 34.5160° E": four decimals, with the hemisphere letters in the UI language.
  **Countries** are ISO codes, named in the UI language. **Distances** are in m or km (ft or mi for imperial).
  *Web:* `lib/geo.ts`.
- **Dates and times** follow the UI language. A Dive's time is the local time at the dive ([Dives](#dives)).
- **Words:** use the [glossary](../glossary.md)'s terms and their German words. German uses "du".

## 5. Accessibility and feel
- **WCAG 2.2 AA:** contrast, labels, keyboard, one h1 per screen and a title per page, focus on the new page's
  heading after navigation, announcements for results ([design system](design-system.md#rules-every-page-follows)).
  A native app follows the platform's equivalents (VoiceOver, TalkBack, Dynamic Type). *Web:* `lib/page.ts`, `lib/announce.ts`.
- **Focus never falls to nothing:** when a row or button disappears, focus goes to the next row or the panel's
  heading; when a form closes, back to the button that opened it. *Web:* `lib/focus.ts`.
- **Buttons repeated per row name their row** in their accessible name ("Revoke: anna@example.com").
- **Icons always beside text,** never icon-only controls ([ADR 0018](../decisions/0018-icons-and-motion.md)).
- **Motion only where it explains,** and none with reduced motion (ADR 0018).
- **Errors never time out,** and notices can be dismissed (WCAG 2.2.1, 4.1.3; AGENTS.md). Standing text that waits
  for a confirmation is not a notice, because notices are announced (the ODbL terms).

## 6. Server gaps found while writing this
Rules that only the web client kept. Both moved to the server on 2026-10-04, so no client can break them:
- **Changing a password ends the other sessions.** Only the client's `revokeOtherSessions: true` did it, although
  ADR 0013 says they end. The server now forces it (`src/auth/auth.ts`, `hooks.before`).
- **Import failures are codes only.** A failed file's `message` (the parser's own words: English, internal
  details) and a failed Import's `error` text were in the API, and the web client showed them. The API now
  sends `reason` and `errorCode` only. The detail stays in the database, and the worker logs it
  (`import file failed`).

## Open for the mobile client
- Authentication with bearer tokens or the Expo integration (ADR 0011), and how a phone finds a self-hosted
  instance (its URL).
- Uploading from the phone: the share sheet, files from a watch app, large account exports (resumable uploads,
  [architecture](architecture.md#open-questions)).
- Offline use, sync and conflict handling ([data, sync, upload](../research/2026-10-02-data-sync-upload-auth.md)).
- Push notifications for finished Imports.
