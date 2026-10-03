---
title: "ADR 0018: Lucide icons beside text; motion only where it explains"
summary: Icons come from lucide-react (ISC), always decorative next to a visible label; motion is a few short CSS animations (menus, dialogs, notices, the drop overlay) on our tokens, and none at all with reduced motion.
status: accepted
date: 2026-10-03
---

# ADR 0018: Lucide icons beside text; motion only where it explains

## Status
Accepted – 2026-10-03

## Context
After the [UI review](../research/2026-10-03-ui-review.md), the project owner asked for icons and
motion (2026-10-03) and chose Lucide over Phosphor. The [design system](../spec/design-system.md)
asks for one bold element (the depth profile) with everything else quiet, and the review's rules
(one h1, no icon-only meaning, `prefers-reduced-motion`) must keep holding. The skills
`suggest-lucide-icons`, `find-animation-opportunities` and `review-animations` were installed for
this work ([skills](../skills.md)).

## Decision
**Icons**
- **Library:** `lucide-react` (ISC), imported by name so only the icons used reach the bundle. One
  set, 24 px grid, 2 px stroke, which matches IBM Plex's weight. Phosphor (MIT, six weights) was the
  alternative; one weight is all we need.
- **Always beside text.** An icon adds recognition to a label and never replaces it. There are no
  icon-only buttons. Icons are `aria-hidden` and rendered through `ui/Icon.tsx` (size 1.25 em,
  `currentColor`).
- **Where:** the main navigation, panel actions (Edit, Import files, More), menu items, the account
  menu, notices (info, success, error), pagination, sort direction, the back link, and controls that
  showed a text glyph before (▾, ▲, ▼). Table row actions stay text only, because a dense table reads
  better without them.
- **Names** are chosen and checked with `suggest-lucide-icons`, against the installed version
  (AGENTS.md).

**Motion**
- **Only where it explains** (gate from `find-animation-opportunities`: frequency, purpose,
  budget, function):

  | What | How | Why |
  |---|---|---|
  | Menus, selects, popovers open | 150 ms, `opacity` 0 → 1, `scale(0.96)` → 1, from the trigger (`--trigger-anchor-point`) | spatial link to the trigger |
  | Dialogs open | overlay fades in over 150 ms; the dialog scales from 0.97 over 200 ms, centred | prevents a jarring change |
  | Notices appear | 200 ms fade, 4 px rise | the result of an action arrives instead of popping in |
  | Drop overlay | 150 ms fade | prevents a jarring change |
  | Pressed buttons | `scale(0.97)`, 120 ms (since the review) | feedback |

- **Never animated:** page changes, table rows when sorting or paging, the depth profile, tab
  switches, focus moves, loading placeholders. These are frequent, or they're data the User reads.
- **Values:** `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` and the `--duration-*` tokens. Only
  `transform` and `opacity` animate. Entries animate; exits are instant.
- **Reduced motion:** the durations drop to 0, so nothing moves. This is deliberately stricter than
  the skills' "gentler, not zero". A logbook loses nothing without motion.

## Consequences
- One more runtime dependency (`lucide-react`). Upgrades are checked against renamed icons
  (`trash-2` is already gone from the latest catalogue).
- A browser test checks that animations run with motion allowed and that nothing moves with reduced
  motion. `source-rules.test.ts` keeps text glyphs (▾ ▲ ▼) and icon imports outside `ui/Icon.tsx`
  out of the pages.
