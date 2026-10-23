---
title: SSI checks around the foundation fixes
summary: Checks on the owner's SSI account, before and after the code fixes. An update that leaves out the gear note's key clears the note at SSI (the equipment list survives). After the fixes, the full record with JSON booleans and open-circuit samples is stored with no read-back differences, SSI returns the four booleans as 0/1, and a delete with `true` works. A create got the ID of an earlier deleted dive with the same date and time (cause unknown). A 3.3 h old token is still accepted, so the expired-token answer is still unknown.
status: open
date: 2026-10-23
---

# SSI checks around the foundation fixes

Run on 2026-10-23 with SSI app version 5.0.43 on the owner's account. The first two checks ran before the fixes of the foundation piece, the rest after them (code at the commit "SSI import reads booleans in every form SSI gives them"). Background: [the key table](2026-10-22-ssi-save-divelog-keys.md) and [the review against the decompiled app](2026-10-23-ssi-decompilation-review.md). [T] means tested on the owner's account.

## Does an update that omits a key keep its value?

- Sent: a create with the keys Dive Hub's record had at the time (before the foundation fixes; it did not carry every key of the app's row, and `odin_user_log_gear_details` was not among them); the dive was dated 2000-01-01 (a throwaway). The owner then added a free-text gear note (`odin_user_log_gear_details`) and one equipment item (BCD, `odin_user_log_gear`) in the MySSI app and synced. Then today's `updateRecord` sent an update that changed `odin_user_log_comment` (the notes) and did not include `odin_user_log_gear_details`.
- Stored at SSI: before the update `odin_user_log_gear_details` was set and `odin_user_log_gear` held 1 item. After it, `odin_user_log_gear_details` was not set; `odin_user_log_gear` still held 1 item.
- Result [T]: an update that omits `odin_user_log_gear_details` clears it at SSI. The equipment list survived.
- Also changed between the two reads, besides the keys we meant to change: `odin_user_log_watertemp_max_f` and `log_extended_data_hashedidentifier` (new values), and the bookkeeping keys (last sync, updates, updated timestamps). The two values are noted, not explained (open).
- For the code: the writable copy must carry every key of the app's row, so nothing the User typed in the app is dropped. Task 2 fixes this. The test dive was deleted afterwards.

## Does the full record with booleans go through, and does a delete with `true` work? (after the fixes)

- Sent: a create with every key the code now sends (the app's 345 keys plus `odin_user_log_date` and `odin_user_log_entry_time`), by key name. Booleans went as JSON booleans (`odin_user_log_deleted`, `odin_user_log_apple_watch`, `odin_user_log_dive_on_own_risk` false; `odin_user_log_ean` false for air); samples carried `o: true` (open circuit). The dive was dated 2000-01-01 12:00 with the notes "Dive Hub test". Then an update, then a delete with `odin_user_log_deleted: true`.
- Stored: yes. The read back right after the create showed no difference between what was sent and what SSI stored (the script's read-back comparison printed an empty list).
- Booleans [T]: SSI returns the four as the numbers `0`/`1` (all four read `0` here). The fake SSI already stores `true`/`false` as `1`/`0`, so it needed no change.
- Delete with `true` [T]: the dive was deleted; it was no longer in the logbook.
- For the code: the full record with JSON booleans is accepted and stored as sent. The read side takes `0`/`1` (and other forms) for booleans (the code at e86d669 does).

### Open: a create got the ID of an earlier deleted dive

- Observed [T]: the create got back the dive ID (and the dive number) of the throwaway dive that the first check had deleted. Both dives had the same date and time, 2000-01-01 12:00.
- So SSI may revive a deleted dive of the same date and time instead of making a new one. The cause is not known; only this one case was seen.
- Matters for re-sending a dive that was deleted at SSI. Open until it is looked at again, for example with a different time.

## Does an expired token read as "SSI unavailable"?

- First run: `get_divelog` with the kept token, 0.3 h old. Nothing was written. Second run, after the fixes: the same token, 3.3 h old.
- Stored: nothing changed.
- Result [T]: open. Both times the token was still accepted (HTTP 200, a normal logbook answer with no `status` and no `authenticated` key, the same top-level keys in both runs), so how SSI answers an expired token is still unknown. The age reached is 3.3 h.
- For the code: the transport reads a body `status` 401, or `authenticated: false` outside sign-in, as signed out under any HTTP status. No expired-token answer has been seen yet, so this rule is not tested. Run `expired` again with an older token.
- Owner, 2026-10-23: never had to sign in again in the SSI app since this work began, so a token probably lasts weeks [S]; the check stays open until `expired` sees one fail.
