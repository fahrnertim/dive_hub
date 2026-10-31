---
title: The Connection's settings get the focus reliably when opened from an Import's result
summary: waiting-pushes.spec.ts:368 fails now and then (CI on PR #15, locally once) - the "Automatic: <Diver>" heading isn't focused after the link from an Import's result; find why and make the focus reliable, not the test looser.
status: draft
risk: low
date: 2026-10-31
---

# The Connection's settings get the focus reliably when opened from an Import's result

## Goal
The link "Open the SSI settings to send them" on an Import's result always puts the focus on that Connection's
settings heading. `waiting-pushes.spec.ts:368` passes every time, with no retries added and no wait made looser.

## State
- CI on PR #15 (2026-10-31, run 41191520153): `expect(heading 'Automatic: Erika').toBeFocused()` timed out after
  10 s; the heading was there (`<h3 tabindex="-1">`), the focus elsewhere. Passes run alone locally; failed once in a
  local full run during the Garmin plan.
- The focus is set once in an effect on `[focused]` (apps/web/src/ProviderAutomation.tsx:38-42). Suspects: the
  effect runs while the section still returns `null` (the heading isn't mounted, and the effect doesn't run again),
  or something mounted later on the Account page takes the focus (an `autoFocus` field). Not checked yet.

## Read first
- apps/web/src/ProviderAutomation.tsx, apps/web/src/Connections.tsx (`focus` prop), the route that passes it.
- [check escapes](../agents/check-escapes.md), the 2026-10-31 entry.

## Skills to load
playwright-cli, vercel-react-best-practices, accessibility (read each override in [docs/skills.md](../skills.md#overrides) first).

## Don't
- Add retries, `test.fixme`, or a longer timeout to hide it.
