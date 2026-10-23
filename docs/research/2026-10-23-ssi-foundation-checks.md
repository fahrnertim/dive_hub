---
title: SSI checks before the foundation fixes
summary: Two checks on the owner's SSI account, run before the code fixes. An update that leaves out the gear note's key clears the note at SSI (the equipment list survives). A 0.3 h old token is still accepted, so the expired-token answer is still unknown.
status: open
date: 2026-10-23
---

# SSI checks before the foundation fixes

Run on 2026-10-23 with SSI app version 5.0.43 on the owner's account, before the fixes of the foundation piece. Background: [the key table](2026-10-22-ssi-save-divelog-keys.md) and [the review against the decompiled app](2026-10-23-ssi-decompilation-review.md). [T] means tested on the owner's account.

## Does an update that omits a key keep its value?

- Sent: a create with Dive Hub's own keys; the dive was dated 2000-01-01 (a throwaway). The owner then added a free-text gear note and one equipment item (BCD) in the MySSI app and synced. Then today's `updateRecord` sent an update that changed the notes and did not include `odin_user_log_gear_details`.
- Stored at SSI: before the update `odin_user_log_gear_details` was set and `odin_user_log_gear` held 1 item. After it, `odin_user_log_gear_details` was not set; `odin_user_log_gear` still held 1 item.
- Result [T]: an update that omits `odin_user_log_gear_details` clears it at SSI. The equipment list survived.
- Also changed between the two reads, besides the keys we meant to change: `odin_user_log_watertemp_max_f` and `log_extended_data_hashedidentifier` (new values), and the bookkeeping keys (last sync, updates, updated timestamps). The two values are noted, not explained (open).
- For the code: the writable copy must carry every key of the app's row, so nothing the User typed in the app is dropped. Task 2 fixes this. The test dive was deleted afterwards.

## Does an expired token read as "SSI unavailable"?

- Sent: `get_divelog` with the kept token, 0.3 h old. Nothing was written.
- Stored: nothing changed.
- Result [T]: open. The token was still accepted (HTTP 200, a normal logbook answer with no `status` and no `authenticated` key), so how SSI answers an expired token is still unknown.
- For the code: rerun `expired` in Task 5 when the token is older.
