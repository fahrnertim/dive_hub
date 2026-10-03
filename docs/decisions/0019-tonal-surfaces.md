---
title: "ADR 0019: Tonal surfaces, comfortable density, and no component library"
summary: Panels lift off a slightly deeper page tone instead of an outline (direction B of the visual refresh), with one comfortable density; we keep our own React Aria components and use no UI library or Tailwind. Amends ADR 0014.
status: accepted
date: 2026-10-04
---

# ADR 0019: Tonal surfaces, comfortable density, and no component library

## Status
Accepted – 2026-10-04. Amends [ADR 0014](0014-design-system-and-localization.md).

## Context
The project owner asked for a "clean and modern" look ([visual refresh](../research/2026-10-03-visual-refresh.md)).
The screenshots showed every section as the same outlined white box on a grey page
([proposal](../research/2026-10-04-visual-refresh-proposal.md)). ADR 0014 says "panels with borders
instead of shadows". UI component libraries were researched at the same time
([UI component libraries](../research/2026-10-04-ui-component-libraries.md)). The owner decided on
2026-10-04: library option 1, all ten ranked changes, direction B, comfortable density.

## Decision
- **Tonal surfaces.** Panels are white (night dive: `#0e2338`) on a slightly deeper page tone (`#e9eef2`,
  night dive `#061522`), with **no outline** and `--radius-lg` 14 px. The step between them is
  decorative (1.17:1 light, 1.19:1 dark); it carries no meaning.
- **Borders only where they mean something:** control boundaries (≥ 3:1, WCAG 1.4.11), dividers between
  rows, and the tab line. The page still gets **no shadows**; `--shadow-overlay` stays for dialogs and popovers.
- **Attention is a tint:** a section waiting for the User (Duplicate candidates) uses `--color-accent-soft`.
- **One density, comfortable:** table rows keep `--space-3` vertical padding. No per-User density setting.
- **Panel padding:** 32 px on wide screens, 24/16 px on phones.
- **No component library, no Tailwind.** We keep our own components on React Aria Components (ADR 0014).
  New widgets start from the React Aria vanilla-CSS starter kit (Apache-2.0) or shadcn/ui's React Aria
  base (MIT) as templates; copied code keeps its notice and gets a line in `NOTICE`.

## Considered options
- **A: refined panels** (outline kept, more radius): least change, but keeps the boxed look.
- **C: one sheet** (no panels): most open, but the Dive page (facts, recordings, chart, history) would rely on
  headings alone to group.
- **Compact density:** more rows per screen; rejected for now, the logbook pages by 25 dives anyway.
- **Libraries:** shadcn/ui's new React Aria base, HeroUI v3 and Untitled UI's open part need Tailwind v4 and
  their own look; Mantine and Reshaped would replace our look and weaken locale-aware dates and numbers.
  PrimeReact 11+, Untitled UI PRO, HeroUI Pro, Magic UI Pro and Aceternity are excluded by their licenses.

## Consequences
- ADR 0014's "panels with borders instead of shadows" now reads "panels set off by tone, without outline or
  shadow". The [design system](../spec/design-system.md) and its contrast table are updated.
- Panels nested in panels (phone cards, candidate rows) need their own tone or a divider, since an outline
  no longer separates the outer panel.
- No new dependencies. The skills `better-layout`, `better-typography`, `better-colors` support the work.
