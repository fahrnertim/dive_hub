---
title: How the SSI app verifies a dive (app 5.0.43)
summary: What the MySSI app does when a QR code verifies a dive - how it reads the code, what it sets locally, what it sends to SSI, what comes back - and what the app cannot tell about SSI's own checks.
status: open
date: 2026-10-22
---

# How the SSI app verifies a dive (app 5.0.43)

Read from the app with Blutter ([R] = read in the code). The code formats themselves are in the
[SSI reference](../references/ssi-app-api.md) ("Verification codes"), the decision in
[ADR 0043](../decisions/0043-dive-centres-and-ssi-verification-codes.md).

## 1. Reading a code [R]

- The text is split at `;`. The first part is the **type** (`buddy`, `center`, `site`, `dive`). A later part without a `:` takes
  its key from the type: `buddy;<n>` → `masterId`, `center;<n>` → `centerId`, `site;<n>` → `siteId`. Parts with a `:` are
  `key:value`. So `center;1234;name:…` is `{type: center, centerId: 1234, name: …}`.
- The buddy keys used are `masterId`, `firstName`, `lastName`, `email`, `leaderNr`; **`leaderNr` makes it a professional's
  code**. The centre code's `name` is read but, as far as the verification code shows, the centre is found by `centerId`.
- A text starting with `http` is read as a link with short query keys (`m`, `f`, `l`, `e`, `pro`); links on `divessi.com` and
  `mares.com` are treated as SSI links. The camera or an image from the gallery both feed the same reader.
- There is **no signature, token or check digit** in the parsing. Any text of that shape is accepted by the reader.

## 2. What the app sets on the dive, locally [R]

- **Centre code:** `log_linked_facility_id`, `odin_user_log_divecenter_confirmed` = true, `…_confirmed_id` (the `centerId`),
  `…_confirmed_name` and `…_confirmed_logo` (both from the local centre list, looked up by that ID).
- **Professional's code:** `odin_user_log_leader_confirmed_id` and `…_confirmed_name` (first and last name from the code). The
  professional is also **added as a buddy** (looked up by `masterId`, created if missing, buddy list uploaded at once) and put
  into `odin_user_log_buddy_ids`.
- **Both:** `needsVerificationUpload` = true and `odin_user_log_verified` = true (the dive shows as verified at once, before
  SSI has answered). A pending dive-verify reminder is cancelled.
- **Other ways in:** a dive can be verified with the signed-in user's **own** code (`self_verify_*` texts, "verify with
  user"); the conditions for offering it were not read. A dive that lies in the **future** cannot be verified
  (`verify_future_dive`). A professional's code scanned outside a dive opens a **bulk verify** page for that professional.

## 3. What is sent and what comes back [R]

- **Verify:** `POST a21.php?what=divelog_verify`, `json_data` = `{odin_user_log_id, odin_user_log_divecenter_confirmed_id,
  odin_user_log_leader_confirmed_id}`. **Only the three IDs**; names, logo, flags and the code text itself are not sent.
- **Unverify:** `what=divelog_unverify`, `json_data` = `{odin_user_log_id}` [R]; the app also keeps `needsUnverifyUpload`.
- **The answer is authoritative.** The app reads `success`/`ok`, `result.divestats` (the logbook counters) and `result.dive`
  with `verified`, `odin_user_log_divecenter_confirmed`, `…_confirmed_id`, `…_logo`, `…_name`, `…_leader_confirmed_id`, `…_name`,
  and **overwrites its local dive with them**. So the names and the logo shown come from SSI, and SSI can refuse by
  answering something else (what a refusal looks like is not seen).
- The reference notes that an edit of a verified dive's start time removes the verification; the app's code for that was not
  read.

## 4. What the app cannot tell us

- **What SSI checks on `divelog_verify`:** whether the centre must be one the diver has an affiliation with, whether the
  professional must be active, whether the dive date must lie in some window, whether the ID pair must match the real
  centre/professional, and whether the signed-in account must be the dive's owner. The client sends three IDs and accepts
  the answer; every rule is on the server. (The QR scanner screen reads the user's centre affiliations, but what it does
  with them was not read.)
- **Whether `…leader_confirmed_id` is the leader number or the account ID.** The code reads `leaderNr` from the QR text
  and the user's own code carries it, so it is probably the leader number [?].

## 5. Could Dive Hub recreate it? (a fact base, not a decision)

- **Technically the app's step is small:** Dive Hub would need the centre's SSI number (known per centre, ADR 0043) or the
  professional's leader number, the dive's SSI ID, and one `divelog_verify` call. Nothing in the QR is secret: its content is
  fixed and public, and the app itself reads it from a photo.
- **Whether SSI would accept it from Dive Hub is unknown** and can only be shown by a test on the owner's account (a
  write; it also changes what SSI counts as verified). The server rules in section 4 decide it.
- **It would change ADR 0043,** which says Dive Hub never verifies a dive itself, in bulk or in the background, and never
  records that a dive is verified. A verification is a centre's or professional's statement; sending the IDs without that
  person having seen the dive would make the statement Dive Hub's. The app allows the same with a saved code image, so the
  server may not prevent it; whether Dive Hub should is a product decision for the owner, not something the code answers.
