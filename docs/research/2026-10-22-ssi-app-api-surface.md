---
title: SSI app API surface (app 5.0.43)
summary: The app's whole API client, recovered from its compiled code with Blutter (Dart 3.12.2): 61 `what` calls on `a21.php`, 2 on `m21.php`, 12 course calls with their own method names, 4 firmware calls, 2 AI calls and 3 cache files, each with its HTTP verb and the parameter names it sends. 43 of the 61 are not in the docs yet. Which fields are required is still not known; the app's code gives parameter names but no required flag, and the server decides the rest.
status: open
date: 2026-10-22
---

# SSI app API surface (app 5.0.43)

Asked by the owner (2026-10-22): document as much of SSI's API as possible so that Dive Hub can be checked against it
later. No code is written and nothing was sent to SSI. Markers as in the [SSI reference](../references/ssi-app-api.md):
**[R]** seen ourselves, **[S]** reported, **[?]** not known.

## Answer

- **The phone has the same build as the emulator** [R]: `com.divessi.ssi` 5.0.43, version code 588. The
  [bulk upload note](2026-10-10-ssi-app-bulk-upload.md) read the same version.
- **The app's API client is fully recovered [R].** Blutter (below) rebuilt the `SSIAPI` class
  (`core/services/api/ssi_api.dart`, a Chopper service): every method with its HTTP verb, `what` value, the names of
  its query and body parameters, and the two other endpoints it uses. 61 distinct `what` values; 43 are not in the
  docs ([tables](#calls-on-a21php-all-of-them-recovered-from-the-clients-methods)).
- **Parameter names, not requiredness.** The client says what is sent. It has no "required" flag; Chopper does not
  have one. Whether SSI refuses a call without a parameter, or a dive without a field, is decided by the server and
  is known only from calls we made ([the reference](../references/ssi-app-api.md#saving-whatsave_divelog)).
- **My first pass in this note (strings only) listed 85 names; 25 were real calls and 60 were screen texts or other
  strings** [R]. That list is gone; the real calls are in the tables below.

## How it was read

- **The files.** `adb pull` of the five APK files of the phone's install (base, arm64, de, en, xxhdpi); kept outside
  this repository in `D:\Git\divebridge\.tmp\ssi-5.0.43\` (git-ignored there).
- **REA** (installed 2026-10-22): `identify_flutter_build` and `inspect_dart_aot` confirm a Flutter app with a Dart
  FullAOT snapshot (hash `ace654289f5abc240509fc941453ebc5`). On this Windows machine none of REA's engines can open
  an ELF file (Ghidra takes PE only, Hopper is not supported on Windows), and REA has no Dart parser, so REA stops
  there.
- **Blutter** (`github.com/worawit/blutter`, MIT, commit `4a60ac6` of 2026-08-18; not part of REA) read the snapshot:
  Dart **3.12.2**, Android arm64. It rebuilds the Dart VM for that version, then prints each library's classes and
  methods as annotated assembly with the string constants each method loads (`asm/`), plus the object pool
  (`pp.txt`, `objs.txt`). 3,717 files, 321 MB, 21 functions it could not analyse. Two local steps were needed on
  this machine: Visual Studio 2022's C++ workload, and `/Zc:preprocessor` added to the MSVC options in Blutter's
  `scripts/CMakeLists.txt` (Dart 3.12's source uses `__VA_OPT__`). Output is in
  `D:\Git\divebridge\.tmp\ssi-5.0.43\blutter_out\`, not in this repository.
- **The calls were read** by listing, per method of `SSIAPI`, the string constants it loads. A method signature shows
  no types (`/* No info */`), so a parameter's type and nullability are not known from this.
- **The capture** of 2026-10-10 (`samples/private/HTTPToolkit_2026-10-10_15-12.har`, git-ignored, 407 entries) shows
  what the server answered; no tokens or personal values were copied here.

## Hosts and endpoints

| Where | What | Marker |
|---|---|---|
| `https://api.divessi.com/app` + `/a21.php?what=<call>` | the API; reads are GET, writes are POST with the body in the form field `json_data` | [R] |
| `https://api.divessi.com/app` + `/m21.php?what=<call>` | a second file used only for the e-mail and password change | [R] name, not captured |
| `/APP_CACHE_GEAR.zip`, `/APP_CACHE_CENTER.zip`, `/APP_CACHE_SITES.zip` | first-install caches, no sign-in | [R] |
| `/firmware/…`, `/firmware_test/…`, `/firmware_dev/…` | firmware update checks for SSI's own dive computers (`update_check/`, `languages/`) | [R] names; host not read [?] |
| `/api/aia/chat`, `/api/aia/ping` | the course AI chat; carries a fixed bearer token in the app (not recorded here) | [R] names; host not read [?] |
| the course server (probably `training.divessi.com`, polled 41 times in the capture) | one URL with `method=<Name>&type=u&rest=p`; see below | [R] names; the host is a guess [?] |
| `my.divessi.com` | pictures, downloads, certificate pictures (`/cert/<ccard_uid>`), web pages (help, privacy, imprint, delete account, online diver check) | [R] |
| `cdn.divessi.com` | icons, campaign and blog images | [R] |
| `nominatim.openstreetmap.org` | place search | name in code [R] |
| `checkip.amazonaws.com`, `icanhazip.com`, `one.one.one.one` | public address and connection checks | [R] |

## How the app talks to the API

- **Interceptors** (`core/services/api/`): `DefaultParametersInterceptor` (adds the fixed parameters, see
  [Endpoint](../references/ssi-app-api.md#endpoint-and-fixed-parameters)), `ConnectivityInterceptor`,
  `SSIUrlInterceptor`, `ApiConfigInterceptor`, `ServerMaintenanceInterceptor` and `UnauthenticatedInterceptor`. The
  last two are cases of their own in the app; **how SSI signals maintenance and an expired sign-in is not yet read**
  (the code is in `server_maintenance_interceptor.dart` and `unauthenticated_interceptor.dart`) [?].
- **Sync** (`core/synchronisation/`): one class per area, each a download, an upload or both, on one queue.
- **Local copy:** SQLite through `drift` (`core/models/…/*.drift.dart`; the dive table `DiveTable` and the data class
  `RawDive`).

## Calls on `a21.php` (all of them, recovered from the client's methods)

Verb and parameters are as the client sends them [R]. "Param" is a query parameter on a GET, or a query parameter next
to `json_data` on a POST. **Ref** says whether the docs already name the call (yes / no).

### Account and profile

| `what` | Verb | Param | Ref |
|---|---|---|---|
| `authenticate` | GET | `l`, `p` | yes |
| `signup` | POST | `json_data` | no |
| `check_user_exist` | GET | `fn`, `ln`, `dob` | no |
| `validate_email` | GET | `email` | no |
| `request_password` | GET | `l` | no |
| `request_ott` | POST | – | no |
| `get_user_data` | GET | – | yes |
| `profile_update` | POST | `json_data` | no |
| `save_image` (`type=user_with_check`) | POST | `json_data` | no |
| `privacy_settings_update` | POST | `json_data` | no |
| `save_privacy` (privacy policy accepted) | POST | `json_data` | no |
| `request_support` (the feedback form) | POST | `json_data` | no |
| `profile_update_email`, `profile_update_pwd` (on **`m21.php`**) | POST | `json_data` | no |

### Logbook

| `what` | Verb | Param | Ref |
|---|---|---|---|
| `get_divelog` | GET | – (the fixed parameters) | yes |
| `save_divelog` | POST | `json_data` | yes |
| `divelog_verify`, `divelog_unverify` | POST | `json_data` | no |
| `get_divelog_history`, `set_divelog_history` | GET, POST | – / `json_data` | yes |
| `get_libdivecomputer_support_matching` | POST | `json_data` | no |
| `save_user_divecomputer` | POST | `json_data` | no |

**`get_divelog_vars` has no method in this client [R].** Dive Hub calls it directly (2026-10-08) and the server
answers; the app gets its condition lists elsewhere (`get_vars`, `get_tables_21`) [?].

### Buddies, gear, sites, centres

| `what` | Verb | Param | Ref |
|---|---|---|---|
| `get_buddies` | GET | – | yes |
| `save_buddy` | POST | `json_data` | yes |
| `search_buddy` | GET | `string` | no |
| `get_gear` | GET | – | yes |
| `save_gear` | POST | `json_data` | yes |
| `delete_gear` | POST | `gear_id` | yes |
| `save_image` (`type=gear`) | POST | `json_data` | no |
| `delete_gear_image` | POST | `gear_id`, `image_id` | no |
| `get_gearsets` | GET | – | yes |
| `save_gearset` | POST | `json_data` | yes |
| `get_divesites_global` | GET | `limit`, `offset`, `last_sync` | yes |
| `get_divesite` | GET | `dsid` | no |
| `get_divesite_details` | GET | `site_id` | no |
| `save_divesite`, `save_divesite_descr` | POST | `json_data` | no |
| `save_image` (`type=divesite`) | POST | `json_data` | no |
| `get_dc_data` (dive centres near a place) | GET | `lat`, `lon` | no |
| `getaffiliations` | GET | – | no |
| `masterdc`, `transfer`, `affiliate`, `deaffiliate` | GET | `dc` | no |

### Certifications, courses, reference data, social, content

| `what` | Verb | Param | Ref |
|---|---|---|---|
| `get_ccards` | GET | – | yes |
| `get_available_courses` | GET | – | ADR 0050 only |
| `get_emergency_contacts` | **POST** | – | no |
| `save_emergency_contact` | POST | `json_data` | no |
| `get_insurance` | GET | – | no |
| `get_user_badges` | GET | – | no |
| `get_wildlife_vars` | GET | – | yes |
| `get_vars` (the countries list) | GET | – | no |
| `get_tables_21`, `get_cue_cards`, `get_videolist` | GET | – | no |
| `get_translations` (17 MB) | GET | – | no |
| `sonar` | GET | – | yes (one line) |
| `save_sonar_reaction` | POST | `json_data` | no |
| `home` | GET | `lang` (and a `version` value) | no |
| `events` | GET | `lat`, `lon`, `lang` | no |
| `news`, `jobs` | GET | – | no |
| `ai_proxy` | POST | `json_data`, header `X-Request-Id` | no |

## The course server (not `a21.php`) [R names, host ?]

One call shape, `method=<Name>&type=u&rest=p`, GET unless marked. Parameters as the client sends them:

| `method` | Verb | Param |
|---|---|---|
| `ContentListing` | GET | `courseId`, `language`, `quality`, `dcId` |
| `GetBookmarks`, `GetNotes`, `GetUserProgress` | GET | `masterId` (and `courseId`, `courseLanguage` on notes; `courseId` on progress) |
| `SetBookmarks`, `DeleteBookmarks` | POST | `masterId`, `bookmarks[0][pageId]` / `[bookmarkId]` |
| `SetNotes2`, `DeleteNotes` | POST | `masterId`, `notes[0][noteText]`, `[pageId]`, `[contentId]`, `[noteType]`, `[noteId]`, `[courseLanguage]` |
| `SetLastVisitedCoursePage` | GET | `courseId`, `masterId`, `pageId`, `tstamp` |
| `SetTestresult` | GET | `masterId`, `testId`, `percent`, `courseId`, `passed` |
| `SetFinalExamResult` | POST | `masterId`, `passed`, `pid`, `courseId`, `language` |
| `CreateRecordNote` | POST | `masterId`, `noteType`, `noteText`, `pageUid`, `contentUid`, `recordType`, `recordUid`, `question` |

Firmware: `update_check/` (`product_name`, `model_id`, `firmware_code`, `language_group`, `brand`, `target=mobile`) and
`languages/` (`from_group`, `product_name`, `model_id`, `brand`), each also under `firmware_test` and `firmware_dev`.
AI: `/api/aia/chat` (`q`, `languageId`, `courseId`, `webSearch`, `threadId`, `acl`) and `/api/aia/ping`.

## What the capture adds (answers, 2026-10-10)

`get_gearsets` and `get_emergency_contacts` answered **404 with a 2-byte body** for this account [R]: probably "nothing
here" [?], so a client must not treat every 404 from `a21.php` as an error. Sizes of the others: `get_divelog` 1.8 MB,
`get_translations` 17 MB, `sonar` and `news` 830 KB, `get_wildlife_vars` 210 KB, `jobs` 350 KB, `get_available_courses`
170 KB, `get_videolist` 240 KB; `home`, `get_insurance`, `get_user_badges`, `get_ccards`, `get_buddies` and `get_gear` are
small (1.8–8 KB). `events` answered 200 and 404.

## What this means for Dive Hub

- **The app writes** dives, their verification (`divelog_verify`), buddies, gear and gear sets and their images,
  emergency contacts, the profile, the privacy settings, sites and their descriptions and images, sonar reactions,
  affiliations with dive centres, and course progress. It only reads the rest.
- **Dive verification has its own calls** (`divelog_verify`, `divelog_unverify`) [R]. The reference says Dive Hub's
  dives stay unconfirmed; these are the app's way to confirm one.
- **No bulk call exists** in the client either [R]: confirms the [bulk upload note](2026-10-10-ssi-app-bulk-upload.md).
- **Sign-up exists in the API** (`signup`, `check_user_exist`, `validate_email`): the app can create an account, which
  Dive Hub does not need.

## The body of `save_divelog` (what the app sends) [R]

`json_data` is `RawDive.toJson` (drift row class, `dive_table.drift.dart`) with two keys replaced. Checked against the
2026-10-10 capture: **347 keys sent = the 345 keys of `toJson` + `odin_user_log_date` + `odin_user_log_entry_time`**;
no key of `toJson` is left out, and a value that is empty is sent as `null` (282 of 347 were `null`, 4 `[]`).

- **Every key is always present.** The app does not omit empty fields; it sends the whole row. Whether the server
  tolerates omitted keys is not known (open).
- **Types of the 345 keys** (from the serializer's type arguments): `int?` 84, `double?` 183, `String?` 50, `bool?` 17,
  `List<int>?` 4, `DateTime?` 3, `int` 2, unknown 2. These are the **local database's** nullability, not what the
  server requires. Only two columns are non-null: `internalPk` (local row id) and `odin_user_log_dive_type` (`int`, the
  one dive field the app can never leave empty). That makes `odin_user_log_dive_type` the only field the app itself
  treats as mandatory.
- **Sent along, but app-internal** (local state; the server presumably ignores them): `internalPk`, `localSiteId`,
  `localBuddyIds`, `needsUpload`, `uploadError`, `needsVerificationUpload`, `needsUnverifyUpload`, `timestamp`.
- **Date and time** are written by the upload code itself into `odin_user_log_date` and `odin_user_log_entry_time`
  (strings, in the capture); the three `DateTime?` columns are serialized as their own keys.
- **Groups of keys** in order: identity and time (`odin_user_log_id`, `_datetime`), depth and time, number, dive type,
  rating, temperatures, pressures, sites (`dive_sites_id`, `localSiteId`), buddies (`buddy_ids`, `localBuddyIds`),
  facility, animals, gear, then the specialised blocks `xr_*`, `scr_*`, `ccr_*`, `frddisc_*`, `divecomputer_*`,
  `apple_watch_*`, `datasets`, `pos_*` and `log_extended_data_*`. The full key→type table is in
  [the key list](2026-10-22-ssi-save-divelog-keys.md); the existing
  [reference](../references/ssi-app-api.md) lists the 387 keys SSI returns.
- **Two keys have no recoverable type:** `odin_user_log_divecomputer_dive_ref`, `odin_user_log_divecomputer_ref`.
- **What this does not tell:** which fields the **server** rejects when missing or malformed. That needs test saves.

## The two error interceptors [R]

- **`ServerMaintenanceInterceptor`** skips `what=ai_proxy` and every request whose host starts with `training.`.
  For the rest, when the response status is **503** it marks the server as in maintenance and logs "Error in
  ServerMaintenanceInterceptor"; the app then shows its maintenance state. A client of Dive Hub's kind should treat 503
  from `a21.php` as "SSI is down, retry later", not as a rejected dive. (The compare value is read from the
  response; 503 is [?] — the constant is `0x1f7`.)
- **`UnauthenticatedInterceptor`** looks at the response **body**: when it is JSON with `"status": 401` it logs "logout
  because of 401", clears the session and shows `session_expired`. So an expired sign-in can come as a **JSON
  `status` of 401**, possibly under HTTP 200 [?] — a client must check the body, not only the HTTP status.
- **`DefaultParametersInterceptor`** adds the fixed parameters to every call (`token` from the session — the strings
  `signup` and `get_translations` appear in the same method, so the token is probably handled differently for them [?] —, `ssiapp`, `lang`, `version`/`appVersion`, `context`, `s`, `device`, `deviceName`,
  `manufacturer`, `osVersion`, `platform`, `brand=SSI`); it matches the
  [reference's list](../references/ssi-app-api.md). `training.` hosts are treated apart from `a21.php`.

## What is still open

1. **Which fields the server requires.** The app sends the whole row (above); what the server rejects needs test saves
   (writes to the owner's account; the owner decides).
2. **Exact shape of an error body** (the `status` 401 body and the 503 case) — needs a captured response.
3. **Hosts** of the course, firmware and AI calls.
4. **`training.divessi.com`:** whether it is the course server (the interceptors treat a `training.` host specially, which
   points that way).
5. **Types and nullability** of other `json_data` bodies (profile, buddies, gear, sites): same method as for the dive.

## Tooling notes

- adb: `D:\Android\Sdk\platform-tools\adb.exe`. REA's own adb tools need `REA_ADB_PATH` in the REA MCP entry (set
  2026-10-22 in the owner's `~/.claude.json`, outside this repository).
- Blutter's Python packages (`requests`, `pyelftools`) are in a venv inside its folder. To rebuild: run
  `blutter.py <dir with libapp.so and libflutter.so> <out dir>` from the "x64 Native Tools Command Prompt".
- Nothing from the APK is stored in this repository.
