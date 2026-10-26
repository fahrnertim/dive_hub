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

(none yet)
