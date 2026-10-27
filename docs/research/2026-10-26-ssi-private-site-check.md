---
title: SSI check of a private site on a dive and in the global feed
summary: On the owner's account (app 5.0.43) a dive created through Dive Hub on the existing private test site 1083262 is listed in the logbook with that site, and get_divelog's logbook_sites has it as private with the account as owner. get_divesites_global does not list 1083262 (last_sync as unix seconds or as a datetime string both answered). Finished 2026-10-27: the owner saw the site on the dive in SSI's app, the next day's public zip does not hold it, and the test dive was deleted (the site stays).
status: done
date: 2026-10-26
---

# SSI check of a private site on a dive and in the global feed

Run by the controller with the kept token on 2026-10-26, announced in the session, as `round-trip.ts site visible start` and `site visible global`. Account 3664600, MySSI app 5.0.43. [T] tested on the owner's account. Background: [SSI checks of private sites](2026-10-24-ssi-site-checks.md), [SSI app API](../references/ssi-app-api.md#sites-save_divesite-get_divesite). The modes are in `apps/server/test/fixtures/ssi/site-checks.ts`.

## What was done
- **`site visible start`** [T]: through Dive Hub's createRecord, dive 30137120 (number 93, 2000-01-01 12:00, notes "Dive Hub test") on the existing private test site 1083262. The site is reused: SSI sites cannot be deleted (see the earlier note), so no new site was created.
- **`site visible global`** [T]: `get_divesites_global` with several `last_sync` values.

## What SSI answered
- **The dive uses the private site** [T]: the logbook lists dive 30137120 with site 1083262. `get_divelog`'s `logbook_sites` has 1083262 with `is_private` 1 and the owner set to the account.
- **Two country keys on the logbook site rows** [T]: the rows carry both `odin_dive_sites_country_iso3` and `odin_countries_code_iso`. This matters for the alpha-3 choice for `save_divesite`; which of the two SSI fills from our upload is not claimed here.
- **`get_divesites_global` answers an object** [T] `{ divesites_timestamp, divesites }`.
  - `last_sync` as unix seconds just before the start: 0 rows.
  - `last_sync` as `YYYY-MM-DD HH:MM:SS` (2026-10-25 20:24:10): 1 row; 1083262 is not in it.
  - `last_sync` 1792713600 (unix, 2026-10-23, before the site's creation): 202 rows on one page; 1083262 is not in them.
  - Both formats were accepted, so the format the app uses is still not certain.
  - `limit=1` returned 2 rows with unix seconds, so `limit` may be ignored there.

## Result so far
A private site is usable on a dive by the account that owns it [T], and it is not in the global feed [T] (checked in the rows returned for the dates above).

## Finished 2026-10-27
1. **The owner looked at dive 93 in SSI's app** [T]: it shows the private site "Dive Hub test" (screenshot, 2026-10-27).
2. **`site visible zip`** [T]: `APP_CACHE_SITES.zip` created 2026-10-26 06:40:05 (after the site's creation on 2026-10-24),
   24 604 sites; 1083262 is not in it.
3. **`site visible finish`** [T]: the test dive 30137120 is gone; the site stays (SSI sites cannot be deleted).

## Result
A private site Dive Hub created is usable on the owning account's dive [T] and is in neither the global feed nor the
public zip [T]. That another account can't use the ID directly is not proved; accepted (design, piece 4).

```
pnpm --filter @dive-hub/server exec tsx test/fixtures/ssi/round-trip.ts site visible start
pnpm --filter @dive-hub/server exec tsx test/fixtures/ssi/round-trip.ts site visible global
pnpm --filter @dive-hub/server exec tsx test/fixtures/ssi/round-trip.ts site visible zip
pnpm --filter @dive-hub/server exec tsx test/fixtures/ssi/round-trip.ts site visible finish
```
