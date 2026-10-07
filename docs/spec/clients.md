---
title: Client contract
summary: What every client of the Dive Hub API must do (web client, native mobile app, scripts) - obligations first, then each area's duties and conventions; with reasons, ADRs and where the web client does it; importing dives from a Provider (settings, preview, decisions, outcome), times without a time zone, Dives without a Recording; the dive assessment (findings as facts with sources, the fixed note, no score); AI accesses (what to say before one is made, the key once, the log) and the MCP endpoint (what it promises LLM clients); plus server gaps found while writing it.
status: living
date: 2026-10-06
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
- **Must say that Divers' names are seen by every User** where a Diver is added or picked ([ADR 0028](../decisions/0028-shared-divers-and-participants.md)):
  every User of the instance sees every Diver's name, and nothing else about Divers they don't keep.
  *Web:* `Participants.tsx` (`participants.sharedHint`), `DiversPage.tsx` (`divers.othersIntro`).
- **Must not show or keep more of a Provider's people than name and account** ([ADR 0029](../decisions/0029-push-requirements-and-buddies.md)):
  the buddy list routes give only those; say so where the list is shown. *Web:* `ProviderBuddies.tsx` (`provider.buddiesKept`).
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
  - Only four Better Auth endpoints exist: sign-in, sign-out, get-session, change-password (ADR 0013). AI access
    keys work only at `/mcp`, never for `/api`.
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
- **Must ask before claiming an external Diver** (ADR 0028, amended): connecting answers `provider_account_held` when an
  external Diver here holds the account (`diver`: its name and on how many Dives it is). Say so and ask whether that is
  the User; on yes, connect again with the same sign-in and `claim: true` (the external Diver merges into the Diver being
  connected, and its Dives then list that Diver). Say that nothing of those Dives becomes the User's. `provider_account_taken`
  (another User's Diver has the account) can't be claimed. *Web:* `Connections.tsx` (`ConnectForm`).
- **Display settings:** language and units, each "same as the device" (null) or a choice, saved at once
  (`PATCH /api/me/preferences`). The UI follows them immediately, including number and date input.
  *Web:* `AccountPage.tsx`, `main.tsx` (`I18nProvider`), `App.tsx` (`useLanguage`).
- **Sessions:** list them with device, IP address, sign-in and last activity, and mark the current one. Ending
  another session is immediate; ending the current one is signing out. *Web:* `AccountPage.tsx` (`Sessions`).

- **AI access** (ADR 0035, `GET /api/me/ai-access`): a User lets an LLM client read their logbook through the
  [MCP endpoint](#the-mcp-endpoint).
  - **Must say what leaves the instance before an access is made:** whatever the assistant reads goes to its provider
    under that provider's terms: the User's Dives with profiles and notes, their Divers, the Dive sites, the names of
    the people they dived with (other people's data), and the Dives' positions only if granted. Say that it can only
    read. When a later slice returns more (body weight, slice 19), the text gains it in the same change.
  - `enabled: false`: an admin has not switched it on. Say so; offer nothing to create (`ai_access_off`). Existing
    accesses are still listed and can be revoked.
  - **Positions are an opt-in** (`positions: true`), unticked by default, with what it means next to it.
  - **Must show the key exactly once** (`key` of `POST /api/me/ai-accesses`), say that it can't be shown again and
    that whoever has it can read the logbook. Don't store it (no local storage, no log), don't put it into text that
    is announced or sent anywhere. Offer copy-ready lines for the common clients with `endpoint` and the key.
  - List accesses with name, what they may read, created and last use; revoking asks first and says the key stops at
    once and the log stays.
  - **Show the log** (`GET /api/me/ai-access-log`): time, access, tool, arguments, rows, outcome, newest first. It
    covers revoked accesses and reaches back 90 days; `arguments` never holds search words (`[text]`).
  *Web:* `AiAccess.tsx`, `lib/ai-access.ts`.

### Admin
- **AI access** (`GET`/`PUT /api/admin/ai-access`): the switch for the instance, off by default. Say what switching on
  means (Users' data can go to AI providers at their request) and, before switching off, that every key stops at once
  and works again when switched back on. "Revoke all" (`DELETE /api/admin/ai-accesses`) asks first and can't be undone.
  Admins see how many accesses exist, never whose or what they read. *Web:* `AiAccess.tsx` (`AiAccessSetting`).
- **Admin pages only for admins.** The server refuses anyone else (`admins_only`).
- **Users:**
  - Don't offer to demote, disable or delete the last enabled admin, or to disable or delete oneself; the
    server refuses those too (ADR 0013).
  - No password reset links for disabled Users.
  - After an admin demotes themselves, refresh `me`: the navigation changes.
- **Admins never see other Users' Dives,** and the API gives them none. Don't build admin views that would need them.
- **Site imports:** see [Dive sites](#dive-sites).

### Imports
- **Files:** FIT files (Garmin; the Suunto app's FIT export), the Suunto app's JSON export and zip archives of them
  (Garmin "Export Original", account exports), one file per request. The server recognises a file by its content, not
  its name ([ADR 0037](../decisions/0037-suunto-file-import-and-file-formats.md)): don't filter more strictly than by
  the endings `.fit`, `.json`, `.zip`, and tell Suunto owners that the JSON holds far more than the FIT.
  (`POST /api/imports`, multipart field `file`), up to the server's limit (413 `upload_too_large`).
  *Web:* `api.ts` (`uploadFile`), `lib/importable.ts`.
- **New words to translate (ADR 0037):** reasons `no_dive_file` (and the older `no_fit_file`, still on stored Imports: same
  text) and `fuller_copy_here` (a `skipped` file whose dive is already here from a fuller file; it carries the Dive to
  link to); deco models `suunto_fused_rgbm`, `suunto_fused2_rgbm` (proper names); computer events
  `safety_stop_mandatory`, `deep_stop_started`, `deep_stop_broken`, `tank_pressure_low`. A Dive from a Suunto file has no
  number until the User gives it one.
- **Name the files that weren't sent** (a dropped `.gpx`), so the User learns why they didn't arrive.
- **Each file's outcome:** created, attached, updated, unchanged ("already imported": the same User sent the same
  content before), Duplicate candidate, skipped (for example a Device of another User's Diver, or `deleted_earlier`: the
  dive was deleted, say where to restore it), failed. Link to the Dive where there is one, and say what became of a
  Duplicate candidate since. *Web:* `ImportPanel.tsx` (`ImportRow`).
- **An import from a Provider** (`provider` set, [ADR 0030](../decisions/0030-importing-dives-from-providers.md)) is named
  by the Provider ("Dives from SSI"; `uploadName` is its name) and has one outcome per dive there (`remoteId`,
  `remoteNumber`), often dozens: sum them up by result and reason rather than listing each. Its own results and reasons:
  `linked` (a logbook entry tied to a Dive here and filled where it was empty), `sent_by_dive_hub`, `no_match` (the import
  only adds), `ambiguous` (several Dives here and no decision that still fits; say to choose one in the preview),
  `left_out` (the User's decision). *Web:* `ImportPanel.tsx` (`ProviderImportSummary`).

### Dives
- **Overrides:**
  - A value set by hand is marked "edited", with what the recording says, as visible text and not a tooltip.
  - The User can give a field back to the recording (`reset`).
  - While editing, mark a field as edited while typing, not on blur (nothing should move under a pointer about
    to press Save). *Web:* `DiveDetail.tsx`, `DiveEditForm.tsx`.
- **Time:** a Dive's start is UTC plus the UTC offset at the dive. Show and edit it as the local time at the dive.
  The offset is edited in quarter hours. Without a known offset, the device's time zone stands in.
  *Web:* `DiveEditForm.tsx`, `lib/units.ts`.
  - **`utcOffsetSource: unknown`** ([ADR 0030](../decisions/0030-importing-dives-from-providers.md)): the start is a local
    time logged without a time zone and kept as if it were UTC. Show it in UTC without an offset (as it was logged), never
    in the browser's time zone. The Dive, the dive list and the deleted Dives carry `utcOffsetSource`.
  - **Must say where the time zone came from** when it isn't the device (`position`: where the dive was; `nearby`: the
    Diver's dives in the days around it; `unknown`: the time is shown as logged), unless the User set the start by hand
    (`startsAt` in `overrides`). *Web:* `DiveDetail.tsx` (`TimeZoneNote`).
- **Notes** are the Dive's own; an empty text clears them (`null`).
- **Recordings:**
  - Name them by their Device ("Garmin Descent Mk3 (777)"), not "Recording 2" (ADR 0016).
  - Show which one is primary. Changing it makes values without Override follow the new one.
  - The Dive's last Recording can't be split off; the server refuses (`last_recording`).
  - **A Dive without a Recording** (`recordings` empty, ADR 0030) was made from a Provider's logbook entry
    (`fromProvider`): say so, naming the Provider, and that the dive computer's file adds its Recording, which then becomes
    primary and its values replace these. There is no profile. *Web:* `DiveDetail.tsx` (`NoRecording`).
- **Moving a Dive** to another Diver the User manages names that Diver; the Dive's site and values stay.
  - **A Dive linked to a Provider moves as a copy** ([ADR 0038](../decisions/0038-logbook-checks-and-merging-dives.md)):
    the answer of `POST /api/dives/{id}/move` then has another `id`. **Must say so before** (the Dive is at a Provider
    when `GET /api/dives/{id}/providers` has a `current`): it moves as a copy, the dive here goes to the deleted dives,
    so that Provider's next import doesn't bring it back. Afterwards show the Dive of the answer; the old one answers 404
    and is listed in `GET /api/dives/deleted` with `movedTo`. *Web:* `DiveDetail.tsx` (`MoveDialog`).
- **Merging two Dives** ([ADR 0038](../decisions/0038-logbook-checks-and-merging-dives.md)): the same descent logged twice
  (a logbook entry and its computer's file whose times didn't match at first, or two entries).
  - **Must say on a Dive that another Dive of its Diver was at the same time** (`GET /api/dives/{id}/merge-candidates`
    not empty): show that Dive (time, duration, depth, site, with or without a recording), link to it, and offer to merge
    the two. Never merge unasked: two overlapping Dives can be two dives with wrongly typed times.
  - **Must say which Dive is kept, before the dialog and in it** (`keeps`: the one with a Recording when only one has,
    else the Dive asked about). Name each of the two by what tells it from the other (time, duration, depth, site, with or
    without a recording), not as "this dive" and "the other": on the logbook both are listed. *Web:* the hint on the
    dive page says which stays, a pair on the logbook marks it ("stays when merged"), and the dialog lists "Stays:" and
    "Goes to “Deleted dives”:".
  - **Must say before merging** that the kept Dive takes over what it lacks from the other (recordings, site, buddies, values; the other's notes
    are appended), that a link to a Provider goes to the kept Dive (`at`, where it has none itself), and that the other
    goes to the deleted dives and can be restored.
  - **Must ask about each Provider both Dives are at** (`bothAt`), in the same dialog, as when deleting: the dive of the
    one not kept stays there unless the User chooses to delete it there too (`alsoAt`). Without a Connection it stays.
    On a provider_* error nothing is merged: say so with the reason.
  - `POST /api/dives/{id}/merge` with `version`, `otherId`, `otherVersion` (`dive_changed` 409, `merge_not_possible` 400
    for the same Dive or Dives of two Divers). **The answer is the kept Dive, which may be the other one: follow its
    `id`.** *Web:* `MergeDive.tsx`.
- **Deleted dives that went somewhere** (`mergedInto`, `movedTo` in `GET /api/dives/deleted`): say that the Dive was
  merged into another or moved to another Diver, with a link to that Dive. Restoring one brings it back without the
  Recordings and links it gave away. *Web:* `DeletedDives.tsx`.
- **History:** a merge is the cause `merge` on the kept Dive (changes `mergedFrom`, the values, site, notes and
  `participants` it took, `providers` for each link taken over), after an `attach` per Recording that came across; the
  other Dive's last entry is `merge` with `mergedInto`. A Dive moved as a copy starts with `move` and `movedFrom`; the old
  one ends with `move` and `movedTo`. These changes name deleted Dives: tell them, don't link them. *Web:* `DiveHistory.tsx`.
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
- **History:** an import from a Provider writes `fill` (what a Dive lacked, from the Provider's dive: `site`,
  `participants`, `notes`); a Dive made from a logbook entry starts with `import-create` and the change `fromProvider`;
  the change `utcOffsetSource` names where the time zone came from before and after. *Web:* `DiveHistory.tsx`.
- **History:** Revisions newest first, translated by `cause`. The web client groups one person's edits within ten
  minutes into one entry, and shows three entries before "Show the whole history". *Web:* `DiveHistory.tsx`, `lib/history.ts`.
- **The depth profile needs a text alternative:** a summary (deepest point and when, duration, temperature range)
  and the samples per minute as a table (WCAG 1.1.1). *Web:* `DepthProfile.tsx`, `lib/profile.ts`.
- **A Dive's position is private.** Show it only to the Users who manage the Diver, as the API does.
- **Participants** (ADR 0028, `participants` on the Dive): buddies, guides and instructors (`role`), any Diver of the
  instance but the Dive's own. Add them from a live search over every Diver by name (`GET /api/divers/search`, saying
  which are the User's own, another User's or external), or as a new external Diver by the typed name
  (`POST /api/external-divers`), and save the whole list with the Dive's version (`PUT /api/dives/{id}/participants`;
  `dive_changed` 409, `participant_invalid` for a Diver twice or the Dive's own). A role can be changed in place (the same
  route, the whole list). Every remove button and role field names the person. The history shows who was added (with the role) and who was removed (change `participants`).
  *Web:* `Participants.tsx`, `DiveHistory.tsx`.
- **Water type** (ADR 0025): the Dive's `waterType` is its site's and can't be edited on the Dive. Without a site,
  suggest choosing one; with a site that has none, say it isn't known for the site. Label the Recording's
  `summary.waterType` as the computer's water setting ("Water setting on the computer"), not as the Dive's water.
  *Web:* `DiveDetail.tsx` (`WaterFact`, `RecordingDetails`).
- **Must say when the computer was set to other water** (`waterMismatch`): name both ("Your computer was set to salt
  water; this site is fresh water.") and how the depths read: `depthPercent` negative reads shallow, positive deep,
  rounded ("about 2 % shallow"); `null` means they may read a little off. Depths are not corrected. *Web:* `DiveDetail.tsx`.

### The dive assessment
Dive Hub comments on a diver's practice here, so the wording is part of the contract (ADR 0036). `GET /api/dives/{id}/assessment`
returns findings from fixed rules; the client words them.

- **Must show the fixed note with every assessment.** In sight, always: not medical advice; no measure of how safe a
  dive was; with symptoms, call DAN or the emergency services. One step away from it (a dialog, a sheet, a page), the
  full text: that decompression sickness can happen within every limit, and which symptoms to watch for. A client
  without "one step away" (a script, the MCP tool) gives the full text every time
  ([ADR 0036, amendment of 2026-10-07](../decisions/0036-dive-assessment.md#amendment-2026-10-07-compact-presentation-ui-redesign-slice-a)).
  *Web:* `Assessment.tsx` (`FixedNote`).
- **May show a finding as one row and its details on demand,** and findings of severity `info` behind one line that
  counts and names them. Then the row says what was measured, and nothing a finding has is left out of its details.
- **Must not show or compute a score,** a grade, a colour for the whole dive, or a ranking of dives by findings. At most
  a count ("2 findings").
- **Must word a finding as facts:** what was measured (from `values`, in the User's units), the guidance it is held
  against, how strong the evidence is (`evidence`), where it comes from (`sources`, as links), and a recommendation.
  No blame ("you failed to"), no medical claims ("risk of DCS", "dangerous", "unsafe"), no alarm colour: `caution` is
  a word, not red. An empty list means nothing stands out, not that the dive was safe.
- **`values` are metres, seconds, m/min (`*_m_min`), bar and percent;** convert depths and rates for the User. A rule
  can have more than one sentence (a stop that is short, missing, or shorter than the 5 minutes advised): choose by the
  values. *Web:* `lib/assessment.ts`, texts under `assessment.*`.
- **Show where on the profile** a finding is (`startSeconds`, `endSeconds`, on the Recording `recordingId`, the Primary
  one); findings about the dive as a whole have none. When `sampleIntervalSeconds` is 5 or more, say that short fast
  stretches can be missing.
- **Dismiss and mute:** `dismissed` findings and those of a `muted` rule leave the main list and the logbook's mark, and
  stay reachable with a way back; muting asks first and names the Diver. Neither changes what was computed.
- **The logbook's mark** is `findings` on each Dive of `GET /api/dives` (notes and cautions not put aside); show it as
  text, not as a colour or an icon alone.
- **The no-fly time** (`noFly`, on the last dive of a diving day, else null) is information beside the findings: show it
  apart from them with its `source`, don't count it, and offer nothing to dismiss.
- **Muted rules are listed with their Diver** (`mutedRules` of `GET /api/divers`), each with a way to show it again: a
  muted rule shows on no Dive, so the User needs a place to find it. *Web:* `DiversPage.tsx` (`MutedRules`).
- **Computer events** (`computerEvents`) are what the dive computer noted. Show them apart from the findings ("your
  computer noted"), never merged, and without the client's own judgement.
- **The profile's colours** (`ascentBands`: above 4, 9 and 18 m/min) need a legend and the same in words; they must not
  rest on colour alone.
- `applies: false`: the rules don't cover this kind of dive; say so. `current: false`: the Dive waits to be assessed with
  newer rules; say so and offer to reload.
- *Web:* `Assessment.tsx`, `DepthProfile.tsx`, `DiveList.tsx`.

### Sending a Dive to a Provider (SSI)
From `GET /api/dives/{id}/providers/{provider}` and the Provider's capabilities (ADR 0024, 0027). *Web:* `ProviderPanel.tsx`.
- **Show where the Dive is there:** not there yet, or its dive number there and when it was sent, with "changed since
  sent" when `current.upToDate` is false. Offer "Send to SSI", or "Update in SSI" when the Provider offers `update`.
  A Provider with `delivery: handed_over` gives no ID back: say when it was handed over, and that sending again adds
  another copy there.
- **Without a Connection** for the Dive's Diver, say so and lead to the account page. With `needs_sign_in`, or the
  error `provider_sign_in_needed`, lead to signing in again.
- **Must show what the Provider needs first** ([ADR 0029](../decisions/0029-push-requirements-and-buddies.md)): the status's
  `unmet` lists each requirement the Dive doesn't meet, from Dive Hub's data alone. While a `blocking` one is unmet, don't
  offer sending (the server refuses with `provider_requirements_unmet` and `unmet`); an `advisory` one is sent without.
  Offer the fix per `type`, from the Provider's `requirements` in `GET /api/providers`:
  - **`site_external_id`:** `siteId: null` means choose a site first. Otherwise, when `typed`, offer the Provider's sites
    nearest first (`GET /api/dives/{id}/providers/{provider}/sites`, which asks the Provider, so only on request) and
    typing the ID (accept the `prefixes`, check against `pattern`); save it on the site
    (`PUT /api/dive-sites/{id}/external-ids/{source}`). When not `typed`, say it can't be fixed here.
  - **`diver_mapping`:** one item per Participant (`diverName`) the Provider can't identify; say they will be left out
    (advisory) or that sending waits (blocking). With `fixes` containing `diver_external_id` and a Provider offering
    `buddies` `find`, offer finding the person in the account's list (`GET /api/connections/{id}/buddies`, only entries
    with an `account` and no `diver`), and save that account on the Diver (`PUT /api/divers/{id}/external-ids/{source}`;
    `diver_external_id_taken` names the Diver that has it: say so). Fixes a client doesn't know are ignored.
  - **An unknown `type`:** show the requirement's `description` and that it can't be fixed here.
- **Must say who a Push left out** (the latest Push's `leftOut`), by name and `reason`: `no_reference` (the Provider
  can't tell who they are) or `not_at_provider` (SSI: not in the User's buddy list; say to add them in SSI's app, by
  scanning their buddy QR code, then update).
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

### Importing dives from a Provider (SSI)
From the Connection (`diveImport` on `GET /api/connections`, null when the Provider imports no dives) and the
Provider's capabilities (`dives.import` with `list`), [ADR 0030](../decisions/0030-importing-dives-from-providers.md).
*Web:* `ProviderDiveImport.tsx`, under the Connection.
- **What the import may do**, saved on the Connection (`PATCH /api/connections/{id}` with `diveImport`): `mode` off (the
  default), `add` (only link and fill Dives here, never create) or `create` (also create Dives Dive Hub doesn't have),
  and the matching window, 5, 15, 30 or 60 minutes. Explain each choice: Dives here are never overwritten; the Provider
  only fills what they lack. Name the Diver when the User keeps several.
- **Preview first** (`GET /api/connections/{id}/dive-import`, only on request: it reads the Provider, one paced action;
  `provider_import_off` while the mode is off). Show:
  - the counts that aren't zero, each with what happens: `recordings` (from a dive computer, like a file), `link`,
    `create`, `decide`, `linked` (filled where still empty), `ours` (sent from Dive Hub, stay), `deleted` (stay deleted),
    `noMatch` (left out because the import only adds), `unreadable`;
  - **every computer** (`computers`) with its `choice`, recordings or only logbook entries, saved at once on the
    Connection (`PATCH` with `diveImport.computers`), which refreshes the preview. Say why the suggestion is entries when
    `fromFiles` (Dive Hub has the computer's files, which are more exact), and that `otherDiver` computers come in as
    entries whatever the choice;
  - **the sites the dives name** (`sites`): here already, the same site here by name and position (it gets the
    Provider's ID), to be made from the Provider's data, or missing; with `missing` and not `sitesAllowed`, say an admin
    can allow making them and that running the import again then gives the dives their sites;
  - **dives changed at the Provider** (`counts.changed`): say that Dive Hub takes those changes;
  - **every field changed in both places** (`conflicts`, ADR 0030 amended): the Dive (number, else its time), the field,
    Dive Hub's value and the Provider's (`hub`, `provider`: a site's or people's names, a local "YYYY-MM-DD HH:MM", a
    number in metres, °C or seconds, or text), with "keep Dive Hub's" preselected; send each choice as `conflicts` with the
    start (`hub` or `provider`). A conflict kept isn't asked again until the Provider changes the field again;
  - **every entry to decide** (`decisions`): the Provider's dive (its number, its local time as logged, depth, duration)
    and the Dives here (`candidates`, closest first, each named by its number, time, depth, duration, site), "A new dive"
    only with mode `create`, and "Leave it out", preselected.
- **Start** (`POST /api/connections/{id}/dive-import` with `computers` and `decisions`; 202 with the Import): poll the
  Import until it is done and sum up its outcome; refresh the logbook then. It can be run again: linked dives take what
  changed only at the Provider (`updated`), are filled where still empty, and keep what changed only here.
- **Must not suggest it overwrites what was changed here** (only what changed at the Provider alone, or what the User
  chose in a conflict), and must not show the Provider's people by more than their name (the
  server keeps only accounts; nothing else of them reaches the client).

- **Admins: sites from a Provider's site data** (`GET /api/admin/provider-site-data`; `PUT …/{provider}`): must show the
  Provider's missing licence and that allowing it is the operator's decision and risk, and send `confirm: true` only after
  the admin ticked that (`provider_site_data_not_confirmed`); show who allowed it and when, and offer stopping it.
  *Web:* `Admin.tsx` (`ProviderSiteData`).

### Logbook checks
([ADR 0038](../decisions/0038-logbook-checks-and-merging-dives.md); `GET /api/logbook-checks`, computed each time)
- **Must show them where the User lands after an import** (the logbook), in the same place as Duplicate candidates: each
  is a pair of Dives of one Diver at the same time (`dive`, `other`), with the reason (`rule`:
  `recording_beside_entry`, a Dive without a Recording beside one with a Recording; `overlapping_dives`). Show both Dives
  (time, depth, duration, site, with or without a recording, the Diver when the User keeps several) and link to them.
- **Never merge unasked.** Offer per pair: merge (the merge dialog of [Dives](#dives), with `other.keeps` and
  `other.bothAt`), and "they are two dives" (`PUT /api/logbook-checks/answer` with both ids and `two_dives`). Say that a
  wrong time or a Dive of another Diver is corrected on the Dive itself (edit, move, delete).
- **"They are two dives" can be taken back:** offer Undo right away (`answer: null`), and list the answered pairs
  (`status=answered`) with "Ask again". The server asks again by itself once one of the two changes its start.
- **Pairs marked `obvious`** (an import would have put them together; no dive left over at a Provider) may be merged in
  one go, after saying what that does and how many. Not the others. *Web:* from two such pairs on.
- A Recording split off its Dive, or made a Dive of its own from a Duplicate candidate, is answered by the server as two
  dives: such a pair is not listed until it is asked about again.
- The dive page's hint (`merge-candidates`) leaves out pairs with `answered`.
- The checks change with every import, edit, merge, move and delete: read them again then. *Web:* `LogbookChecks.tsx`,
  `Decisions.tsx` (their query sits under the dives').

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
  - Other Divers can be deleted only while they have no Dives and no Devices and are on no Dive; offer it only then
    (`diver_not_empty`).
  - Two Divers with the same name are allowed, but warn about it.
  - *Web:* `DiversPage.tsx`.
- **Other divers** (external, ADR 0028; `GET /api/external-divers`): anyone renames them; offer deleting only with
  `canDelete` and not `inUse` (`diver_not_deletable`, `diver_in_use`). Say which services an account is known at
  (`accounts`), never the account itself. *Web:* `DiversPage.tsx` (`OtherDivers`).
- **Admins merge an external Diver into another** (`POST /api/admin/divers/{id}/merge` with `into`), the same person, e.g.
  a buddy without an account who became a User: pick the other Diver by name, say it can't be undone. `diver_not_external`
  for a Diver a User keeps; `diver_external_id_taken` when both have different accounts at one service. *Web:*
  `DiversPage.tsx` (`MergeDialog`).
- **A Provider's list of people** (`buddies` `find`; SSI's buddy list) under its Connection, read only on request
  (`GET /api/connections/{id}/buddies`): who is a Diver here already, adding entries as external Divers one by one or
  all at once (`POST …/buddies/import` with `accounts`), and linking an entry to a Diver here instead
  (`PUT /api/divers/{id}/external-ids/{source}`). An entry without `account` can't be added. *Web:* `ProviderBuddies.tsx`.
- **Devices from a Provider:** importing a Provider's dives from a computer creates its Device for the Connection's
  Diver, the same Device the computer's own files find later (ADR 0030); list it like any other.
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
- **Typed site IDs** (ADR 0029): the site form offers a field per `site_external_id` requirement whose Source is `typed`
  (SSI today), worded by the Provider, and saves it with `PUT /api/dive-sites/{id}/external-ids/{source}` after the site
  itself (it doesn't change the site's version). The server accepts the `prefixes` ("site:3314") and keeps the bare ID;
  `external_id_taken` means another site has it, `site_source_not_typed` a Source whose IDs only an import brings.
  When creating, a failed ID must not create the site twice on the next try.
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

## The MCP endpoint

An LLM client is an API client Dive Hub can't make follow this contract, so the endpoint carries the rules itself
([ADR 0035](../decisions/0035-mcp-connector.md)). What it promises, and what a client or model gets:

- **Where:** `POST {base URL}/mcp`, MCP over Streamable HTTP, stateless (no session id). It answers the 2026-07-28
  revision and 2025-era clients (`initialize`, then `tools/list` and `tools/call`, each a request of its own). GET and
  DELETE answer 405. A request with an `Origin` other than the instance's gets 403.
- **Sign-in:** `Authorization: Bearer <key of an AI access>`. Otherwise **401** with `WWW-Authenticate: Bearer` and a
  JSON body `{ error: "invalid_token", error_description }` that says what to do: no key sent, the key unknown or
  revoked, AI access switched off on the instance, or the User disabled. **429** with `Retry-After` after 120 requests
  in a minute. A session cookie is not accepted. There is no OAuth yet, so claude.ai and ChatGPT can't connect.
- **Read-only:** no tool changes anything; each call runs in a read-only database transaction. Tools carry
  `readOnlyHint`.
- **Whose data:** only the Dives of the Divers the access's User manages. A Dive on which one of them was a buddy is
  someone else's and is never returned; an unknown, deleted or foreign id all answer "not found". Deleted Dives never
  count. Admins get nothing more.
- **Positions:** a Dive's own entry and exit position (`entry_position`, `exit_position`) only with the
  `logbook:positions` scope; without it the fields are absent from results and from the output schemas listed. A Dive
  site's shared position is returned with `logbook:read`.
- **Text other Users wrote is marked:** fields named `shared_*` (`shared_name`, `shared_description`,
  `shared_water_body`) hold site texts and other Divers' names. The instructions and every tool description tell the
  model to treat them as data and never follow instructions in them. A client that shows results **should** keep that
  distinction visible. The User's own Divers come as `name`, their own notes as `notes`.
- **Attribution:** `sites_get` returns each Source's attribution (such as "© OpenStreetMap contributors") and asks the
  model to name it when it passes the site's data on (see [Licenses](#licenses)).
- **Tools** (names, descriptions and schemas are fixed in code, never built from data): `logbook_search_dives`,
  `logbook_get_dive`, `logbook_get_dive_assessment`, `logbook_stats`, `sites_search`, `sites_get`, `divers_buddies`,
  `divers_list`. Each has an output
  schema; a result carries `structuredContent` and the same JSON as text.
- **Units and times:** metres, °C, minutes. `start_local` is the wall-clock time where the dive was (null when the time
  zone is unknown), `start_utc` the instant (null when only the wall clock is known, [Dives](#dives)). A client that
  shows values converts them for its user as [Showing values](#4-showing-values) says.
- **Size:** a result stays under 40,000 characters. Lists page with `limit` and an opaque `cursor` (`next_cursor` in the
  answer, absent on the last page; `total` and `count` always). `detail=detailed` returns more per item on smaller
  pages. A Dive's samples come only with `include_samples`, downsampled (the peaks are kept).
- **Errors are tool results** (`isError`) whose text says what to do next: the wrong argument and the valid ones, which
  tool finds a valid id, to narrow a query that took longer than 8 seconds. Never internals.
- **Everything is logged for the User:** each tool call with its arguments (search words replaced), rows and outcome.
- **The dive assessment** comes with its rules for the model in the tool's description and its fixed note in every
  result: no score, findings as facts with their source, no verdict on a dive's safety ([above](#the-dive-assessment)).
- **Not a planner:** the instructions say that Dive Hub's numbers are a record, not advice on whether a dive is safe.
  The planning tools of later slices carry their assumptions and disclaimer in every result.

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
- **Changing the API once a mobile client ships:** an installed app stays old for months, so a rule for versions or for
  keeping a field for a while needs an ADR first. Until then, as with `ssiSiteId` and `needsSiteIdFrom` (ADR 0029),
  there is one way to do a thing and replaced fields go in one step.
