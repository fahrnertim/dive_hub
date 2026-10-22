---
title: QR code formats of the SSI app (app 5.0.43)
summary: Every QR text the MySSI app makes or reads - buddy, professional, dive centre, dive site, dive and SSI links - with the keys it reads and what it does on a scan; with what is certain and what is not.
status: open
date: 2026-10-22
---

# QR code formats of the SSI app (app 5.0.43)

Read from the app with Blutter ([R] = read in the code). Complements the buddy and verification codes already in the
[SSI reference](../references/ssi-app-api.md) ("Verification codes") and [how a dive is verified](2026-10-22-ssi-dive-verification.md).
Real codes seen so far are in the reference; this note adds what the code says.

## The reader [R]

- A text is split at `;`. The first part is the **type**. A later part **without** `:` is read by position and type: the second part of a
  `buddy` is `masterId`, of a `center` is `centerId`, of a `site` is `siteId`; for any other type such a part is dropped.
  Every part **with** `:` is `key:value` (split at `:`).
- **No trimming.** The app's own centre code is drawn as `center; <id>; name: <name>` (spaces after `;` and `:`), so the reader
  must tolerate them, which it does for numbers (Dart's number parser ignores surrounding blanks) [?: not run]; a name keeps its
  leading blank. Dive Hub's `center;<n>;name:<name>` (ADR 0043) is the same text without the blanks.
- A second reader accepts a link-like text: the first part is cut at `/` and `:` and its **last piece** is the type
  (`…/buddy`, `…/center`, `…/site`); the rest as above. It is used when a text starts with `http` (buddy code as a link; the
  short keys `m`, `f`, `l`, `e`, `pro` stand for `masterId`, `firstName`, `lastName`, `email`, `leaderNr`) [R for the keys,
  ?: the exact text shape was not seen].
- Any text on `divessi.com` or `mares.com` that is not one of these is opened as a **link** in the browser/app.
- There is no signature, check digit or expiry in any of them.

## The formats

| Type | Text | Made by | Keys read | What a scan does (outside a dive) |
|---|---|---|---|---|
| Buddy | `buddy;<masterId>;firstName:<f>;lastName:<l>;email:<e>` | the user's own code (profile / "my QR") | `masterId`, `firstName`, `lastName`, `email` | opens the buddy's page; or adds the buddy (`create buddy`); or starts a new dive with that buddy |
| Professional | the buddy text plus `;leaderNr:<n>` | the same, for a user with a leader number | the above and `leaderNr` | opens the **bulk verify** page for that professional (or **bulk unverify**) |
| Dive centre | `center;<centerId>;name:<name>` (the app draws `center; <id>; name: <name>`) | a centre's page / a centre's own code | `centerId` (and `name`) | shows the centre, or **verify dives with centre** (bulk) |
| Dive site | `site;<siteId>` | a site's page (share) | `siteId` | opens the site, or starts a new dive at that site |
| Dive | `dive;noid;dive_type:<n>;divetime:<…>;datetime:<…>;depth_m:<…>;site:<id>;var_weather_id:…;var_entry_id:…;var_water_body_id:…;var_watertype_id:…;var_current_id:…;var_surface_id:…;var_divetype_id:…;user_master_id:…;user_firstname:…;user_lastname:…;user_leader_id:…;watertemp_c:…;airtemp_c:…;vis_m:…;watertemp_max_c:…;deco:1` | a dive's detail page or the end of the dive wizard | the same keys, mapped to the dive's own fields (`odin_user_log_*`) | starts a **new dive** prefilled from the code (a buddy copies a dive); `noid` is a placeholder where an ID would be |
| SSI link | any `https://…divessi.com/…` or `…mares.com/…` | web pages | - | opened as a link |

Notes on the table:
- Which fields of the **dive** code are present depends on the dive (empty ones may be left out; `deco:1` only for deco dives)
  [?: from the key list, not seen in a real code]. The dive reader sets the buddy list from `user_master_id`, so the sender becomes
  a buddy of the new dive.
- The **buddy** and **professional** texts differ only by `leaderNr`; that one key decides between "add a buddy" and
  "verify dives". The user's own code is the same text the scanner of another user reads.
- The scanner has request types that decide what it accepts: all kinds (`all`, shows a result sheet with the matching actions),
  a dive code only (`dive`: anything else gives `qr_wrong_type`), `diveVerification` and `diveUnVerification` (a centre or
  professional code for one dive), `buddyAddFromDive` (a buddy code while editing a dive's buddies) and `diveSiteForDive`
  (a site code while editing a dive). Exactly which types each request type accepts, beyond the dive case, was not read.
- Reading from a **gallery image** uses the same reader as the camera.

## What this means for Dive Hub

- Everything that matters for verification is two texts: the **centre** text and the **professional's** text (buddy text with
  `leaderNr`). Dive Hub's codes (ADR 0043) are in the accepted shape.
- A buddy/professional text needs the account ID (`masterId`) first, then the named keys; **the name and e-mail may be ignored**
  by the server, and the app reads `leaderNr` to decide it is a professional [?: no check that the name matches was found in the app].
- A **dive** code could be made by Dive Hub so that SSI's app starts a prefilled dive from it. The key set is above; whether
  the app's reader needs all keys was not checked.
