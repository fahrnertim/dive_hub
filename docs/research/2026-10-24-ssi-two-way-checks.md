---
title: SSI checks of a two-way send
summary: On the owner's account, a change made in the MySSI app survives a send (the notes were taken, the lead of 8 kg went out) and a removal here reaches SSI (the notes were cleared, lead stayed). Tested with the same comparison as the push service, without the database. App 5.0.43. Also: why browser tests that expire SSI's tokens disturbed others, and the fix.
status: done
date: 2026-10-24
---

# SSI checks of a two-way send

Run by the controller with the owner on 2026-10-24, announced in the session, with the kept token and site 83913. MySSI app 5.0.43. [T] means tested on the owner's account. Background: [ADR 0056](../decisions/0056-two-way-exchange-and-automation.md), [clearing keys](2026-10-24-ssi-clearing-keys.md).

## How it was run
`round-trip.ts twoway start | send | clear | finish` (`apps/server/test/fixtures/ssi/twoway-checks.ts`). The mode runs the push service's comparison without the database: `parseSsiDive` reads SSI's record, `planSend` compares it with the base and the hub, `updateRecord(remote, dive, leave)` builds the record and `client.save` sends it. It does not go through the adapter. The base is the record SSI stored after `start`; after each send the stored record is the next base. Only the test dive's keys were printed.

## What happened
Test dive 30105325 (number 93), dated 2000-01-04 10:00, notes "Dive Hub test", lead 6 kg.

1. `start`: created; SSI stored notes "Dive Hub test", lead 6 kg.
2. The owner changed the notes in the app to "Dive Hub test, changed in the app".
3. `send` (hub: lead 8 kg, notes unchanged): plan `take ["notes"]`, clear, keep and conflicts empty. Keys sent: the notes key with SSI's own text and the lead keys with 8 kg (`odin_user_log_comment`, `odin_user_log_weight_kg`, `odin_user_log_weight_lb`). SSI stored notes "Dive Hub test, changed in the app" and lead 8 kg [T]. The change made in the app survived the send, and the lead went out.
4. `clear` (hub: notes removed): plan `clear ["notes"]`, the rest empty. `odin_user_log_comment` went out as `null`. SSI stored no notes and lead 8 kg [T]. The owner confirmed in the app: no notes, lead 8 kg.
5. `finish`: the dive was deleted.

## Browser tests
A browser test now and then saw "SSI wants you to sign in again" on a page that had nothing to do with signing in, and
axe flagged the notice while it faded in (`color-contrast`). Cause: the tests on one e2e server share its database and
its fake SSI. The test of a run stopped by a sign-in need (`ui-quality.spec.ts`, "sending many dives to SSI") expires
SSI's tokens and starts a run, so Erika's Connection waits for a sign-in afterwards, and every later test on that
server whose page shows the Connection showed the notice. `/e2e/fake-ssi/expire-tokens` also cleared every token of
every account, Lena's too (her Connection keeps no password). Fix: the test signs Erika in again in its `finally`;
the endpoint takes an `email` and expires only that account's tokens, and `expireSsiTokens` in
`apps/web/e2e/support.ts` passes Erika's SSI login (it fails when the fake doesn't know the account). A test that
expires tokens leaves its Connection signed in again.
