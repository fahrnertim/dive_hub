---
title: "ADR 0064: UI overhaul - framed sheet, sidebar, skeletons and motion"
summary: The page sits on one white sheet in a tinted frame (sidebar on desktop, top and bottom bars below 64rem); sections are set apart by space and rules; a near-neutral palette with water blue on links, focus and data and an ink primary button; one Settings area and a page per kept Diver; skeletons instead of "Loading…"; a few more subtle motions. Partly supersedes 0014, 0018, 0019.
status: accepted
date: 2026-11-02
---

# ADR 0064: UI overhaul - framed sheet, sidebar, skeletons and motion

## Status
Accepted – 2026-11-02 (owner). Built on the `ui-overhaul` branch. Designed in
[UI overhaul](../superpowers/specs/2026-11-02-ui-overhaul-design.md). Partly supersedes
[ADR 0014](0014-design-system-and-localization.md) (palette and direction),
[ADR 0018](0018-icons-and-motion.md) (motion) and [ADR 0019](0019-tonal-surfaces.md) (surfaces).

## Context
The owner asked on 2026-11-02 for a redesign with "the wow effect", less at first glance, skeletons and subtle
motion, and freed the navigation and look.

## Decision
- **Shell.** A tinted frame (a sidebar on desktop; a top bar and a bottom bar below 64rem) holds the page, which sits
  on one white sheet with a 1px edge and 16 px corners.
- **Surfaces.** Sections inside the sheet are separated by space and rules, and a box inside it by one tone step.
  This supersedes ADR 0019's white panels on a slate page.
- **Palette and buttons.** A near-neutral palette with the water hue on links, focus and data only, and an ink
  primary button. Dark mode is near-neutral, not navy. This supersedes ADR 0014's palette table; the flag mark and
  IBM Plex Sans stay.
- **Settings.** One Settings area with a view per section (Display, Sign-in and security, Connections, AI access,
  Devices, Administration), and a page per kept Diver.
- **Skeletons.** Flat bars in the final layout replace "Loading…". They show after 150 ms and pulse gently (off with
  reduced motion), and the content fades in over 150 ms.
- **Motion.** Added to ADR 0018's list:
  - the skeleton pulse;
  - content arrival;
  - disclosures opening by height;
  - hover colour transitions of 120 ms;
  - phone menus as bottom sheets.

  ADR 0018's "loading placeholders never animate" is replaced by the skeleton rules above. Everything else in
  ADR 0018 stands.

## Consequences
The browser tests are updated for the new structure. Old `#/account` and `#/admin` links redirect. ADRs 0014, 0018
and 0019 get a "Partly superseded by ADR 0064" line.
