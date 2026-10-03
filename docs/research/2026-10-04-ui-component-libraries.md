---
title: UI component libraries
summary: shadcn/ui, Kibo UI, React Aria kits, headless primitives, styled libraries and single-part libraries vetted for license (incl. commercial use by self-hosters), stack fit, accessibility and maintenance. Recommendation: keep our own React Aria components; use the React Aria starter kit and shadcn's new React Aria base as reference only.
status: accepted
date: 2026-10-04
---

# UI component libraries

Part of the [visual refresh](2026-10-03-visual-refresh.md) ("Component library research").
Starting points: [shadcn/ui](https://ui.shadcn.com/), [Kibo UI](https://www.kibo-ui.com/),
[Untitled UI's list](https://www.untitledui.com/blog/react-component-libraries),
[awesome-react-components](https://github.com/brillout/awesome-react-components). Checked
2026-10-03/04 against npm metadata, LICENSE files in packed tarballs, GitHub and the projects' docs.
Load-bearing claims (shadcn's React Aria base, the PrimeReact and Untitled UI PRO licenses, the React
Aria starter's dark mode) were re-checked by hand.

## Question

Keep our own components on React Aria with our tokens ([ADR 0014](../decisions/0014-design-system-and-localization.md)),
adopt a library for some parts, or move to a library as the base?

## License rule applied

Dive Hub is Apache-2.0 and self-hosted; others may run it commercially. Acceptable: MIT, Apache-2.0,
ISC, BSD, with no fees or seats. Not acceptable: GPL/AGPL, non-commercial, source-available,
per-seat or "don't expose the source" terms. Copied code keeps its copyright notice (MIT) or its
notices plus a change note (Apache-2.0 §4); we would list it in our [NOTICE](../../NOTICE).

## Findings that change the picture

1. **shadcn/ui has a React Aria base since July 2026** (`shadcn init --base aria`, beside Base UI and Radix;
   [changelog](https://ui.shadcn.com/docs/changelog/2026-07-react-aria)). It is still **Tailwind v4 only**;
   there is no plain-CSS path.
2. **PrimeReact 11 (July 2026) is commercial.** Its LICENSE.md: *"This package is part of PrimeUI, a family of
   commercial UI libraries"*; the free tier is for organizations under $1M revenue and 5 developers, and
   *"Redistributing the software so that third parties can develop with it requires a separate OEM License."*
   The tarball also contains an Apache-2.0 `LICENSE`, but `package.json` says `SEE LICENSE IN LICENSE.md`. Not usable.
3. **Untitled UI React PRO forbids open source.** License: you may not *"Expose raw Untitled UI React source code
   in any product, including open-source repositories"* ([license](https://www.untitledui.com/license)). Only the
   public MIT repo is usable.
4. **coss ui (formerly Origin UI) is mostly AGPL-3.0**; only `apps/ui` and `apps/origin` are MIT
   ([LICENSING.md](https://github.com/cosscom/coss/blob/main/LICENSING.md)).
5. **IBM Carbon runs telemetry on install** (`postinstall: ibmtelemetry`).
6. **React Aria Components 1.21:** DatePicker, Calendar, NumberField, Table and Virtualizer are stable; only
   Toast is still `UNSTABLE_*`.

## Candidates

### Built on React Aria (our current base)

| Candidate | License | Styling | Fit and state | Verdict |
|---|---|---|---|---|
| **React Aria starter kits** (Adobe, vanilla CSS and Tailwind) | Apache-2.0, all free | Vanilla kit: plain CSS, custom-property theme (`--tint` → oklch scale), `@media (prefers-color-scheme: dark)`, Lucide icons | Same library and version line as ours; RAC 1.21.1 (2026-09-04), monthly releases, Adobe-maintained | **Reference and copy-in source.** No new dependency |
| **shadcn/ui, React Aria base** | MIT; nothing paid (third-party "shadcn" block shops are separate) | Tailwind v4, `cva` + `cn()`; `.dark` class via JS ThemeProvider | Very active (CLI 4.21.1, 2026-10-01); aria base pins RAC 1.20; ~59 items; the aria `drawer` pulls `@base-ui/react`; chart = recharts, toast = sonner | Reference only, unless we adopt Tailwind |
| **HeroUI v3** | MIT on npm (Apache-2.0 LICENSE on the v3 branch); **HeroUI Pro is per-seat and forbids redistribution** | Tailwind v4-built stylesheet, BEM classes, OKLCH variables; dark via `.dark` / `data-theme` | Most popular RAC library (≈31k stars), releases every few weeks (3.2.6, 2026-09-17) | Would replace our components and add Tailwind |
| **Untitled UI React** (open part) | MIT repo; **PRO not usable** (see above), $349–8,999 per seat | Tailwind v4.3 + `tailwindcss-react-aria-components`; `.dark-mode` class | Active (pushed 2026-10-02); pulls motion, recharts, sonner | Look is the draw; Tailwind and their theme instead of ours |
| **Intent UI** | MIT components; premium blocks/themes unclear | Tailwind, shadcn registry; Heroicons | One maintainer, active | Reference only |
| **Jolly UI** | MIT | Tailwind 3.4, RAC 1.6, React 18 | Stale since 2025-01-31 | No |
| **React Spectrum S2** | Apache-2.0 | Build-time style macro (`unplugin-parcel-macros`); colours and padding not customisable; Adobe Clean fonts restricted to Adobe products | Adobe's own look | No |
| Workleap Hopper, BC Gov design system | Apache-2.0 | Own style systems, branded | Good examples of RAC-based corporate systems | No |

### Other headless bases

| Candidate | License | Notes | Verdict |
|---|---|---|---|
| **Base UI** (MUI) | MIT | v1.8.0 (2026-09-04), monthly; plain-CSS friendly (state as data attributes); **no public date picker yet** | Strongest non-Aria option, but switching loses dates and RAC's i18n |
| **Ark UI** (Chakra team, Zag.js) | MIT | 5.39.2 (2026-09-13); broad (DatePicker with `locale`, `@internationalized/date`); ≈70 `@zag-js/*` packages | Capable; a full rewrite for no gain |
| **Radix Primitives / Themes** (WorkOS) | MIT | Slower releases (Themes 3.3.0, 2026-01-31); no date picker, number field, combobox; Themes dark mode needs a prop or class | No |
| **Headless UI** (Tailwind Labs) | MIT | Small set, slow cadence, built for Tailwind | No |
| **Kibo UI** (now under shadcnblocks) | MIT, "free forever" | shadcn registry of complex pieces (Gantt, Kanban, editor) on Radix + Tailwind; last commit 2026-05-04 | No: Tailwind/Radix, and we need none of these |

### Styled libraries as a base

| Candidate | License | Styling | Verdict |
|---|---|---|---|
| **Mantine 9.6** | MIT | CSS modules + `--mantine-*` variables, React ≥ 19.2; NumberInput uses fixed separators, not `Intl` | Closest styled fit, but its look and tokens replace ours and i18n is weaker than RAC |
| **Reshaped 4.2** | MIT (open-sourced 2025-09-08) | Plain CSS + variables | Close styling model; one-company project; replaces our look |
| **Chakra UI 3** | MIT | Runtime CSS-in-JS (Emotion internals) | No |
| **MUI 9** | MIT core; **MUI X Pro/Premium commercial**; free Data Grid capped at 100 rows per page | Emotion | No |
| **Fluent UI v9** | MIT | Griffel CSS-in-JS, 62 dependencies, Office look | No |
| **Ant Design 6** | MIT | cssinjs, ≈445 kB gzip full | No |
| **Blueprint 6** | Apache-2.0 | Sass, desktop-dense | No |
| **IBM Carbon** | Apache-2.0 | Sass; **install-time telemetry** | No |
| **PrimeReact 11** | **Commercial** (see above) | | **Not allowed** |
| Park UI | MIT | Panda CSS (build-time CSS-in-JS), quiet | No |
| Magic UI Pro, Aceternity | **Pro licenses forbid redistribution; Aceternity's free components have no OSI license** | Landing-page animation | **Not allowed** |
| Tremor (Vercel) | Apache-2.0 / MIT | Dormant since 2025, React 18 peer only | No |

### Single parts

| Part | Today | Candidates checked | Recommendation |
|---|---|---|---|
| Date and time | RAC DateField | RAC DatePicker/Calendar (Apache-2.0, stable, `@internationalized/date`), react-day-picker (MIT, date-fns locales) | **RAC DatePicker** when we need a calendar |
| Number input | RAC NumberField | Mantine (fixed separators) | Keep RAC (German "18,5" via `Intl`) |
| Data table | own `Table` on our markup, server-side sort and paging ([ADR 0017](../decisions/0017-logbook-list-paging.md)) | TanStack Table 9 (MIT, headless, new major), AG Grid Community (MIT; Enterprise EULA), MUI X Data Grid (MIT, 100-row cap; Pro commercial) | Nothing now. TanStack Table only if client-side column features appear; **RAC Virtualizer** if the logbook ever needs virtual scrolling |
| Toasts | `Notice` + one live region | RAC `UNSTABLE_Toast` (Apache-2.0), Sonner (MIT, 0 deps, own styling), react-hot-toast (CSS-in-JS) | Not needed now; if needed, **RAC Toast behind our own wrapper** |
| Charts | uPlot (MIT, ≈21 kB, canvas) | Recharts (MIT, ≈148 kB, 11 deps), visx, ECharts (Apache-2.0, heavy), Chart.js, Nivo (slowing) | **Keep uPlot** |
| Icons | lucide-react (ISC) | `@untitledui/icons` (MIT) | Keep Lucide ([ADR 0018](../decisions/0018-icons-and-motion.md)) |

Sizes are full-package figures (bundlephobia), not what tree-shaking would ship.

## Options for the owner

| | 1. Keep our components (recommended) | 2. Tailwind kit on React Aria (shadcn aria base, HeroUI v3 or Untitled UI open) | 3. Styled library as base (Mantine or Reshaped) |
|---|---|---|---|
| Look | Our design system, refined in the [visual refresh](2026-10-04-visual-refresh-proposal.md) | The kit's look, re-themed with our colours | The library's look, re-themed |
| Accessibility | RAC, as now | RAC underneath, same | Mantine/Reshaped's own (no WCAG statement); weaker dates and number i18n |
| New dependencies | none | Tailwind v4 + plugin, cva/tailwind-variants, often motion, sonner, recharts | the library and its theming |
| Migration | none | rewrite `ui/` and page styles into utility classes; dark mode switches from media query to a class | rewrite `ui/` and most pages |
| Tests | unchanged | `source-rules.test.ts` rules (no `:hover` outside media queries, no `transition: all`) need rewriting for utilities; `ui-quality.spec.ts` stays | same as 2 |
| ADRs | none; this note records the outcome | new ADR superseding ADR 0014's "no CSS framework"; ADR 0018 motion review again | new ADR superseding ADR 0014 |
| Risk | we keep building the rare complex widget ourselves (with the starter kit as template) | churn of a copy-in kit; Tailwind tied into every page | lock-in to one maintainer's look and API |

**Decided 2026-10-04:** option 1 ([ADR 0019](../decisions/0019-tonal-surfaces.md)).

## Recommendation

**Option 1.** React Aria is already the strongest accessible, internationalized base. The best React
Aria-based kits are either the official starter kit (plain CSS, same dark-mode approach, Lucide, Apache-2.0)
or Tailwind kits whose value is mainly their look. A "clean and modern" look comes from our tokens and the
fixes in the [proposal](2026-10-04-visual-refresh-proposal.md), not from a library.

Concretely:
- When we need a new widget (date picker with calendar, combobox, toast, drawer), start from the **React Aria
  vanilla-CSS starter kit** and, for layout ideas, shadcn's aria base; map their variables to our tokens.
  Copied files keep their notice and get a line in `NOTICE`.
- No Tailwind; ADR 0014 stands. If you agree, a one-line amendment to ADR 0014's "Considered options"
  records that shadcn's aria base, HeroUI v3 and Untitled UI were checked on 2026-10-04 and not adopted.
- Never: PrimeReact 11+, Untitled UI PRO, HeroUI Pro, Magic UI Pro, Aceternity, coss ui's AGPL parts,
  MUI X Pro/Premium, AG Grid Enterprise.

## Not verified

Exact tree-shaken bundle sizes; independent accessibility audits for any kit; which Untitled UI docs
pages are PRO-only; HeroUI v3's locale handling; a primary source for the Kibo UI ownership change;
how Spectrum 2 loads its fonts.
