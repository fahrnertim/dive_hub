---
title: Garmin Connect Personal API
summary: Garmin's official, read-only API for one person's own Garmin Connect data (launched autumn 2026) - how a personal API key becomes a 24-hour bearer token, the hosts and the Accept-header quirk, the endpoints Dive Hub needs (activity list with activityType=diving, activity detail with diveInfo, original FIT download as a zip), what a dive carries, rate limits (none published), and the Supplemental Terms (key personal to its owner, not to be shared). Facts marked [T] (tested on the owner's account, 2026-10-31), [D] (Garmin's documentation or official client) or [S] (community report).
status: living
date: 2026-10-31
url: https://developer.garmin.com/gc-developer-program/personal/personal-api/
---

# Garmin Connect Personal API

## What it is

Garmin's official API for an individual's own Garmin Connect data, part of the Garmin Connect Developer Program
(Personal tier, free, no application). Pull only, read only: GET endpoints for activities and wellness data, no
upload or edit [D][S]. The Starter and Enterprise tiers (push, multi-user, approval, paid) are a separate route
[D]. How it was found and what it means for Dive Hub: [research note](../research/2026-10-31-garmin-personal-api.md).

Markers: **[T]** tested on the owner's account on 2026-10-31; **[D]** Garmin's pages or the official Python client
([garmin/connect-personal-api-python](https://github.com/garmin/connect-personal-api-python)); **[S]** community report.

## What we take from it

### Key and token
- The User creates a key at <https://connect.garmin.com/app/settings/personalApiToken> (Garmin Connect web): accept
  the terms, pick an expiry of 30, 90 or 180 days or one year, copy the key; it is shown once [D]. One key at a time;
  a new one needs the old deleted [S]. Garmin e-mails about a week before expiry [D]. Deleting a key revokes its
  tokens [D]. Keys start with `GCDC_` [T].
- Token: `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token`
  with `Authorization: ApiKey <key>` and **`Accept: */*`**: `Accept: application/json` answers 406 [T]. The answer
  is the bare JWT as `text/plain`, not JSON [T].
- The JWT lives 24 hours (`exp - iat`) [T], or until the key expires [D]; no refresh token, a new token comes from
  the key [D]. Claims include `scope`: `CONNECT_READ PERSONAL_API_FITNESS_READ PERSONAL_API_NUTRITION_READ
  PERSONAL_API_USER_READ PERSONAL_API_WELLNESS_READ` [T]. The JWT does not tell when the key expires [T].
- Data calls: `Authorization: Bearer <jwt>` on `https://personal.connectapi.garmin.com` [T]. The token endpoint on
  `connectapi.garmin.com` answers 400; undocumented paths 404 [S].

### Endpoints Dive Hub needs
- **List:** `GET /activitylist-service/activities/search/activities?start=&limit=&startDate=&endDate=&activityType=`
  [D]. `activityType=diving` (the parent type) returns every dive: `single_gas_diving`, `multi_gas_diving`,
  `apnea_diving` and so on [T]; a child type as filter answers 400 [T]. `limit=1000` was accepted and returned the
  whole account (back to 2025-09) [T]; no maximum is documented. Newest first [T].
- **A dive in the list:** `activityId`, `activityUUID`, `activityName`, `startTimeLocal`, `startTimeGMT`,
  `activityType.typeKey`, `duration`, `maxDepth`, `avgDepth`, `bottomTime`, `surfaceInterval`, `isDecoDive`,
  `diveCount`, `minTemperature`/`maxTemperature`, `summarizedDiveInfo` (water type and density, gases),
  `manufacturer`, owner fields [T]. No position in the list or the detail [T].
- **Detail:** `GET /activity-service/activity/{id}` [D]: `summaryDTO` (adds `startCns`/`endCns`, `startN2`/`endN2`,
  `averageTemperature`), `metadataDTO` (`isOriginal`, `fileFormat.formatKey` = `fit`, `lastUpdateDate`),
  `timeZoneUnitDTO`, and `diveInfo` with `diveSettings` (computer model, GF low/high, water type and density, CCR
  setpoints) and `diveGases[]` (O2/He, tank size, start and end pressure with units, SAC rate, gas mode) [T].
- **File:** `GET /download-service/files/activity/{id}` with `Accept: */*` answers `application/x-zip-compressed`, a
  zip holding one `<id>_ACTIVITY.fit`, the original file [T]. Dive Hub's FIT adapter reads it as a full Recording
  (depth and the other series, events, entry and exit position) [T]. Garmin may strip some fields from API files
  [S]; the dive messages were there [T]. Edits made later in Garmin Connect (name, notes) are not in the file [S].

### Limits and errors
- No rate limits are published; the terms let Garmin throttle or refuse without notice [D].
- 400: wrong host or parameter [S][T]; 401: bad token [D]; 401/403 on the token call: key wrong, expired or revoked
  [S]; 404: undocumented path [S]; 406: the `Accept` header [T]. Error bodies are JSON with `errorId` [T].

## Supplemental Terms (last updated 2026-10-01, as the owner received them)

1. **Personal use of the key:** personal to its owner; used only by them, with applications they develop or
   operate for their own use; not to be sold, transferred, sublicensed, distributed, disclosed or shared with any
   third party; the owner answers for its confidentiality and all activity under it.
2. **Rate limits:** Garmin may set and change limits at any time and throttle, delay, reject, suspend or restrict
   requests over them without notice.
3. **Violations** may suspend or end API access and revoke the key, and breach the Garmin Terms of Use.

The FAQ adds that the Personal API is "not intended for commercial applications serving multiple end users" [D].

## Notes
- Read only: Dive Hub can import from Garmin, never send to it.
- The Swagger page (<https://developer.garmin.com/gc-developer-program/personal/swagger-docs/>) renders in the
  browser only; its full parameter list was not read.
- Unofficial routes (garth, garminconnect) need Garmin's web sign-in and are against its terms
  ([dive data sources](../research/2026-10-02-dive-data-sources.md)); this API replaces them.
