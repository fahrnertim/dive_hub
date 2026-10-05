---
title: Client contract
summary: What every client of the Dive Hub API must do (web client, native mobile app, scripts) - obligations first, then each area's duties and conventions; with reasons, ADRs and where the web client does it; plus server gaps found while writing it.
status: living
date: 2026-10-05
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
- **Must explain SSI's missing licence and get a confirmation before an SSI Site import** (`confirmSsi`): SSI gives no
  licence for its list (unlike OSM, no conditions make copying allowed); in the EU it is protected as a database, so
  copying large parts can infringe SSI's rights; importing is the operator's decision and risk; what is taken and what
  is never stored. Show it as standing text with a checkbox, not as a notice. The API refuses without the flag
  (`ssi_not_confirmed`) ([ADR 0025](../decisions/0025-ssi-site-import-and-site-water-type.md)). *Web:* `SiteImportPage.tsx`.
- **SSI data shows "From SSI" without a link** (`url` is null, no Attribution): SSI has no page per site.

### Privacy
- **Must not show who else created, edited or dives at a Dive site.**
  - The API names only the signed-in User (`actor.type` `you`) and says `user` for anyone else. Don't fill in
    names from elsewhere ([ADR 0020](../decisions/0020-dive-sites.md)).
  - A merge tells a Dive's owner "Dive Hub" moved it (ADR 0022).
- **Must say that a site is shared** when creating or editing one, especially one made from a Dive's position.
  Every User sees a site's position, while a Dive's own position stays private (ADR 0020).
  *Web:* `SiteForm.tsx` (`sites.sharedHint`).
- **Must warn before merging sites that other Users' Dives move too,** without counting them (ADR 0022).
- **Must say what Dive Hub keeps for a Provider** before connecting ([ADR 0024](../decisions/0024-ssi-target-via-app-api.md),
  [ADR 0027](../decisions/0027-providers-as-adapters.md)): that it signs in for the User (for SSI: through an interface SSI
  doesn't support); and, for password sign-in, the choice between keeping the password (encrypted) and keeping only the
  Provider's sign-in, which can expire at any time. Offer the choice only when the Provider's `signIn.canKeepPassword` is
  true, and default to not keeping it. Offer "Disconnect", and say that dives already there stay there. *Web:* `Connections.tsx`.
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
- **Must treat a Provider's password or token as the Provider's** (ADR 0024, 0027): send it only to
  `POST /api/connections/{provider}` and `POST /api/connections/{id}/sign-in`, never keep it on the device, and keep
  password managers from saving it as the Dive Hub password (`autocomplete="off"`). The API never sends it, or the
  Provider's access, back. *Web:* `Connections.tsx`.
- **Should let password managers work:** mark fields `username`, `current-password` and `new-password`, and on
  the invitation and reset forms include the (read-only) e-mail so the manager saves the pair.

### Data safety
- **Must send the version an edit started from:** the Dive's `version` for edits, moving it, the Primary
  recording, splitting off, deleting and restoring it; the site's `version`; both sites' versions for a merge. On 409 `dive_changed` or
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
  | Deleting a Dive | dialog: it leaves the logbook, can be restored, isn't imported again; asks about SSI too (see [Dives](#dives)) | `DeleteDive.tsx` |
  | Deleting a deleted Dive's copy at a Provider | dialog: SSI's app can't bring it back | `DeletedDives.tsx` |

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
- **Render Providers from `GET /api/providers`** ([ADR 0027](../decisions/0027-providers-as-adapters.md)): its list is
  the instance's, and it changes only with the server (cache it for the session). Offer a Connection panel per Provider
  whose `signIn.kind` isn't `none`, with the fields that kind asks for (`password`: login as `signIn.login` says, and
  password; `token`: the token), and a panel on the dive page per Provider whose `data.dives.export` is set. Offer only the
  operations it lists (no "Update" or "Delete in …" without `update`/`delete`), show its `notices`, and name it by `name`.
  *Web:* `lib/providers.ts`, `Connections.tsx`, `ProviderPanel.tsx`.
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
- **Connections** (ADR 0024, 0027, `GET /api/connections`): one per Diver and Provider. Show the account
  (`accountLabel`), whether the password is kept, and the state. `needs_sign_in` means the Provider no longer accepts the
  sign-in: offer "Sign in again" (password and the choice again, or a new token). Connections made before slice 13 start
  in this state once. *Web:* `Connections.tsx`.
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
  content before), Duplicate candidate, skipped (for example a Device of another User's Diver, or `deleted_earlier`: the
  dive was deleted, say where to restore it), failed. Link to the Dive where there is one, and say what became of a
  Duplicate candidate since. *Web:* `ImportPanel.tsx` (`ImportRow`).

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
- **Deleting a Dive** ([ADR 0026](../decisions/0026-deleting-dives.md), `DELETE /api/dives/{id}` with `version`):
  - **Must say what happens** before: it leaves the logbook, its counts and search; it can be restored; importing its
    file again doesn't bring it back. *Web:* `DeleteDive.tsx`.
  - **Must ask about every Provider the Dive is at in the same dialog** (`GET /api/dives/{id}/providers`, each `current`):
    "Delete here and in SSI" (`alsoAt: ['ssi']`) or "Delete only here", saying SSI's app can't bring it back. Without a
    Connection for its Diver at a Provider, say it stays there and don't offer deleting it there. Don't preselect either.
  - **On a provider_* error the Dive stays here:** say so with the reason, and offer both again. With several Providers
    each is checked before any is deleted, so usually nothing was deleted; but when one fails after another's copy was
    deleted, the refusal's `providers` says so (`copy: deleted`): say which copy is gone. *Web:* says "Nothing was
    deleted", which holds while SSI is the only Provider that deletes.
  - Afterwards leave the dive page (it answers 404 now) and say what happened (`providers`: each with `copy` `deleted` or
    `kept`), with **Undo** (restore), which doesn't time out. Undo brings it back here only. *Web:* `DeletedDives.tsx`.
- **Deleted dives** (`GET /api/dives/deleted`): offer to restore them (`POST /api/dives/{id}/restore` with `version`).
  - **Must remind while a deleted Dive is still at a Provider** (`stillAt` not empty): say so on the Dive with "Delete
    in SSI" per Provider (`DELETE /api/dives/{id}/providers/{provider}`, confirmed), and where the User lands (the logbook).
    The reminder may be dismissed for a visit; it comes back while the dive is there. *Web:* `DeletedDives.tsx`.
- **History:** a restored Dive's history shows "Deleted" and "Restored" (causes `delete`, `restore`; their change
  `deletedAt` needs no line of its own). *Web:* `DiveHistory.tsx`.
- **History:** Revisions newest first, translated by `cause`. The web client groups one person's edits within ten
  minutes into one entry, and shows three entries before "Show the whole history". *Web:* `DiveHistory.tsx`, `lib/history.ts`.
- **The depth profile needs a text alternative:** a summary (deepest point and when, duration, temperature range)
  and the samples per minute as a table (WCAG 1.1.1). *Web:* `DepthProfile.tsx`, `lib/profile.ts`.
- **A Dive's position is private.** Show it only to the Users who manage the Diver, as the API does.
- **Water type** (ADR 0025): the Dive's `waterType` is its site's and can't be edited on the Dive. Without a site,
  suggest choosing one; with a site that has none, say it isn't known for the site. Label the Recording's
  `summary.waterType` as the computer's water setting ("Water setting on the computer"), not as the Dive's water.
  *Web:* `DiveDetail.tsx` (`WaterFact`, `RecordingDetails`).
- **Must say when the computer was set to other water** (`waterMismatch`): name both ("Your computer was set to salt
  water; this site is fresh water.") and how the depths read: `depthPercent` negative reads shallow, positive deep,
  rounded ("about 2 % shallow"); `null` means they may read a little off. Depths are not corrected. *Web:* `DiveDetail.tsx`.

### Sending a Dive to a Provider (SSI)
From `GET /api/dives/{id}/providers/{provider}` and the Provider's capabilities (ADR 0024, 0027). *Web:* `ProviderPanel.tsx`.
- **Show where the Dive is there:** not there yet, or its dive number there and when it was sent, with "changed since
  sent" when `current.upToDate` is false. Offer "Send to SSI", or "Update in SSI" when the Provider offers `update`.
  A Provider with `delivery: handed_over` gives no ID back: say when it was handed over, and that sending again adds
  another copy there.
- **Without a Connection** for the Dive's Diver, say so and lead to the account page. With `needs_sign_in`, or the
  error `provider_sign_in_needed`, lead to signing in again.
- **The Dive site's ID at the Provider's site Source may be needed** (`needsSiteIdFrom`, value `siteExternalId`). For SSI,
  offer the sites of the User's SSI logbook, nearest first (`GET /api/dives/{id}/providers/ssi/sites`, which asks SSI, so
  only on request), and typing the ID; save it on the site (`PATCH /api/dive-sites/{id}`, `ssiSiteId`). Without a site,
  ask for one first.
- **`outcome: exists`:** nothing was sent; a dive at the same time is there. Show it (number, time, depth, minutes)
  and ask: link to it (`onExisting: link`) or send a new one (`create`).
- **Must show the Provider's `notices`:** `shows_unconfirmed` means it shows the dive as unconfirmed (SSI: only a dive
  center can confirm it there).
- **Must ask before "Delete in SSI"**, saying SSI's app can't bring it back and the Dive stays here. Deleting the Dive
  itself asks about every Provider in its own dialog ([Dives](#dives)).
- **Show what went wrong:** the latest Push's `failureCode` (with the Provider's name), and its read-back `differences`
  (fields stored differently, named by the Provider's `readBackFields`; show an unknown one by its name). A history of
  Pushes is optional; `remoteGone` on a confirmed delete means it was already deleted there.
- **Translate provider_* codes with the Provider named** (`providerName` in the answer). *Web:* `lib/display.ts` (`useProblemText`).

### Duplicate candidates
- **Show them where the User decides,** first on the logbook ("Needs your decision"), with the Recording (time,
  depth, duration, Device), why it waits (`reason`) and the Dives it might belong to (ADR 0016).
- **Three decisions:** add to one of those Dives, make it a Dive of its own, or discard. Discard offers Undo, and
  discarded ones can be shown and reopened. *Web:* `Decisions.tsx`.
- **No Dives left** (they were deleted, ADR 0026): say so; making it a Dive of its own and discarding remain.
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
- **Choosing a site for a Dive:** a search field with the results under it, updated while typing: before typing
  the sites within 2 km of the Dive's position (nearest first, with distance), then the matches by name, with how
  many match. Mark the current site. Picking a result saves it at once (with the Dive's version); removing the site
  is its own action. When nothing matches, offer to create the site with the typed name: no dead end.
  *Web:* `SitePicker.tsx`, `ui/SearchList.tsx`.
- **Choosing the SSI site** works the same way over the sites in the User's SSI logbook; an SSI ID typed into the
  field can be used even when the logbook doesn't have it. *Web:* `ProviderPanel.tsx` (`SitePicker`).
- **SSI site ID:** accept what SSI's QR code says ("site:3314") as well as the number, and send the digits.
  `external_id_taken` means another site has it.
- **Water type** (fresh, salt, brackish, or not known): **the form must say that changing it changes the water type of
  every Dive at the site** (other Users' too). After saving, refresh the Dives a client holds. *Web:* `SiteForm.tsx`.
- **Where a site comes from:** "From OpenStreetMap: node/…" with the Attribution, "From SSI: 3314" without a link,
  "Also in …" for a reference, nothing for a site made here ([Licenses](#licenses)). An SSI reference without an
  offer is shown as the SSI site ID field only.
- **Offers** (ADR 0025): a reference with `offered` values gets "Use SSI's data" (any Source, any User). Before
  confirming, say which empty fields take the Source's values and which filled ones stay although the Source differs,
  and that the site then says "From …" and imports keep those fields current. `POST /api/dive-sites/{id}/adopt` with
  the version; `site_offer_not_found` means it was taken meanwhile. *Web:* `SitesPage.tsx` (`SiteOrigin`).
- **Merging:** offer the other sites within 200 m. Explain before confirming, then follow the kept site
  ([Privacy](#privacy), [Data safety](#data-safety)).
- **Site imports (admins):**
  - sources (OSM, Wikidata, SSI), area (country, box or everywhere), the language of names, and "only fill dive
    sites that are already here" (`createSites: false`);
  - the ODbL explanation and confirmation for OSM, and the SSI explanation and confirmation ([Licenses](#licenses));
  - one import at a time (`site_import_running`);
  - progress while running;
  - counts and findings when done, each linked: new sites near existing ones, and hand-made sites that now offer a
    Source's data. A worldwide run can report thousands; show a first part and how many more.

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
