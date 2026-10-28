---
title: SSI check of what a save answers (result.dive), as the app and as another client
summary: On the owner's account (app 5.0.43) a create and an update sent with the app's User-Agent are answered with result.dive, one record of 388 keys equal key for key to the logbook's record, samples included, with no read-back differences; a create sent with another User-Agent is answered with success only (no result) and an invented dive ID, and nothing is stored. So result.dive proves storage and can replace the read-back (piece 7).
status: done
date: 2026-10-28
---

# SSI check of what a save answers

Run by the agent with the kept token on 2026-10-28, announced in the session and agreed by the owner, as
`round-trip.ts answer` (`apps/server/test/fixtures/ssi/answer-checks.ts`). Account 3664600, MySSI app 5.0.43. [T] tested
on the owner's account. Background: the [SSI reference](../references/ssi-app-api.md#ssis-app-how-it-uploads-dives-checked-2026-10-10-app-5043)
(the app's save answer [R]), [ADR 0049](../decisions/0049-ssi-app-user-agent.md) (SSI's invented answer to other clients),
the design's piece 7 ([SSI app alignment](../superpowers/specs/2026-10-23-ssi-app-alignment-design.md)). The raw answers
are in git-ignored `samples/private/ssi/answer.json`.

## What was sent

1. A create as the app (User-Agent `Dart/3.12 (dart:io)`): a throwaway dive dated 2000-01-05 12:00, 2 min, 2 m, notes
   "Dive Hub test – answer, delete me", the private test site 1083262, 25 samples; reference `divehub-answer-test`.
2. An update of it as the app, notes changed, built from the logbook's record as Dive Hub's update is.
3. A create with the User-Agent `DiveHub-check/1.0`: the same dive at 14:00, reference `divehub-answer-foreign`.
4. Deletes of every test dive found; a logbook read confirmed none is left.

## Results [T]

- **The create's answer carries the stored dive.** Top level: the record as sent, echoed, plus `sql_success`,
  `sql_NEW_odin_user_log_id`, `success` (`ok: "added to Log"`, `error`, `temp_id`, `odin_user_log_id`) and `result`
  (`dive`, `divestats`, `potential_duplicate: 0`). `result.dive` is a list of one record, 388 keys, with the new ID
  (30168573), number 93 and our reference. It holds **the samples** (25, as sent). Read-back comparison against it: no
  differences. Against the logbook's record read right after: no key only in one, no value different.
- **The update's answer** is `{ success: { ok: "updated", … }, result: { dive, divestats, potential_duplicate } }`;
  `result.dive` the same: 388 keys, equal to the logbook's record, no read-back differences.
- **The answer to another User-Agent** is `{ success: { ok: "added to Log", error, temp_id, odin_user_log_id } }`, no
  `result` and no echo; the ID (966190106) is invented (real IDs are about 30 million). The logbook has no dive with that
  ID or the reference: **nothing was stored**, as ADR 0049 says.

## What it means

- A save SSI stored answers with `result.dive` carrying the saved ID; SSI's invented answer has none. The answer alone
  tells a stored save from an invented one, so the logbook read after each save (the read-back) can go: the comparison
  runs against `result.dive`, which equals what a read would return.
- The create's answer now also wraps its ID in `success` (until now seen only on updates); `ssi-client.save` reads
  `success` first, so it is unaffected.
- Not checked: a save of a dive with a large profile (the test had 25 samples); a delete's answer.
