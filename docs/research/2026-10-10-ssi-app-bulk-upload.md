---
title: Does SSI's app know a bulk upload call?
summary: No. The app's compiled code (5.0.43) names one save call, `save_divelog`, and its import of several dives from a dive computer saves one dive at a time; the app keeps a local queue (`needsUpload` per dive). How fast the queue is sent is still open (an owner's capture). The save's answer carries the stored record, which could replace the read-back in a Push run.
status: open
date: 2026-10-10
---

# Does SSI's app know a bulk upload call?

Asked by the owner (2026-10-10) before slice 22c, now that the app can be captured
([how](../references/ssi-app-api.md#capturing-the-app)). The [research of 2026-10-09](2026-10-09-push-runs.md) read
public pages only and left the app's own way of uploading open. Nothing was sent to SSI for this note. Markers as in
the [SSI reference](../references/ssi-app-api.md): **[R]** seen ourselves, **[S]** reported, **[?]** not known.

## Answer

**No bulk call is in the app [R].** [ADR 0047](../decisions/0047-push-runs.md) stands as decided: one Dive per call.

## How it was read

- **The app's code.** The APK files of `com.divessi.ssi` 5.0.43 (version code 588) were pulled from the emulator with
  `adb pull`; `lib/arm64-v8a/libapp.so` in `split_config.arm64_v8a.apk` is the compiled Dart code. Its readable strings
  (about 89,000) hold the call names, the class and method names and the translation keys. Compiled code shows names,
  not what a method does.
- **The capture** of 2026-10-10 (`samples/private/HTTPToolkit_2026-10-10_15-12.har`, git-ignored): 22 different calls
  from sign-in to one saved dive.

## What the code shows

- **One save call.** The only names with `divelog` that are calls: `get_divelog`, `save_divelog`,
  `get_divelog_history`, `set_divelog_history`. No `save_divelogs`, no name with `bulk`, `batch` or `multi` that is a
  call [R].
- **The import from a dive computer saves one dive at a time.** The methods of the import screen are `_importBulk`,
  `_importBulkForLoadedDives`, `_batchImport`, `_batchImportAllDataLoaded` and **`_batchImportSaveOneDive`** [R].
  "Bulk" is the user's choice of several dives (`ble_bulk_import_selection`); the saving is per dive.
- **A local queue.** The app keeps dives in SQLite (drift) with `needsUpload`, `uploadError`,
  `needsVerificationUpload` and `needsUnverifyUpload` per dive, and sends them from `DivesSynchronisation.uploadDives`
  and `uploadDivesAndSites` (also `saveAndSyncDive`, `_getNumberOfUnsyncedDives`) [R]. This confirms "local-first with
  a background sync" from the earlier note. The app sends these flags along in the record; SSI stores the dive anyway.
- **"Bulk verify" is something else:** `DivesBulkVerifyView` and `verifyBulk` let a professional verify several dives
  of a diver (routes `/dives-bulk-verify4`, `/dives-bulk-unverify`). The call behind it wasn't looked for.
- **Not ruled out:** whether SSI's server would take a list in `json_data`. The app sends one record (an object) [R],
  and no client is known to have tried a list. Trying it means sending to SSI; it wasn't done.

## What the capture adds

- **The save's answer carries the stored dive [R].** The app's save (an update) was answered
  `{ success: { ok: "updated", … }, result: { dive: [ <one record, 387 keys> ], divestats: { … }, potential_duplicate: 0 } }`.
  The record has SSI's dive ID and the number sent. It was a dive without samples, so whether the answer returns
  samples is not known [?], and neither is a create's answer to the app's parameters [?].
- **`potential_duplicate`** in the answer: SSI's own duplicate check, as a number. What sets it is not known [?].
- **No logbook read after the save** in the capture, which ends with the save; the app may read later [?].
- **`get_divelog_history`** returns the account's totals (`history_scuba_totaldives`, `_since`, `_totaldivetime`, …,
  and the same for freediving): the "dives before this logbook" the app asks for when the logbook is set up
  (`set_divelog_history` writes them). **`sonar`** is the app's social feed (about 830 KB).

## What it means for Push runs

- **Nothing changes in slice 22c.** One job per Dive is how SSI's own app sends.
- **The pause is still our own guess.** How fast the app empties its queue is the one thing the code can't show.
- **A possible saving, not decided:** Dive Hub reads the whole logbook back after every save (about 1.8 MB for the
  owner's account), and the logbook read is the one call SSI is known to throttle. If the save's answer carries
  everything the read-back compares, including samples, a run could compare against the answer and read the logbook
  once. That changes how `pushes.send` confirms a save, so it needs its own ADR and these checks first.

## Owner's checks (open)

Listed in the [SSI reference](../references/ssi-app-api.md#owners-checks-pending):

1. **The app's queue.** In the emulator, with HTTP Toolkit recording: switch to airplane mode, log three or four
   manual dives, go online. Read from the capture: one call or several, the gaps between them, and which calls follow.
   The dives are real dives in the owner's logbook; delete them afterwards.
2. **The save's answer from Dive Hub.** The next sends from Dive Hub log SSI's answer: does a create's answer hold
   `result.dive`, and does it hold the samples?
