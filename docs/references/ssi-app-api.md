---
title: SSI app API (MySSI)
summary: SSI's private, undocumented app API as Dive Hub uses it - endpoint, how every answer is read (signed out, maintenance), sign-in, reading the logbook, saving (create, update, delete), when Dive Hub calls SSI (only on User actions, each call logged), SSI's app's own sync and its 60-second wait (not caused by Dive Hub), the dive record and its samples, buddies (entry IDs of the account's buddy list, checked 2026-10-05; the buddy QR code), the site list (checked 2026-10-05), a dive as SSI returns it and how the import reads it (2026-10-06), quirks, and what to do when SSI changes it. Each fact is marked with where it comes from ([T] tested on the owner's account, [R] read in the app's code or seen on the wire, [S] community report).
status: living
date: 2026-10-23
url: https://api.divessi.com/app/a21.php
---

# SSI app API (MySSI)

## What it is

The JSON API the MySSI app (Android, iOS) talks to. **SSI doesn't publish or support it.** It can change or close
without notice, and SSI publishes no terms, rate limits or partner programme for it. Dive Hub uses it as its first
Target ([ADR 0024](../decisions/0024-ssi-target-via-app-api.md)). How it was found, and which community projects
describe it: [SSI API research](../research/2026-10-04-ssi-api.md).

This page records what Dive Hub relies on, so that when something breaks there is one place to compare against.
Keep it current with `ssi-client.ts` and `ssi-transport.ts`: when SSI changes something, or the owner's checks confirm or refute a line, change the line and its marker.

Markers:
- **[T]**: tested on the owner's account (`round-trip.ts`, below), with date and app version; the site list (no account
  needed) against a download, with date. Newer [T] claims link their [research note](../research/2026-10-23-ssi-foundation-checks.md).
- **[R]**: read in the app's code or seen on the wire (a capture or a log), with date and app version where known.
- **[S]**: reported by a community project (see the research note), not yet confirmed by us.
- **[?]**: open; the projects disagree or nobody checked.

As of 2026-10-05 the site list, sending, the profile chart, updating, deleting and what a dive's buddy IDs are [T]; the other account checks are pending. Entries dated before 2026-10-23 that were confirmed with the owner's account are marked [T]; those from the app's code or a capture stay [R].

## What Dive Hub uses

### Endpoint and fixed parameters

- One endpoint: `https://api.divessi.com/app/a21.php`, with the action in `what=` [S].
- Every call also sends the fixed query parameters the Android app sends [R] (owner's capture of app 5.0.43,
  2026-10-10): `ssiapp=0815_ADR`, `version=ADR_5.0.43-ssi`, `appVersion=5.0.43-ssi`, `lang=en`, `context=s`,
  `platform=ADR`, `brand=SSI`, `osVersion` (the Android API level), and three about the phone (`device`, `deviceName`,
  `manufacturer`), where Dive Hub says "Dive Hub". They are defined once in
  `apps/server/src/providers/ssi/ssi-client.ts` (`APP_PARAMS`).
  - No key, signature or secret is involved [R].
  - Until 2026-10-10 Dive Hub sent only `ssiapp`, `version=ADR_4.1.272-ssi`, `lang` and `context`. Which parameters
    are sent doesn't decide whether a save is stored (below).
- **The User-Agent is the app's**, `Dart/3.12 (dart:io)` ([ADR 0049](../decisions/0049-ssi-app-user-agent.md)); until
  2026-10-10 it was Dive Hub's own, `DiveHub (+<project URL>; <DIVEHUB_CONTACT>)`.
- The answer is HTTP 200 with JSON, also for refusals [S]. Every call to the app API goes through `ssi-transport.ts`, which reads the
  answer the same way each time [R] (the app's code; not every case seen on the wire):
  - a body `status` of 401 or `'401'` is signed out, under any HTTP status;
  - HTTP 503 is `maintenance` (shown to users as unavailable); any other non-2xx is unavailable (also when the body is HTML);
  - a non-JSON answer (HTML) under a 2xx status is `bad_response`.
  - Kept from the community report, not read in the app [S]: `authenticated: false` is signed out too, except on
    `authenticate`, where it is wrong credentials. The app reads only `status` 401.

### Saves only from the app's User-Agent (2026-10-10)

Found with the owner's account on 2026-10-10 [T]; the decision is [ADR 0049](../decisions/0049-ssi-app-user-agent.md).
- **What SSI does to another client:** a save is answered as a create that worked,
  `{ ok: "added to Log", error: "", temp_id: "", odin_user_log_id: "9…" }`, with a nine-digit dive ID (as a string)
  that exists nowhere. This is the answer to an update too, where a stored one answers with the dive's own ID wrapped in
  `success`. Nothing is stored. Reading the logbook works as before.
- **When:** the last update SSI stored for Dive Hub was on 2026-10-07 10:45 UTC; the first that provably wasn't, on
  2026-10-09 15:24 UTC. Dive Hub's record didn't change in between.
- **What decides it:** the User-Agent alone. With Dive Hub's own record and parameters, SSI stored the save for
  `Dart/3.12 (dart:io)` and `Dart/3.5 (dart:io)`; not for `Mozilla/5.0`, `okhttp/4.12.0`, `curl/8.9.1`, `node`,
  `LogbookSync/1.0`, `DiveHub`, `DH (+<project URL>)` or `Dart/3.12 (dart:io) DiveHub`. The app's parameters with Dive
  Hub's User-Agent were not stored; the app's User-Agent with Dive Hub's parameters was.
- **The record is not it:** the app's own save (347 keys; booleans as `true`/`false`, the start as
  `2026-08-07T16:05:00.000`) and Dive Hub's (341 keys; `0`/`1`, `2026-08-07 16:05`) were both stored with the app's
  User-Agent. The app sends six keys Dive Hub doesn't: `odin_user_log_gear_details`, `log_extended_data_latitude`,
  `_longitude`, `_conservatism`, `_decomodel`, `_libdivecomputer_identifier_base64`. Since 2026-10-23 Dive Hub sends these six too (it sends every key of the app's row, below).
- **A fresh sign-in** with Dive Hub's own User-Agent answered `authenticated: false` on its first `get_divelog`
  (`round-trip.ts read`, 2026-10-09), while the Connection's older token still read.
- **`internalPk` is not the dive number:** the app saved the owner's dive number 89 with `internalPk: 86`. Dive Hub
  sends the number in both on a create.
- **Dive Hub's side:** such an answer is the error `not_stored` (`provider_not_stored`), for an update or delete by the
  other ID, for a create by the dive missing from the read right after. Migration `0033` marks the Pushes of those days.
- **Confirmed in use:** with the app's User-Agent, the owner's sends from Dive Hub arrive at SSI again (2026-10-10) [T].
- **The owner asked SSI** for a supported way on 2026-10-10 (an interface or partner programme, leave for a client
  that says who it is, or another way to bring dives with a profile into MySSI). No answer yet.

### Capturing the app

How the app's calls were read (2026-10-10), for the next time SSI's answers change:
- The app (`com.divessi.ssi`, Flutter) doesn't trust a user-installed certificate. It runs in an Android emulator with a
  "Google APIs" image of Android 16 or older (rootable, and without Android 17's certificate transparency rule; the
  app targets API 37), installed from a phone with `adb pull` of its APK files and `adb install-multiple`. An x86_64
  image runs its arm64 code.
- HTTP Toolkit, "Android device via ADB", installs its certificate as a system certificate; the app doesn't pin.
- Captures hold the password and token: they stay in `samples/private/` (git-ignored).

### Sign-in: `what=authenticate`

- `GET …&what=authenticate&l=<e-mail>&p=<password>` [S]. **The password travels in the query string.**
  Dive Hub never logs URLs and never puts one into an error (`ssi-client.test.ts` checks this).
- Answer: `{ authenticated: true, token, mid, authenticated_email, … }`, or `{ authenticated: false, error_message }` [S].
  - `mid` is the **user master ID**, the SSI account. Dive Hub keeps it as the Diver's External ID `(ssi, mid)`.
- Every later call sends `token=<token>`.
  - There's no refresh token or OAuth, and no 2FA or captcha has been seen [S].
  - **The token's lifetime is unknown [?]**: reports range from "hours" to months.
  - How an expired token is answered is **not known [?]**. A kept token was still accepted when it was 0.3 h and when it
    was 3.3 h old (2026-10-23, app 5.0.43): HTTP 200, a normal logbook answer with no `status` and no `authenticated` key
    [T] ([research](../research/2026-10-23-ssi-foundation-checks.md#does-an-expired-token-read-as-ssi-unavailable)).
    Dive Hub treats a body `status` 401 and `authenticated: false` as signed out (above); that is not yet seen for an
    expired token.

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
| Send many dives (a Push run, [ADR 0047](../decisions/0047-push-runs.md)) | per dive as "Send a dive" above, one dive every 5 s (the worker; `limits.run`), at most 100 per run; a run stops at once when SSI wants a new sign-in |
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

### SSI's app: how it uploads dives (checked 2026-10-10, app 5.0.43)

Read from the app's compiled code and one capture; details in the
[research note](../research/2026-10-10-ssi-app-bulk-upload.md):
- **The app has no bulk call [R].** `save_divelog` is its only save; its import of several dives from a dive computer
  saves one dive at a time (`_batchImportSaveOneDive`).
- **It keeps a local queue [R]:** each dive has `needsUpload` and `uploadError`, sent by
  `DivesSynchronisation.uploadDives`. How fast the queue is sent is not known [?] (owner's check below).
- **The save's answer to the app carries the stored dive [R]:** `result.dive` (a list with one record, 387 keys),
  `result.divestats` and `result.potential_duplicate` (seen on an update of a dive without samples). Dive Hub doesn't
  read `result`.
- **To read the app's code again:** `adb -s <emulator> shell pm path com.divessi.ssi`, `adb pull` each file; the Dart
  code is `lib/arm64-v8a/libapp.so` in `split_config.arm64_v8a.apk`, and its readable strings hold the call names.

### Saving: `what=save_divelog`

- `POST …&what=save_divelog&token=…`, `Content-Type: application/x-www-form-urlencoded`, body `json_data=<the record as JSON>` [S].
- **Create:** `odin_user_log_id: null`. **Update:** the existing ID. **Delete:** an update with `odin_user_log_deleted: true`
  (SSI hides the dive; there's no way back in the app) [S]. A delete with `true` removed the dive from the logbook
  (2026-10-23, app 5.0.43) [T] ([research](../research/2026-10-23-ssi-foundation-checks.md#does-the-full-record-with-booleans-go-through-and-does-a-delete-with-true-work-after-the-fixes)).
- Answer to a **create**: `{ ok: "added to Log", error: "", odin_user_log_id: <id> }` [T]. Dive Hub takes the dive ID
  from it; without one, the create counts as refused (`provider_refused`).
  - A create got the dive ID and number of an earlier dive that had been deleted with the same date and time
    (2026-10-23, app 5.0.43) [T] ([research](../research/2026-10-23-ssi-foundation-checks.md#open-a-create-got-the-id-of-an-earlier-deleted-dive)).
    SSI may revive such a dive instead of making a new one; the cause is not known [?].
- Answer to an **update**: the same answer **wrapped in `success`**:
  `{ success: { ok: "updated", error: "", temp_id: "", odin_user_log_id: <id> }, result: … }` [T] (owner's dive #90,
  2026-10-06, from the server log; the community projects' unwrapped answer [S] was wrong for it). Dive Hub reads the ID
  and the error from `success` when it is an object. Until 2026-10-06 it looked only at the top level and refused every
  update SSI had in fact stored: Pushes `provider_refused`, the Dive "changed since sent", the dive at SSI not known as
  sent by Dive Hub. Sending again records it: confirmed with the fix on the owner's dive #90 (2026-10-06, update confirmed,
  read back with no differences). A **delete** goes through the same save and is read the same way; it was
  tested (2026-10-23, app 5.0.43): the dive left the logbook [T] ([research](../research/2026-10-23-ssi-foundation-checks.md#does-the-full-record-with-booleans-go-through-and-does-a-delete-with-true-work-after-the-fixes)).
  The raw answer body wasn't recorded [?].
- **The whole record goes every time**: every key of the app's own row, unused ones `null`. `ssi-dive-row.ts` declares
  the app's 345 keys and their types [R]; `ssi-record.ts` builds the empty and the writable record from it. Dive Hub also
  sends `odin_user_log_date` and `odin_user_log_entry_time`. Whether SSI accepts a partial record is untested.
  - **An update that omits a key can clear it at SSI** [T] (2026-10-23, app 5.0.43): leaving out
    `odin_user_log_gear_details` cleared the gear note; the equipment list (`odin_user_log_gear`) survived
    ([research](../research/2026-10-23-ssi-foundation-checks.md#does-an-update-that-omits-a-key-keep-its-value)). So an update
    re-sends SSI's current record (from `get_divelog`) with Dive Hub's values on top, and the gear note and the five
    `log_extended_data_*` keys go with it; values edited in the app (rating, buddies, …) survive.
  - **An update keeps what the app changed, and a key sent as `null` is cleared** [T] (2026-10-24, app 5.0.43): `null` cleared
    all 14 keys tested ([research](../research/2026-10-24-ssi-clearing-keys.md)); a send of SSI's own record with the notes taken
    kept the notes the owner wrote in the app and set the lead to 8 kg, and a removal here cleared the notes at SSI
    ([research](../research/2026-10-24-ssi-two-way-checks.md)).
  - Read-only keys of the read side (`updates`, `app_version`, …) are left out.
  - **Booleans go as JSON booleans** (`true`/`false`), as the app sends them [R]; until 2026-10-23 Dive Hub sent `0`/`1`.
    SSI stored the full record with booleans as sent, with no read-back differences, and returns the four booleans
    (`odin_user_log_deleted`, `_apple_watch`, `_dive_on_own_risk`, `_ean`) as the numbers `0`/`1` (2026-10-23, app 5.0.43)
    [T] ([research](../research/2026-10-23-ssi-foundation-checks.md#does-the-full-record-with-booleans-go-through-and-does-a-delete-with-true-work-after-the-fixes)).
    The import reads booleans in every form SSI gives them.
- SSI's dive number (`odin_user_log_nr`) is the client's choice: Dive Hub takes the highest in the logbook + 1, or Dive Hub's own number on a create when the Connection follows numbers and it is free (ADR 0048) [S].
  Planned ([ADR 0048](../decisions/0048-dive-numbers.md), slice 22b): the Dive's own number where the Connection is
  set to follow and no dive in SSI's logbook has it; whether an update can change it is an owner's check below.

### The dive record: the fields Dive Hub fills

From `ownFields()` in `apps/server/src/providers/ssi/ssi-record.ts`. On an update, a field Dive Hub has no value for keeps SSI's value.

| SSI key | From | Notes |
|---|---|---|
| `odin_user_log_nr` | the dive number | On a create, Dive Hub's number when the Connection follows numbers and no dive in the logbook has it, else the highest + 1 (SSI's own way). On an update the existing number is kept until the checks below show that a changed one is taken [S] |
| `odin_user_log_datetime`, `_date`, `_entry_time` | start + UTC offset | `YYYY-MM-DD HH:MM` local wall-clock time, **no time zone**; SSI keeps minutes [S] |
| `odin_user_log_divetime` | duration | whole minutes; SSI rounds [S] |
| `odin_user_log_depth_m` / `_ft`, `_avg_depth_m` / `_ft` | max / average depth | both units are sent |
| `odin_user_log_watertemp_c` / `_f`, `_watertemp_max_c` / `_f` | lowest / highest water temperature | |
| `odin_user_log_var_watertype_id` | the Dive site's water type (ADR 0025) | 4 fresh, 5 salt, brackish nothing [S] (one project had them swapped) |
| `odin_user_log_dive_sites_id` | the Dive site's SSI site ID | required by Dive Hub; the web form refuses a dive without one [S] |
| `odin_user_log_comment` | notes | |
| `odin_user_log_buddy_ids` | the Participants (buddies, guides, instructors) | entry IDs of the User's buddy list, as numbers, found by the Diver's SSI account (`buddy_master_id`); one not in the list is left out. On update, IDs set in SSI's app stay ([ADR 0029](../decisions/0029-push-requirements-and-buddies.md)) [T] |
| `odin_user_log_ean`, `_ean_percent` | first gas | 1 + O₂ % for nitrox; 0 + 0 for air [S] |
| `odin_user_log_gf_set` (`"40 / 85"`), `_gf_set_1`, `_gf_set_2` | GF low / high | |
| `odin_user_log_cns_start`, `_cns_end` | the Recording's CNS | |
| `odin_user_log_pos_start_*`, `_pos_end_*` | entry / exit position | |
| `odin_user_log_divecomputer_serial_nr`, `_manufacturer`, `_name`, `_ref`, `_firmware` | the Device | **the serial binds the dive to a device record at SSI**; without it the app shows its own brand. SSI drops leading zeros [S]. Changing the manufacturer later creates a second device record [S] |
| `odin_user_log_divecomputer_imported` | `true` with a Device | the app shows a computer icon [S] |
| `odin_user_log_divecomputer_dive_ref` | `divehub-<Dive id>` | Dive Hub's reference: finds the dive again when an answer was lost |
| `odin_user_log_user_master_id`, `_nr`, `internalPk` | the account, SSI's dive number | |
| `odin_user_log_dive_type` | the Recording's dive mode | apnea 6, CCR 8, SCR 4, two or more gases 2, else 0; a Dive without a Recording sends 0 on a create and leaves SSI's value on an update; SSI's training types (7, 1, 3, 5, 9) are kept. The app shows 6 as a freedive [T] ([research](../research/2026-10-24-ssi-values-checks.md#does-the-app-show-an-apnea-dive-as-a-freedive)) |
| `odin_user_log_tank_vol_l`, `_tank_vol_cuft`, `_pressure_start_bar` / `_psi`, `_pressure_end_bar` / `_psi`, `_var_tanktype_id` | the Dive's one Cylinder | none with two or more Cylinders; tank type 19 steel, 20 aluminium. Stored as sent; the app shows type, size and both pressures [T] ([research](../research/2026-10-24-ssi-values-checks.md#does-the-app-show-the-tank-the-lead-and-the-cns)) |
| `odin_user_log_weight_kg`, `_weight_lb` | the lead | stored as sent; the app shows the weight [T] |
| `odin_user_log_si_before` | the Recording's surface interval | **seconds** [T], 180 to 86 400, else null ([research](../research/2026-10-24-ssi-values-checks.md#is-the-surface-interval-in-seconds-or-minutes)) |
| `odin_user_log_heartRateAvg`, `_heartRateMin`, `_heartRateMax` | the Recording's heart rate | stored as sent [T]; the app reads the series, but a flat line is not visible as its own line [T, partial] ([research](../research/2026-10-24-ssi-values-checks.md#does-the-pressure-curve-show-and-the-heart-rate)) |
| `odin_user_log_tankPressureDataset`, `_heartRateDataset` | the pressure and heart rate series | JSON arrays, one value per sample; stored as sent [T] |
| `odin_user_log_depthDataset`, `_tempDataset`, `_gfSurfDataset`, `_gfnowDataset`, `_diveSamples` | Primary recording's samples | JSON **strings**; see below |

Not sent (null): rating, air temperature, visibility, conditions other than water type, the
leader number (`odin_user_log_leader_nr`), dive centre, wildlife; gear is not filled, and an update keeps SSI's gear note and list. The **surface interval** (`odin_user_log_si_before`) is in **seconds** [T] ([research note](../research/2026-10-24-ssi-values-checks.md#is-the-surface-interval-in-seconds-or-minutes)): 90 showed as 1 minute, 5400 as 1 h 30 min. Dive Hub sends it only from 180 to 86 400 s (the app's 3 to 1440 minutes [R]), else null; the older claim of minutes was wrong.
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
| `a` | Mares alarm bits [R] | 0 |
| `mf` | phase bits: dive `0x08000000`, at depth `0x00010000` (from 8.5 m down until above 6 m), surfaced `0x04000000` (≤ 1 m) [S] | |
| `o`, `dr` | open circuit, deco required [R] (`o` is not "obligation") | `o: false` for CCR and SCR, `true` otherwise (as the app writes open circuit; stored by SSI, 2026-10-23, [T], see the [research note](../research/2026-10-23-ssi-foundation-checks.md)); `dr` false |
| `rv` | record version, 3.0 as the app writes it [R]; the app's chart is said to hang without it [S] | 3.0 |
| `pr` | tank pressure as `{"t": <tank index>, "v": <value>}` [R]; the community's `pressure` key is not one the app reads | sent from the Recording's tank pressure series, `t` 0 for the first tank; without a series no `pr` key at all; the app draws it as "Druck (bar)" [T] |
| `hb` | heart rate, bpm | sent from the heart rate series (held when it ends early) [T] |
| `cn` | CNS, % | sent from the CNS series [T] |

**Types matter** [S]: the app reads `d`, `s`, `te`, `gs`, `gn` and `rv` as floating-point numbers, and an integer there
reportedly breaks the dive's view. App 5.0.43's decoder takes any JSON number there [R], so this may hold only for an older
version or another reader [?]. The app's sample record has 37 keys in all (CNS, heart rate, gas mix, deco stops, …):
[research note](../research/2026-10-22-ssi-app-opportunities.md#1-the-sample-record-odin_user_log_divesamples-r). JavaScript's `JSON.stringify` writes `0.0` as `0`, so Dive Hub writes this string
itself (`samplesJson()`).

### Buddies (checked 2026-10-05)

Read once from the owner's account through Dive Hub's own Connection (a temporary read-only check that printed IDs and
initials only; 8 buddy-list entries, 5 dives with buddies) [T]:
- **A dive's `odin_user_log_buddy_ids` holds entry IDs from the account's buddy list, not SSI accounts** [T]. Example:
  dive #90 had `[3786888, 2826964]`; those are the `id`s of two entries in `logbook_buddies`, whose SSI accounts
  (`buddy_master_id`) are 4989164 and 4512484.
- The IDs are **JSON numbers** [T]. `localBuddyIds` reads as `null` [T] (the app's own field; divesend sends `[]` on create [S]).
- `logbook_buddies[]` entries have the keys `id`, `master_id`, `buddy_master_id`, `firstname`, `lastname`, `forename`,
  `nickname`, `dob`, `email`, `phone` (some also `mobile_c`, `phone_c`), `address`, `city`, `country`, `comment`,
  `image`, `image_timestamp`, `leader_nr`, `leader_active`, `confirmed`, `favorite`, `deleted`, `added` [T].
- **`master_id` equals `buddy_master_id`** in every entry: both are the buddy's SSI account. Nothing in an entry names
  the account whose list it is in [T].
- Every entry in the owner's list had an SSI account; whether the list can hold people without one is [?].
- `odin_user_log_leader_nr` was `""` on every dive with buddies [T].
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
  the dive in the app [T] (owner, 2026-10-06).

### A dive as SSI returns it (checked 2026-10-06)

Dive Hub's upload #91 (Garmin Descent Mk3, 74 min) read back through the owner's Connection, field types and computer
fields only [T]:
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
- *Older records* (SSI's iOS app 4.1.203, early 2025; seen on a Mares Puck 4's dives, 2026-10-06) [T]: serial number,
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
  volume on 13, a volume and a type only on 8, none on 106 [T].
- Kept: each dive's record as received, as one JSON Original; the buddy list itself never (only entry → account, on the
  Import), and of `logbook_sites` each site's name, position, country (alpha-2) and water type (`bow`: salt or fresh;
  artificial or missing is none, as in the site list). The private flag isn't read (owner, 2026-10-06).
- A dive's site (slice 15a): the site here with that SSI ID, else the same site by name and position (it gets the ID),
  else, only if an admin allowed SSI's site data, a site made from the logbook's entry (marked "From SSI").

### Sites: `save_divesite`, `get_divesite` (checked 2026-10-24, app 5.0.43)

Tested on the owner's account [T]; details in [the research note](../research/2026-10-24-ssi-site-checks.md).

- **`save_divesite`** (query `token`; body `json_data` = the site row, keys in [the write bodies](../research/2026-10-22-ssi-write-bodies.md), without `internalPk` and `needsUpload`) with `odin_dive_sites_id` null creates a site. HTTP 200; the new ID is at the answer's top level `odin_dive_sites_id` (also `success.New.odin_dive_sites_id` and `result.site.odin_dive_sites_id`) [T].
- A private site: `odin_dive_sites_is_private` 1 (`true` accepted, stored as 1) and `odin_dive_sites_is_private_owner` the account's `mid`. `result.site` repeats both [T].
- **Flags are answered as the numbers 0/1** [T].
- **`get_divesite`** (query `token`, `dsid`) answers HTTP 200 with a JSON **array of one row** (not an object), carrying `odin_dive_sites_is_private`, `_is_private_owner` and `_deleted`. An unknown ID answers HTTP 404 [T].
- A new site with no dive is in `logbook_sites` of `get_divelog` right after creation, with `is_private` 1 and the owner [T].
- **A site cannot be deleted**: `odin_dive_sites_deleted` true or 1 is answered "update saved" but not stored, and the site stays in `logbook_sites` [T]. The app never sets the flag and has no delete call or button [R]. A site created at SSI is permanent.

## Known but not used

| Call | What | Note |
|---|---|---|
| `get_user_data` | profile: name, address, birthday, units | [S] |
| `get_divelog_vars` | ID → name lists for conditions (weather, entry, water body, current, surface, dive type, special dive, tank) | [S]; fetch at runtime when conditions are sent. Answers without a token [T] (2026-10-08): `logbook_vars.tanktype` is `{ 19: "steel", 20: "alu" }`, `logbook_vars.suit` `{ 85: "other", 86: "shorty", 87: "wetsuit", 88: "semidry", 89: "drysuit" }`; the two tank types are a constant in `ssi-import.ts` |
| `get_buddies` | buddy list, the same entries as `logbook_buddies` in `get_divelog` ([Buddies](#buddies-checked-2026-10-05)) | [S]; no call to add a buddy is known |
| `get_ccards` | certifications (card ID `ccard_uid`, course, date, instructor and centre numbers) | [S]; [R] answers used by the certification import (ADR 0050): the picture of a card is `https://my.divessi.com/cert/<ccard_uid>`, a PNG served without a token (public by card ID) |
| `get_gear`, `save_gear`, `delete_gear`, `get_gearsets`, `save_gearset` | equipment | [S] |
| `get_divelog_history`, `set_divelog_history` | the account's totals from before the logbook (`history_scuba_totaldives`, `_since`, `_totaldivetime`, …, the same for freediving) | [R] the read, in the capture of 2026-10-10; the write is a name in the app's code only |
| `sonar` | the app's social feed (about 830 KB) | [R], capture of 2026-10-10 |
| `APP_CACHE_CENTER.zip` (`/app/…`, no sign-in) | dive centres | [S]; no licence, like the site list |
| `my.divessi.com` web logbook | form posts with a session cookie, SSO via `rest.divessi.com/sso/login` | [S]; the fallback if the app API closes |

## The site list: `APP_CACHE_SITES.zip`

Used by the admin's SSI site import ([ADR 0025](../decisions/0025-ssi-site-import-and-site-water-type.md)), at the
operator's risk: **SSI gives no licence for it**, and the EU database right protects it (ADR 0024). Checked [T] on
2026-10-05 against one download into `samples/private/` (git-ignored, never committed, nothing derived from it kept).

- `GET https://api.divessi.com/app/APP_CACHE_SITES.zip`, **no sign-in**. Answer: `200`, `application/zip`, 2.5 MB [T].
- One file inside, `sites.json`, 19 MB [T]:
  `{ created, divesites_total, divesites_locked_total, divesites_deleted_total, divesites: [...] }`.
  On 2026-10-04: 24,510 entries in `divesites` (36,639 total, 24,468 locked, 333,914 deleted) [T].
- Per site [T]:

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
| `apps/server/src/providers/ssi/ssi-transport.ts` | makes every call; reads the answer: body `status` 401 / `authenticated: false` signed out, 503 `maintenance`, other non-2xx unavailable, non-JSON `bad_response` |
| `apps/server/src/providers/ssi/ssi-client.ts` | the calls; errors as reasons (`wrong_credentials`, `signed_out`, `refused`, `unavailable`, `maintenance`, `bad_response`), never with a URL |
| `apps/server/src/providers/ssi/ssi-dive-row.ts` | the app's 345 keys and their types |
| `apps/server/src/providers/ssi/ssi-record.ts` | Dive → record (the empty and the writable record are built from `ssi-dive-row.ts`), samples, update and delete records, read-back comparison, fingerprint |
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
   - Pushes fail with `provider_unavailable` (an HTTP error, HTML, or JSON without the expected keys), or with `provider_refused` (no dive ID in the answer), or with `provider_not_stored` (SSI answered and stored nothing: [above](#saves-only-from-the-apps-user-agent-2026-10-10)).
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

From the research note. Record the result here with date and app version, and turn [S] into [T]:
- [ ] In-app terms of use: any clause on automated access or third-party apps. Not checked (2026-10-05): the owner
  doesn't know of any. It affects the risk for each User's SSI account (SSI could block it), not whether the code works.
- [x] A dive sent from Dive Hub shows in the app and its profile chart renders [T] (owner, 2026-10-05, app 5.0.34 on
  Android).
- [x] Update and delete show in the app [T] (owner, 2026-10-05, app 5.0.34 on Android).
- [x] The create answer contains `odin_user_log_id` [T]: sending stored SSI's dive ID, which updating and deleting used.
- [ ] Token lifetime: still valid one day after connecting (owner, 2026-10-05). Check again after a week
  (`round-trip.ts token`, or whether the Connection asks to sign in again). Expired-token answer: still open after
  0.3 h and 3.3 h (2026-10-23, `round-trip.ts expired`, [research](../research/2026-10-23-ssi-foundation-checks.md)); rerun with an older token.
- [ ] Side effects: after an API sign-in, is the phone still signed in? A "new sign-in" e-mail? 2FA in the account settings?
- [x] What a dive's buddy IDs are: entry IDs from the account's buddy list, as numbers [T] (owner, 2026-10-05; see
  [Buddies](#buddies-checked-2026-10-05)).
- [x] Buddies sent from Dive Hub show on the dive in the app [T] (owner, 2026-10-06, slice 14).
- [ ] Same person, two accounts: compare the entry `id` of one shared buddy in both lists (per pair, or one ID).
- [x] Private sites in the logbook read [T] (owner's account, 2026-10-06, `logbook_sites` downloaded raw through the
  Connection): 4 of 26 entries are private (`odin_dive_sites_is_private: 1`, `odin_dive_sites_is_private_owner` = the
  owner's own SSI account). None of the 4 is in the public zip, three of them older than it: private sites stay out of
  the public list, and the zip's 43 are likely older ones that got published. The flag isn't read: once an admin allows
  SSI's site data, the dive import makes them shared sites like any other, which the owner wants (2026-10-06).
  Entries also carry `odin_dive_sites_comment` (9 of 26 non-empty), SSI's statistics (`myloggedDives`, …), aliases and
  wildlife IDs; Dive Hub keeps only ID, name, position and country.
- [ ] A buddy code and a professional's code drawn by Dive Hub: does SSI's app take them (add the buddy; verify a
  dive)? And what do `leader_nr` and `leader_active` hold for a professional and for someone who is none?
- [ ] The app's upload queue ([research](../research/2026-10-10-ssi-app-bulk-upload.md#owners-checks-open)): log three
  or four manual dives in the emulator in airplane mode, go online with HTTP Toolkit recording. One call or several,
  the gaps between them, the calls that follow.
- [ ] The save's answer from Dive Hub: does a create's answer hold `result.dive`, and does it hold the samples?
- Dive numbers ([ADR 0048](../decisions/0048-dive-numbers.md)), asked 2026-10-09. Run with `round-trip.ts number`
  (it needs `SSI_SITE_ID`; it makes and deletes throwaway dives in 2000; `--pause` waits for Enter between steps)
  ([what it does and what each result switches](../research/2026-10-09-dive-numbers.md#owners-checks-the-builds-first-step)).
  Run on 2026-10-10 with the owner's account, from a temporary panel in Dive Hub with the Connection's own sign-in [T]:
  - [x] An update with another `odin_user_log_nr` changes the number: a dive created as 92 and saved again with 94
    read back as 94. `internalPk` doesn't have to follow: it reads back `null` whatever was sent. Not looked at: the
    number in the app's own view. So SSI's adapter sets numbers on an update and with "Set number".
  - [x] SSI takes a number twice without a word, by an update (a second dive saved with 94: both read back as 94) and
    by a create (a third dive created as 94). Nothing at SSI stops a duplicate: Dive Hub looks in the logbook it reads
    before every save and never sends a number another dive there has.
  - [ ] A verified dive whose number is changed (`round-trip.ts number --dive … --to …`, only if the owner wants to
    risk one): is the verification still there? Until shown, Dive Hub warns that it may be lost.
  - [x] After a delete the other dives keep their numbers: none of the 88 dives had another number after the three
    throwaway dives were deleted. The record's key `reset_profile_divelog_number_with_deletion` was sent as the record
    has it by default; its effect with another value is unknown.
- [ ] The first Push runs ([ADR 0047](../decisions/0047-push-runs.md)): does SSI refuse anything when 100 dives go
  5 s apart (a save, or the logbook read after it)? Record the `SSI call` line's `detail` and the count that went.
- [x] Surface interval: seconds or minutes. Seconds [T] (2026-10-24): 90 showed as 1 minute, 5400 as 1 h 30 min
  ([research](../research/2026-10-24-ssi-values-checks.md#is-the-surface-interval-in-seconds-or-minutes)); the earlier [R] reading of minutes was wrong.
