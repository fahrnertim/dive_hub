---
title: SSI app API (MySSI)
summary: SSI's private, undocumented app API as Dive Hub uses it - endpoint, sign-in, reading the logbook, saving (create, update, delete), the dive record and its samples, the site list (checked 2026-10-05), quirks, and what to do when SSI changes it. Each fact is marked with where it comes from.
status: living
date: 2026-10-05
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

As of 2026-10-05 the site list, sending, the profile chart, updating and deleting are [R]; the other account checks are pending.

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

### Saving: `what=save_divelog`

- `POST …&what=save_divelog&token=…`, `Content-Type: application/x-www-form-urlencoded`, body `json_data=<the record as JSON>` [S].
- **Create:** `odin_user_log_id: null`. **Update:** the existing ID. **Delete:** an update with `odin_user_log_deleted: 1`
  (SSI hides the dive; there's no way back in the app) [S].
- Answer: `{ ok: "added to Log" | "updated" | "deleted", error: "", odin_user_log_id: <id> }` [S]. Dive Hub takes
  the dive ID from it; without one, the save counts as refused (`ssi_refused`).
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
| `odin_user_log_ean`, `_ean_percent` | first gas | 1 + O₂ % for nitrox; 0 + 0 for air [S] |
| `odin_user_log_gf_set` (`"40 / 85"`), `_gf_set_1`, `_gf_set_2` | GF low / high | |
| `odin_user_log_cns_start`, `_cns_end` | the Recording's CNS | |
| `odin_user_log_pos_start_*`, `_pos_end_*` | entry / exit position | |
| `odin_user_log_divecomputer_serial_nr`, `_manufacturer`, `_name`, `_ref`, `_firmware` | the Device | **the serial binds the dive to a device record at SSI**; without it the app shows its own brand. SSI drops leading zeros [S]. Changing the manufacturer later creates a second device record [S] |
| `odin_user_log_divecomputer_imported` | `true` with a Device | the app shows a computer icon [S] |
| `odin_user_log_divecomputer_dive_ref` | `divehub-<Dive id>` | Dive Hub's reference: finds the dive again when an answer was lost |
| `odin_user_log_user_master_id`, `_nr`, `internalPk` | the account, SSI's dive number | |
| `odin_user_log_depthDataset`, `_tempDataset`, `_gfSurfDataset`, `_gfnowDataset`, `_diveSamples` | Primary recording's samples | JSON **strings**; see below |

Not sent (null): rating, air temperature, visibility, weight, tank, pressures, conditions other than water type, buddies,
dive centre, gear, wildlife, surface interval. For the **surface interval**, one project says seconds and another says minutes [?].
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

## Known but not used

| Call | What | Note |
|---|---|---|
| `get_user_data` | profile: name, address, birthday, units | [S] |
| `get_divelog_vars` | ID → name lists for conditions (weather, entry, water body, current, surface, dive type, special dive, tank) | [S]; fetch at runtime when conditions are sent |
| `get_buddies` | buddy list (`id` per account, `buddy_master_id` = the buddy's SSI account, `leader_nr`) | [S]; no call to add a buddy is known |
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
  | `odin_dive_sites_is_private`, `_is_private_owner` | 43 private sites, with an SSI user ID | **left out entirely** |
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
| `apps/server/src/providers/ssi/ssi-adapter.ts` | SSI's capabilities, sign-in, the logbook read (kept two minutes after a save), the ±2 min match, SSI's dive numbers, the SSI site ID; SSI's record as typed values |
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
- [ ] Surface interval: seconds or minutes. Log a dive in the app with a known surface interval (e.g. 1 h 30 min),
  run `round-trip.ts read`, and look at the dive's surface interval key in `samples/private/ssi/` (90 = minutes,
  5400 = seconds).
