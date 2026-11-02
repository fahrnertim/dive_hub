---
title: Check escapes
summary: Failures CI's full check found on a pull request whose local pnpm check was green; a log to measure how certain the local check is (ADR 0023, amendment of 2026-10-24).
status: active
date: 2026-10-24
---

# Check escapes

`pnpm check` runs only what changed, and in one ui-quality variant ([ADR 0023](../decisions/0023-faster-checks.md),
amendments of 2026-10-24); CI's `pnpm check:full` on the pull request is the gate. This log counts what slipped past
the local check, so its certainty can be measured and the path map widened where it is wrong.

**Who writes an entry:** whoever pushed the branch and sees its CI fail (the agent session that opened the pull
request, or the owner), when every commit on it had a green local `pnpm check`. CI's job summary names the failed
browser tests ("Failed browser tests"). A failure that is a flaky test also counts; say so.

**Format:** one line per escape, newest first:
`- YYYY-MM-DD, PR #n, <commit sha7>: <failed spec or step> — <cause: map gap / variant / flaky / other> — <fix>`

## Escapes

- 2026-11-02, PR #17, 22adb97: dive-merge.spec.ts:70 and :119, ui-quality.spec.ts:956 (English light desktop) — other, not flaky (listed as flaky during the branch, wrongly): the merge tests clicked the only "Ask again" in Decided, but the surface break pair (answered "two dives" by its helper) was there too once another spec had used it, which this branch's spread of ui-quality tests over the workers made likely; the axe check measured the logbook's list fading in after its decision line had shown — each test clicks its own entry, and `expectAccessible` waits until no skeleton is left. provider-conflicts.spec.ts:15 — other, not flaky (three CI runs): an earlier spec in its worker had left the language German (cylinders, dive-page and navigation set it without resetting), and the test looks for English words; it and seven other specs that never reset the language now do in `beforeAll`, as twenty others did
- 2026-11-02, PR #17, 3461c12: dive-deletion.spec.ts:22 (delete, Undo, restore) — other, not flaky (failed twice in CI, passes alone): the Dive's newest history entry was "Appending undone", not "Restored"; back on the logbook after the restore, the test clicked Number n while the list from before the restore still showed, where n was the surface break pair's dive — the test waits until row n links to the restored Dive. Lesson: a test failing the same way twice is not flaky
- 2026-11-02, PR #17, cabe5b0: ui-quality.spec.ts:801 (a Diver's certifications, English light desktop and German dark phone) — other: `openDiver` clicked the Divers list's link and checked "No cards yet" before the Diver's page replaced the list, whose rows carry the same summary; CI's full run had more Divers without cards — `openDiver` waits for the Diver's page heading. Also provider-conflicts.spec.ts:15 — flaky: the test timed out at 30 s (seen locally before, unrelated to this branch) — CI rerun
- 2026-10-31, PR #15, 86a3594: waiting-pushes.spec.ts:368 (an Import's result leads to the Connection's settings) — flaky: the settings heading wasn't focused within 10 s; passes run alone locally, failed once locally before; this branch didn't touch the focus code — CI rerun; the cause is backlog 0015
- 2026-10-28, PR #8, c6e88a1: provider-conflicts.spec.ts:76 (a run's conflict, Take SSI's) — flaky: after the reload the test waited for "Waiting to send to SSI", but the e2e server's worker had already sent the Dive queued due now (the entry was gone) — the reload accepts the wait or an empty list; it still asserts the choices don't come back
- 2026-10-26, PR #5, 86808ee: ui-quality.spec.ts, 12 tests in English light desktop and German dark phone (axe color-contrast on notices, the merge dialog, buttons) — flaky: axe measured elements fading in from opacity 0; the browser step ran faster in CI once its output went to a file, and hit the fade — expectAccessible waits for finite animations to end (backlog 0006)
