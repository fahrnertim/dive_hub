---
title: SSI app API (MySSI)
summary: SSI's private, undocumented app API as Dive Hub uses it - endpoint, sign-in, reading the logbook, saving (create, update, delete), when Dive Hub calls SSI (only on User actions, each call logged), SSI's app's own sync and its 60-second wait (not caused by Dive Hub), the dive record and its samples, buddies (entry IDs of the account's buddy list, checked 2026-10-05; the buddy QR code), the site list (checked 2026-10-05), a dive as SSI returns it and how the import reads it (2026-10-06), quirks, and what to do when SSI changes it. Each fact is marked with where it comes from.
status: living
date: 2026-10-06
url: https://api.divessi.com/app/a21.php
---

# SSI app API (MySSI)

## What it is

The JSON API the MySSI app (Android, iOS) talks to. **SSI doesn't publish or support it.** It can change or close
without notice, and SSI publishes no terms, rate limits or partner programme for it. Dive Hub uses it as its first
Target ([ADR 0024](../decisions/0024-ssi-target-via-app-api.md)). How it was found, and which community projects
describe it: [SSI API research](../research/2026-10-04-ssi-api.md).

This page records what Dive Hub relies on, so that when something breaks there is one place to compare against.
Keep it current: when SSI changes something, or the owner's checks confirm or refute a line, change the line and its marker.

Markers:
- **[R]**: confirmed against the real SSI with the owner's account (`round-trip.ts`, below), with date and app version,
  or for the site list (no account needed) against a download, with date.
- **[S]**: reported by a community project (see the research note), not yet confirmed by us.
- **[?]**: open; the projects disagree or nobody checked.

As of 2026-10-05 the site list, sending, the profile chart, updating, deleting and what a dive's buddy IDs are [R]; the other account checks are pending.

## What Dive Hub uses

### Endpoint and fixed parameters

- One endpoint: `https://api.divessi.com/app/a21.php`, with the action in `what=` [S].
- Every call also sends four fixed query parameters that the Android app sends [S]: a client label (`ssiapp`), the app version
  (`version`, e.g. `ADR_4.1.272-ssi`), `lang=en`, `context=s`. They are defined once in
  `apps/server/src/providers/ssi/ssi-client.ts` (`APP_PARAMS`).
  - No key, signature or secret is involved [S].
  - SSI's own app is at 5.0.43 (2026-10-01), and the API still answered the 4.1.x version string on 2026-10-01 [S].
- Dive Hub adds an honest `User-Agent: DiveHub (+<project URL>; <DIVEHUB_CONTACT>)`.
- The answer is HTTP 200 with JSON, also for refusals [S]. Anything else (an HTTP error, HTML) counts as
  "unavailable" (`ssi_unavailable`).

### Sign-in: `what=authenticate`

- `GET …&what=authenticate&l=<e-mail>&p=<password>` [S]. **The password travels in the query string.**
  Dive Hub never logs URLs and never puts one into an error (`ssi-client.test.ts` checks this).
- Answer: `{ authenticated: true, token, mid, authenticated_email, … }`, or `{ authenticated: false, error_message }` [S].
  - `mid` is the **user master ID**, the SSI account. Dive Hub keeps it as the Diver's External ID `(ssi, mid)`.
- Every later call sends `token=<token>`.
  - There's no refresh token or OAuth, and no 2FA or captcha has been seen [S].
  - **The token's lifetime is unknown [?]**: reports range from "hours" to months.
  - An expired token answers `{ authenticated: false, … }` (HTTP 200).

### Reading the logbook: `what=get_divelog`

- `GET …&what=get_divelog&token=…` returns the **whole logbook in one answer**, with no paging [S]:
  - `logbook_details[]`: every dive record, with profiles. Deleted dives are left out [S].
  - `logbook_sites[]`: the sites of the account's dives, as `odin_dive_sites_id`, `_name`, `_lat`, `_lon`, and a country (`odin_countries_code_iso`, `_country_iso3` or `_meta_country`).
  - `logbook_buddies[]`: the account's buddy list.
  - Statistics.
- Dive Hub reads it at most once per action before saving: to find the dive it updates, to check for a dive at the same
  time, to pick the next SSI dive number; and once more after saving (read-back). The read-back is kept for two minutes
  per Connection and answers the next action's duplicate check and number, so dives sent in a row read n + 1 times;
  updates and deletes always read afresh ([ADR 0027](../decisions/0027-providers-as-adapters.md)). Actions on one
  Connection wait 2 s between each other.

### When Dive Hub calls SSI (checked 2026-10-05)

Only when a User does something. There are no background calls: the worker never calls SSI, and a dive's status
(`GET /api/dives/{id}/providers`) reads only Dive Hub's database.

| User action | Calls |
|---|---|
| Connect, or sign in again | `authenticate` |
| Send a dive (create or update) | `get_divelog` (may come from the kept read-back), `save_divelog`, `get_divelog` (read-back) |
| Delete a dive that was sent to SSI | `get_divelog` (is it still there?), `save_divelog` (deleted) |
| Open the SSI site picker on a dive | `get_divelog` (may come from the kept read-back) |
| Open the buddy list (Connections) or the buddy picker on a dive | `get_divelog` (may come from the kept read-back) |
| Show what importing the dives would do (the preview, [ADR 0030](../decisions/0030-importing-dives-from-providers.md)) | `get_divelog` (always read afresh) |
| Start the import | `get_divelog` (may come from the kept read; the worker never calls SSI) |
| Any of these after SSI's token expired, with the password kept | `authenticate` first |

The browser also reads again when the site or buddy picker is open and its data is older than 5 or 2 minutes. That
happens, for example, when the phone comes back to the app.

**Server log:** each call is logged at `info` as `SSI call` with `ssi: { call, connectionId, outcome, ms, detail? }`
(`connectionId` is null while signing in). `detail` is only there when a call failed: SSI's own error text, or, for a
save without a dive ID and without an error, SSI's `ok` value and the names of the fields it sent back (not their
values). The token, password and URL are never logged. A Connection's `last_used_at` shows when Dive Hub last used it
successfully; `next_action_at` shows its last call to SSI, successful or not.

### SSI's app: its sync and the "wait 60 seconds" (checked 2026-10-05, app 5.0.34 on Android)

The owner recorded the phone's connections with PCAPdroid and this PC's connections to `api.divessi.com`, and
compared them with Dive Hub's server log [R]:
- **The app uses the same server as Dive Hub** (`api.divessi.com`). It also contacts `cdn.divessi.com` and
  `my.divessi.com`. Before syncing, it looks up the phone's public IP address (`checkip.amazonaws.com`,
  `icanhazip.com`); what it does with the address is unknown.
- **The app syncs when it opens:** about 12 requests to `api.divessi.com` within one second. One answer is about
  180 KB, probably the logbook.
- **"Wait until …" comes from SSI's server, and Dive Hub doesn't cause it.** A pull to refresh within about a minute
  of the last sync is refused. After a refused pull, the app retries 5 times, 8 seconds apart, each refused again.
  Pulling again during that time moves the "until" time forward, so the wait can seem endless. It happened while
  Dive Hub's server was stopped, and while it made no calls.
- **What works:** open the app, leave it alone for 2 minutes, then pull once. Checked twice in a row by the owner.
- **A dive sent from Dive Hub showed only after a manual pull,** not after the sync on opening. So for checking a
  dive in the app, open it, wait 2 minutes, and pull once.

**Deleting in the app and sending again (2026-10-05, not fully explained):** dive 29828202 was deleted in the app.
Dive Hub's delete then found it gone, and two new sends of the same Dive were refused (a save without a dive ID).
After the app had synced, the logbook listed 29828202 again with Dive Hub's reference, and the next send linked to
it. A guess is that SSI refuses a new dive whose reference matches a deleted one, and that the app's sync uploaded
the dive again from its own copy. Neither is checked; the refusals were logged before the `detail` field existed. If
it happens again, the `SSI call` line's `detail` shows SSI's reason.

### Saving: `what=save_divelog`

- `POST …&what=save_divelog&token=…`, `Content-Type: application/x-www-form-urlencoded`, body `json_data=<the record as JSON>` [S].
- **Create:** `odin_user_log_id: null`. **Update:** the existing ID. **Delete:** an update with `odin_user_log_deleted: 1`
  (SSI hides the dive; there's no way back in the app) [S].
- Answer to a **create**: `{ ok: "added to Log", error: "", odin_user_log_id: <id> }` [R]. Dive Hub takes the dive ID
  from it; without one, the create counts as refused (`provider_refused`).
- Answer to an **update**: the same answer **wrapped in `success`**:
  `{ success: { ok: "updated", error: "", temp_id: "", odin_user_log_id: <id> }, result: … }` [R] (owner's dive #90,
  2026-10-06, from the server log; the community projects' unwrapped answer [S] was wrong for it). Dive Hub reads the ID
  and the error from `success` when it is an object. Until 2026-10-06 it looked only at the top level and refused every
  update SSI had in fact stored: Pushes `provider_refused`, the Dive "changed since sent", the dive at SSI not known as
  sent by Dive Hub. Sending again records it: confirmed with the fix on the owner's dive #90 (2026-10-06, update confirmed,
  read back with no differences). A **delete** goes through the same save and is read the same way; its answer hasn't
  been seen yet [?].
- **The whole record goes every time**: about 340 keys, unused ones `null` [S]. Whether SSI accepts a partial record is untested.
  - An update re-sends SSI's current record (from `get_divelog`) with Dive Hub's values on top, so values edited in
    the app (rating, buddies, …) survive.
  - Read-only keys of the read side (`updates`, `app_version`, …) are left out.
- SSI's dive number (`odin_user_log_nr`) is the client's choice: Dive Hub takes the highest in the logbook + 1 [S].

### The dive record: the fields Dive Hub fills

From `ownFields()` in `apps/server/src/ssi/ssi-record.ts`. On an update, a field Dive Hub has no value for keeps SSI's value.

| SSI key | From | Notes |
|---|---|---|
| `odin_user_log_datetime`, `_date`, `_entry_time` | start + UTC offset | `YYYY-MM-DD HH:MM` local wall-clock time, **no time zone**; SSI keeps minutes [S] |
| `odin_user_log_divetime` | duration | whole minutes; SSI rounds [S] |
| `odin_user_log_depth_m` / `_ft`, `_avg_depth_m` / `_ft` | max / average depth | both units are sent |
| `odin_user_log_watertemp_c` / `_f`, `_watertemp_max_c` / `_f` | lowest / highest water temperature | |
| `odin_user_log_var_watertype_id` | the Dive site's water type (ADR 0025) | 4 fresh, 5 salt, brackish nothing [S] (one project had them swapped) |
| `odin_user_log_dive_sites_id` | the Dive site's SSI site ID | required by Dive Hub; the web form refuses a dive without one [S] |
| `odin_user_log_comment` | notes | |
| `odin_user_log_buddy_ids` | the Participants (buddies, guides, instructors) | entry IDs of the User's buddy list, as numbers, found by the Diver's SSI account (`buddy_master_id`); one not in the list is left out. On update, IDs set in SSI's app stay ([ADR 0029](../decisions/0029-push-requirements-and-buddies.md)) [R] |
| `odin_user_log_ean`, `_ean_percent` | first gas | 1 + O₂ % for nitrox; 0 + 0 for air [S] |
| `odin_user_log_gf_set` (`"40 / 85"`), `_gf_set_1`, `_gf_set_2` | GF low / high | |
| `odin_user_log_cns_start`, `_cns_end` | the Recording's CNS | |
| `odin_user_log_pos_start_*`, `_pos_end_*` | entry / exit position | |
| `odin_user_log_divecomputer_serial_nr`, `_manufacturer`, `_name`, `_ref`, `_firmware` | the Device | **the serial binds the dive to a device record at SSI**; without it the app shows its own brand. SSI drops leading zeros [S]. Changing the manufacturer later creates a second device record [S] |
| `odin_user_log_divecomputer_imported` | `true` with a Device | the app shows a computer icon [S] |
| `odin_user_log_divecomputer_dive_ref` | `divehub-<Dive id>` | Dive Hub's reference: finds the dive again when an answer was lost |
| `odin_user_log_user_master_id`, `_nr`, `internalPk` | the account, SSI's dive number | |
| `odin_user_log_depthDataset`, `_tempDataset`, `_gfSurfDataset`, `_gfnowDataset`, `_diveSamples` | Primary recording's samples | JSON **strings**; see below |

Not sent (null): rating, air temperature, visibility, weight, tank, pressures, conditions other than water type, the
leader number (`odin_user_log_leader_nr`), dive centre, gear, wildlife, surface interval. For the **surface interval**, one project says seconds and another says minutes [?].
`odin_user_log_confirmed` / `_verified` can't be set: SSI derives them from a dive centre's confirmation, so dives
sent this way show as **unconfirmed** [S].

### Samples (`odin_user_log_diveSamples`)

A JSON string holding an array, one object per **5 s** [S]:
`{"n":1,"t":0,"d":0.0,"s":0.0,"te":26.0,"ndl":99,"gs":0.0,"gn":0.0,"a":0,"mf":134217728,"o":false,"dr":false,"rv":3.0}`

| Key | Meaning | Dive Hub sends |
|---|---|---|
| `n`, `t` | sample number (from 1), ms since start | |
| `d` | depth, m | interpolated from the depth channel |
| `s` | vertical speed, m/min (ascending positive) | from depth |
| `te` | temperature, °C (may be null) | last reading |
| `ndl` | no-deco limit, min, at most 99 | last reading (s → min), else 99 |
| `gs`, `gn` | GF at surface, GF now (%) | 0.0 |
| `a` | alarm bits | 0 |
| `mf` | phase bits: dive `0x08000000`, at depth `0x00010000` (from 8.5 m down until above 6 m), surfaced `0x04000000` (≤ 1 m) [S] | |
| `o`, `dr` | obligation, deco required | false |
| `rv` | always 3.0; the app's chart is said to hang without it [S] | 3.0 |
| `pressure` | tank pressure, bar; left out when unknown [S] | not sent yet (no tank channel) |

**Types matter** [S]: the app reads `d`, `s`, `te`, `gs`, `gn` and `rv` as floating-point numbers, and an integer there
reportedly breaks the dive's view. JavaScript's `JSON.stringify` writes `0.0` as `0`, so Dive Hub writes this string
itself (`samplesJson()`).

### Buddies (checked 2026-10-05)

Read once from the owner's account through Dive Hub's own Connection (a temporary read-only check that printed IDs and
initials only; 8 buddy-list entries, 5 dives with buddies) [R]:
- **A dive's `odin_user_log_buddy_ids` holds entry IDs from the account's buddy list, not SSI accounts** [R]. Example:
  dive #90 had `[3786888, 2826964]`; those are the `id`s of two entries in `logbook_buddies`, whose SSI accounts
  (`buddy_master_id`) are 4989164 and 4512484.
- The IDs are **JSON numbers** [R]. `localBuddyIds` reads as `null` [R] (the app's own field; divesend sends `[]` on create [S]).
- `logbook_buddies[]` entries have the keys `id`, `master_id`, `buddy_master_id`, `firstname`, `lastname`, `forename`,
  `nickname`, `dob`, `email`, `phone` (some also `mobile_c`, `phone_c`), `address`, `city`, `country`, `comment`,
  `image`, `image_timestamp`, `leader_nr`, `leader_active`, `confirmed`, `favorite`, `deleted`, `added` [R].
- **`master_id` equals `buddy_master_id`** in every entry: both are the buddy's SSI account. Nothing in an entry names
  the account whose list it is in [R].
- Every entry in the owner's list had an SSI account; whether the list can hold people without one is [?].
- `odin_user_log_leader_nr` was `""` on every dive with buddies [R].
- **What Dive Hub keeps of an entry** (since [ADR 0043](../decisions/0043-dive-centres-and-ssi-verification-codes.md#as-built-slice-3)):
  `buddy_master_id`, `firstname`, `lastname`, `email` and `leader_nr`, the parts of the person's buddy code. An empty
  `leader_nr` or `0` is read as "no leader number"; what SSI writes for someone who is not a professional was not
  looked at [?]. `leader_active` is not read: whether it says that a professional may still verify dives is [?].
- **Adding an entry** in the app works by scanning the other person's buddy QR code, and the other person is **not
  notified** (owner, 2026-10-05). The call the app makes for it is unknown [?].
- **The buddy QR code** is plain text [R] (owner, 2026-10-05, a real code, anonymized here):
  `buddy;<SSI account ID>;firstName:<first name>;lastName:<last name>;email:<e-mail>`. The number is the person's SSI
  account, the same as `buddy_master_id` in the list (checked against an entry in the owner's list). Whether SSI's app
  needs the name and e-mail, or adds the entry from the account ID alone, is [?].
- **Verification codes** [R] (owner, 2026-10-08, real codes, anonymized here). A diver scans one on a logbook entry and
  SSI shows the dive as verified. Two kinds are known:
  - a dive centre's: `center;<centre number>;name:<name as SSI spells it>` (the name seen had a legal form and a town,
    separated by a comma);
  - a professional's: the buddy code with the leader number at its end,
    `buddy;<SSI account ID>;firstName:<first name>;lastName:<last name>;email:<e-mail>;leaderNr:<leader number>`.

  They are fixed (the same code every time), carry no token or signature, and the app reads them by camera or from an
  image file. Whether the app checks the name against the number is [?]. Whether it reads a name with an umlaut or
  another non-ASCII letter from a code written as UTF-8 bytes is [?]: no such code has been seen (owner, 2026-10-08). An unverified dive doesn't count towards SSI's
  recognition levels (German "Anerkennungsstufen"; the English name is [?]). Used by
  [ADR 0043](../decisions/0043-dive-centres-and-ssi-verification-codes.md).
- Still open: whether another account's list gives the same person **another** entry `id` (a row per pair of accounts)
  or the same one [?]; how to add an entry (no call is known [S]). Buddy IDs set by Dive Hub are accepted and show on
  the dive in the app [R] (owner, 2026-10-06).

### A dive as SSI returns it (checked 2026-10-06)

Dive Hub's upload #91 (Garmin Descent Mk3, 74 min) read back through the owner's Connection, field types and computer
fields only [R]:
- **SSI adds its own:** a device record (`log_user_divecomputer_id`, `odin_user_log_divecomputer_id`,
  `log_divecomputer_archive_id`, `log_divecomputer_updated`), sync bookkeeping (`updates`, `odin_user_log_last_sync`,
  `odin_user_log_transferDate`, `app_version` = the client label sent), and IDs of its own side tables
  (`log_dataset_*`, `log_extended_data_*` with a 32-character hash, `log_linked_*`, `odin_user_log_data_deco_*`,
  `odin_user_log_apple_watch_*`).
- **`odin_user_log_divecomputer_imported` reads `1`** for Dive Hub's upload too: it means "from a computer file", not
  "synced by SSI's app".
- **The profile:** `odin_user_log_diveSamples` as sent (887 samples, every 5 s); `odin_user_log_depthDataset`,
  `_tempDataset`, `_gfnowDataset`, `_gfSurfDataset` as JSON arrays of numbers, one per sample. `_tankPressureDataset`,
  `_alarmDataset`, `_deepestDecoDataset` are empty strings; `_pressureDataset`, `_heartRateDataset`,
  `_batteryLevelDataset`, `_accelerationDataset`, `_gyroDataset` null.
- **No field for the computer's water setting** (salinity or density); the only water field is
  `odin_user_log_var_watertype_id`.
- Still to see: a dive synced by SSI's app from a dive computer (the owner provides one from a Mares Puck 4, 2026-10-07).

**How the import reads a dive** ([ADR 0030](../decisions/0030-importing-dives-from-providers.md), `ssi-import.ts`), until
a synced dive has been seen:
- *Sent by Dive Hub:* `odin_user_log_divecomputer_dive_ref` starts with `divehub-`, or Dive Hub sent values to that SSI
  dive ID (a confirmed create or update Push).
- *From a dive computer:* a profile (`odin_user_log_diveSamples`, else `_depthDataset` and `_tempDataset`, 5 s apart) and
  a serial number with a manufacturer (`odin_user_log_divecomputer_serial_nr`, `_manufacturer`; the product from `_ref`,
  `_name` or `_productname`; the manufacturer in lower case, as FIT files name it). `_imported` alone counts for nothing.
- *Older records* (SSI's iOS app 4.1.203, early 2025; seen on a Mares Puck 4's dives, 2026-10-06) [R]: serial number,
  manufacturer and name empty; the computer only in `odin_user_log_divecomputer_ref` as "Manufacturer Model_Serial"
  ("Mares Puck4_2418005226"), read as the same Device the newer shape names. Newer records (app 4.1.231) fill all of them,
  with `divecomputer_ref` the model alone ("Puck4"). Both keep the profile in `depthDataset` and `tempDataset`, not in
  `diveSamples` (empty); `divecomputer_dive_ref` is the app's own ("2025-07-07T10:55:00.000_0"), `gf_set` "85 / 85" with
  `gf_set_1` / `_2` empty, an `alarmDataset`, and no water setting. **GF is not taken from `gf_set`** (owner, 2026-10-06):
  whether "85 / 85" is the computer's setting or a value SSI's app fills in is unknown [?], and SSI names no deco model
  for it; Dive Hub doesn't assume. Revisit when a dive with a known setting shows what SSI writes.
- *Typed by hand:* everything else.
- Read: `odin_user_log_datetime` (local, no time zone), `_divetime` (minutes; a computer's dive takes its profile's
  length), `_depth_m`, `_avg_depth_m`, `_watertemp_c`, `_watertemp_max_c` (0 counts as none), `_pos_start_*`,
  `_pos_end_*`, `_dive_sites_id` (with the site's position from `logbook_sites`), `_buddy_ids` (entry IDs → SSI
  accounts through `logbook_buddies`), `_comment`, `_ean` / `_ean_percent`, `_gf_set_1` / `_2`, `_cns_start` / `_end`.
  The samples' `ndl` is minutes; 99 means none.
- Read as the dive's one tank ([ADR 0045](../decisions/0045-tank-pressure-cylinders-and-sac-on-a-dive.md#ssis-tank-as-built)):
  `_tank_vol_l`, `_pressure_start_bar`, `_pressure_end_bar` (0 counts as none; the `_psi` and `_cuft` twins aren't read)
  and `_var_tanktype_id` (19 steel, 20 aluminium). In the owner's logbook (127 dives, 2026-10-08): both pressures and a
  volume on 13, a volume and a type only on 8, none on 106 [R].
- Kept: each dive's record as received, as one JSON Original; the buddy list itself never (only entry → account, on the
  Import), and of `logbook_sites` each site's name, position, country (alpha-2) and water type (`bow`: salt or fresh;
  artificial or missing is none, as in the site list). The private flag isn't read (owner, 2026-10-06).
- A dive's site (slice 15a): the site here with that SSI ID, else the same site by name and position (it gets the ID),
  else, only if an admin allowed SSI's site data, a site made from the logbook's entry (marked "From SSI").

## Known but not used

| Call | What | Note |
|---|---|---|
| `get_user_data` | profile: name, address, birthday, units | [S] |
| `get_divelog_vars` | ID → name lists for conditions (weather, entry, water body, current, surface, dive type, special dive, tank) | [S]; fetch at runtime when conditions are sent. Answers without a token [R] (2026-10-08): `logbook_vars.tanktype` is `{ 19: "steel", 20: "alu" }`, `logbook_vars.suit` `{ 85: "other", 86: "shorty", 87: "wetsuit", 88: "semidry", 89: "drysuit" }`; the two tank types are a constant in `ssi-import.ts` |
| `get_buddies` | buddy list, the same entries as `logbook_buddies` in `get_divelog` ([Buddies](#buddies-checked-2026-10-05)) | [S]; no call to add a buddy is known |
| `get_ccards` | certifications (card ID `ccard_uid`, course, date, instructor and centre numbers) | [S]; for an import from SSI later |
| `get_gear`, `save_gear`, `delete_gear`, `get_gearsets`, `save_gearset` | equipment | [S] |
| `APP_CACHE_CENTER.zip` (`/app/…`, no sign-in) | dive centres | [S]; no licence, like the site list |
| `my.divessi.com` web logbook | form posts with a session cookie, SSO via `rest.divessi.com/sso/login` | [S]; the fallback if the app API closes |

## The site list: `APP_CACHE_SITES.zip`

Used by the admin's SSI site import ([ADR 0025](../decisions/0025-ssi-site-import-and-site-water-type.md)), at the
operator's risk: **SSI gives no licence for it**, and the EU database right protects it (ADR 0024). Checked [R] on
2026-10-05 against one download into `samples/private/` (git-ignored, never committed, nothing derived from it kept).

- `GET https://api.divessi.com/app/APP_CACHE_SITES.zip`, **no sign-in**. Answer: `200`, `application/zip`, 2.5 MB [R].
- One file inside, `sites.json`, 19 MB [R]:
  `{ created, divesites_total, divesites_locked_total, divesites_deleted_total, divesites: [...] }`.
  On 2026-10-04: 24,510 entries in `divesites` (36,639 total, 24,468 locked, 333,914 deleted) [R].
- Per site [R]:

  | Key | What | Dive Hub |
  |---|---|---|
  | `odin_dive_sites_id` | integer, unique | the External ID `(ssi, id)` |
  | `odin_dive_sites_name` | string; 4 are numbers | name (as text) |
  | `odin_dive_sites_lat`, `_lon` | degrees; mostly 4 decimals, 2,276 with 3, 245 with 2, 34 with 1 | position |
  | `odin_countries_code_iso` | ISO 3166-1 **alpha-3**; 639 empty; withdrawn `ANT` (Netherlands Antilles) still used | country (alpha-2; `ANT` → none) |
  | `bow` | body of water: `salt` 20,664, `fresh` 2,992, `artificial` 835, missing 19 | water type (artificial → none) |
  | `odin_dive_sites_deleted` | `0`, or `""` for 66 sites | truthy → left out; `""` is not deleted |
  | `odin_dive_sites_is_private`, `_is_private_owner` | 43 private sites, with an SSI user ID; probably older private sites that got published (owner, 2026-10-06) [?] | **left out entirely** |
  | `odin_dive_sites_comment` | moderation notes, 18,217 non-empty; **contain submitters' IP addresses** | **never kept** |
  | `alias_names`, `alias_names_search` | other names, 7,623 sites | not kept (no field yet) |
  | `iso2` | a **language** code (`ja`, `el`), empty for 14,452; not a country | ignored |
  | `current`, `odin_user_log_animal_ids` | current statistics, wildlife IDs | never kept |
  | `odin_dive_sites_meta_address`, `_meta_region`, `_meta_country`, `_geo_locked`, `_alias_ids`, `timestamp` | | ignored |

- Code: `apps/server/src/sites/import/ssi-sites.ts`; tests use a hand-made file in this format
  (`apps/server/test/fixtures/site-sources/ssi-sites.json`), never the real one.
- **If it changes:** the import fails with `source_unavailable` (no zip, no JSON, no `divesites`), or single sites
  are skipped. Download it once into `samples/private/`, compare with this table, and update the adapter, the fixture
  and this section.

## In Dive Hub

SSI is a Provider ([ADR 0027](../decisions/0027-providers-as-adapters.md)): everything SSI-specific is in
`apps/server/src/providers/ssi/`; Connections, Pushes, pacing and the routes are the generic layer's (`src/providers/`).

| File | Part |
|---|---|
| `apps/server/src/providers/ssi/ssi-client.ts` | the calls; errors as reasons (`wrong_credentials`, `signed_out`, `refused`, `unavailable`, `bad_response`), never with a URL |
| `apps/server/src/providers/ssi/ssi-record.ts` | Dive → record, samples, update and delete records, read-back comparison, fingerprint |
| `apps/server/src/providers/ssi/ssi-adapter.ts` | SSI's capabilities and requirements, sign-in, the logbook read (kept two minutes after a save), the ±2 min match, SSI's dive numbers, the SSI site ID, buddies as buddy-list entries; SSI's record as typed values |
| `apps/server/src/providers/ssi/ssi-import.ts` | SSI's dives for an import (ADR 0030): evidence, local start, values, profile, computer, site, buddies as SSI accounts; the logbook's context |
| `apps/server/src/providers/dive-import.ts` | generic: importing a Provider's dives (settings, preview, start, the worker's run) |
| `apps/server/src/providers/buddy-service.ts` | generic: the account's list of people read live and imported as external Divers (name and account only) |
| `apps/server/src/providers/ssi/ssi-sites.ts` | the site list for the admin's SSI site import |
| `apps/server/src/providers/connection-service.ts`, `push-service.ts` | generic: Connections, signing in again, create / update / link / delete, Pushes |
| `apps/server/test/fake-ssi.ts` | an in-memory SSI for tests and the browser tests' server |
| `apps/server/test/provider-contract.test.ts` | the Provider contract, run against the fake SSI |
| `apps/server/test/fixtures/ssi/round-trip.ts` | the owner's checks against the real SSI |

## When SSI changes something

1. **Symptoms:**
   - Pushes fail with `provider_unavailable` (an HTTP error, HTML, or JSON without the expected keys), or with `provider_refused` (no dive ID in the answer).
   - Read-back differences appear that weren't there before.
   - Connections fall to "Sign in again" for everyone (sign-in changed).
2. **Check with a real account:**
   - `SSI_EMAIL=… SSI_PASSWORD=… pnpm --filter @dive-hub/server exec tsx test/fixtures/ssi/round-trip.ts read`
     saves the answers to `samples/private/ssi/` (git-ignored, personal data).
   - `… write --pause` (with `SSI_SITE_ID`) creates, updates and deletes a throwaway dive, and pauses so you can look
     at it in the app.
3. **Compare** with this page and the community projects (research note). Update the client, this page's markers, and `fake-ssi.ts`, so the tests describe the new behaviour.
4. **If the app API is gone:** QR payload (planned fallback) or the web logbook (above).

## Owner's checks (pending)

From the research note. Record the result here with date and app version, and turn [S] into [R]:
- [ ] In-app terms of use: any clause on automated access or third-party apps. Not checked (2026-10-05): the owner
  doesn't know of any. It affects the risk for each User's SSI account (SSI could block it), not whether the code works.
- [x] A dive sent from Dive Hub shows in the app and its profile chart renders [R] (owner, 2026-10-05, app 5.0.34 on
  Android).
- [x] Update and delete show in the app [R] (owner, 2026-10-05, app 5.0.34 on Android).
- [x] The create answer contains `odin_user_log_id` [R]: sending stored SSI's dive ID, which updating and deleting used.
- [ ] Token lifetime: still valid one day after connecting (owner, 2026-10-05). Check again after a week
  (`round-trip.ts token`, or whether the Connection asks to sign in again).
- [ ] Side effects: after an API sign-in, is the phone still signed in? A "new sign-in" e-mail? 2FA in the account settings?
- [x] What a dive's buddy IDs are: entry IDs from the account's buddy list, as numbers [R] (owner, 2026-10-05; see
  [Buddies](#buddies-checked-2026-10-05)).
- [x] Buddies sent from Dive Hub show on the dive in the app [R] (owner, 2026-10-06, slice 14).
- [ ] Same person, two accounts: compare the entry `id` of one shared buddy in both lists (per pair, or one ID).
- [x] Private sites in the logbook read [R] (owner's account, 2026-10-06, `logbook_sites` downloaded raw through the
  Connection): 4 of 26 entries are private (`odin_dive_sites_is_private: 1`, `odin_dive_sites_is_private_owner` = the
  owner's own SSI account). None of the 4 is in the public zip, three of them older than it: private sites stay out of
  the public list, and the zip's 43 are likely older ones that got published. The flag isn't read: once an admin allows
  SSI's site data, the dive import makes them shared sites like any other, which the owner wants (2026-10-06).
  Entries also carry `odin_dive_sites_comment` (9 of 26 non-empty), SSI's statistics (`myloggedDives`, …), aliases and
  wildlife IDs; Dive Hub keeps only ID, name, position and country.
- [ ] A buddy code and a professional's code drawn by Dive Hub: does SSI's app take them (add the buddy; verify a
  dive)? And what do `leader_nr` and `leader_active` hold for a professional and for someone who is none?
- [ ] Surface interval: seconds or minutes. Log a dive in the app with a known surface interval (e.g. 1 h 30 min),
  run `round-trip.ts read`, and look at the dive's surface interval key in `samples/private/ssi/` (90 = minutes,
  5400 = seconds).
