---
title: Find out why axe reports colour contrast on two intermediate pages, and fix it
summary: With axe at every page check (as CI runs it), ui-quality failed twice on color-contrast on 2026-10-26 - a link on the lead calculator and "Show them" on the Review page; decide whether each is a real contrast fault or axe catching a transition, and fix the cause.
status: done
risk: low
date: 2026-10-26
---

# Find out why axe reports colour contrast on two intermediate pages, and fix it

**Done 2026-10-26 (PR #5):** a transition, not a contrast fault. Notices (`enter-rise`), dialogs (`enter-dialog`) and
buttons (colour transitions) start faded, and axe measured them mid-fade. CI hit it on 12 ui-quality tests once
the browser step ran faster. Reproduced locally by setting the `--duration-*` tokens to 2000 ms (2 of 3 tests
failed); `expectAccessible` now waits for every animation and transition that ends to end, and the 7 failing tests
passed in both variants with the slow tokens.

Found while measuring for the [faster local check](../superpowers/specs/2026-10-26-faster-local-check-design.md#what-was-measured-2026-10-26)
(owner asked for this task, 2026-10-26). `pnpm check` runs axe once per ui-quality test, on its final page
(`E2E_AXE=once`, ADR 0023 amendment of 2026-10-24), so these pages are checked only in CI.

## Goal
- Both findings are explained: a real contrast fault (WCAG 1.4.3, 4.5:1 for text) or axe measuring mid-transition.
- **A real fault** is fixed in the design tokens or the component, not in the test, and stays fixed in both colour
  schemes.
- **A transition** is fixed so axe checks the settled page (for example by waiting for the element's transition to end
  in `expectAccessible`, or by the page check emulating reduced motion), not by a retry.
- Done: `E2E_AXE` unset, `pnpm --filter @dive-hub/web test:e2e ui-quality.spec.ts --grep-invert "@full|@variants" --repeat-each 3`
  passes, and the same for the German, dark, phone variant (`--grep "@variants"`).

## Read first
- The findings, run 2 of the [measurements](../superpowers/specs/2026-10-26-faster-local-check-design.md#what-was-measured-2026-10-26):
  - `ui-quality.spec.ts:289` (Tools: the lead calculator): `color-contrast: <a href="#/divers">Add body weight on the Divers page</a>`
  - `ui-quality.spec.ts:919` (a dive deleted in SSI, on the Review page): `color-contrast: <a href="#/review">Show them</a>`
- `apps/web/e2e/support.ts`: `expectAccessible` and `expectGoodPage`.
- [ADR 0023](../decisions/0023-faster-checks.md): retries are rejected; axe variants.
- [docs/spec/design-system.md](../spec/design-system.md) and `apps/web/src/design/tokens.css` for the colours.

## Decided
- No retries (ADR 0023). Fixes go to the page or the shared check, never by loosening axe's rules or tags.
- `pnpm check` keeps `E2E_AXE=once` (ADR 0023, amendment of 2026-10-24).

## State
- Base `main`. Seen once in one local run on Edge (2026-10-26, branch `testing-strategies-research`); whether CI's
  Chromium ever reported them is not known: look at the recent CI runs of `pnpm check:full` first.

## Open
- Which of the two causes each finding has; whether the fix belongs to the page or to `expectAccessible`.

## Skills to load
- `accessibility`, `playwright-cli`, `better-colors` if a token changes; read each one's override in
  [docs/skills.md](../skills.md#overrides) first.

## Don't
- Change `E2E_AXE`, the variants or the check script.
- Touch backlog 0004 or 0005.
